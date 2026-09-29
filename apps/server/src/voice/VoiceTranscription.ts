import { APICallError, generateText, RetryError, transcribe } from "ai";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ThreadId, VoiceCorrection } from "@t3tools/contracts";

import * as ServerSettings from "../serverSettings.ts";
import {
  makeGroqDictationProvider,
  type DictationProvider,
  type MakeDictationProvider,
} from "./DictationProvider.ts";
import {
  buildCleanupSystemPrompt,
  buildCleanupUserPrompt,
  buildTranscriptionPrompt,
  isEchoedTranscriptionPrompt,
  parseDictationVocabulary,
  threadNames,
} from "./dictationPrompts.ts";
import {
  buildCorrectionReviewPrompt,
  CORRECTION_REVIEW_SYSTEM_PROMPT,
  mergeLearnedVocabulary,
  parseReviewedTerms,
} from "./dictationLearning.ts";
import { RecentThreadMessages } from "./RecentThreadMessages.ts";

export type VoiceTranscriptionFailureReason =
  | "not-configured"
  | "unauthorized"
  | "rate-limited"
  | "provider";

export class VoiceTranscriptionFailure extends Data.TaggedError("VoiceTranscriptionFailure")<{
  readonly reason: VoiceTranscriptionFailureReason;
  readonly cause?: unknown;
}> {
  override get message(): string {
    switch (this.reason) {
      case "not-configured":
        return "Add a dictation API key in Settings to use voice input.";
      case "unauthorized":
        return "The dictation API key was rejected. Check it in Settings.";
      case "rate-limited":
        return "The dictation provider is rate limiting requests. Try again in a minute.";
      case "provider":
        return "The dictation provider could not transcribe this recording.";
    }
  }
}

function classifyProviderError(cause: unknown): VoiceTranscriptionFailure {
  const error = RetryError.isInstance(cause) ? cause.lastError : cause;
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new VoiceTranscriptionFailure({ reason: "unauthorized", cause });
    }
    if (error.statusCode === 429) {
      return new VoiceTranscriptionFailure({ reason: "rate-limited", cause });
    }
  }
  return new VoiceTranscriptionFailure({ reason: "provider", cause });
}

export class VoiceTranscription extends Context.Service<
  VoiceTranscription,
  {
    readonly isConfigured: Effect.Effect<boolean>;
    /** Transcribes a recording and cleans it up into the text the speaker meant to send. */
    readonly transcribe: (input: {
      readonly audio: Uint8Array;
      /** The thread being dictated into; its recent messages help spell names and code. */
      readonly threadId?: ThreadId | undefined;
    }) => Effect.Effect<string, VoiceTranscriptionFailure>;
    /** Remembers the spellings a user fixed in dictated text; returns the newly learned terms. */
    readonly learnCorrections: (
      corrections: ReadonlyArray<VoiceCorrection>,
    ) => Effect.Effect<ReadonlyArray<string>, VoiceTranscriptionFailure>;
  }
>()("t3/voice/VoiceTranscription") {}

const PROVIDER_CALL_MAX_RETRIES = 1;
const CONVERSATION_MESSAGES = 6;
const LEARNED_VOCABULARY_LIMIT = 500;

const transcribeWithProvider = (input: {
  readonly provider: DictationProvider;
  readonly audio: Uint8Array;
  readonly vocabularyPrompt: string | undefined;
}) =>
  Effect.tryPromise({
    try: (abortSignal) =>
      transcribe({
        model: input.provider.transcriptionModel,
        audio: input.audio,
        providerOptions: input.provider.transcriptionOptions({
          vocabularyPrompt: input.vocabularyPrompt,
        }),
        maxRetries: PROVIDER_CALL_MAX_RETRIES,
        abortSignal,
      }),
    catch: classifyProviderError,
  }).pipe(Effect.map((result) => result.text.trim()));

const generateWithProvider = (input: {
  readonly provider: DictationProvider;
  readonly system: string;
  readonly prompt: string;
}) =>
  Effect.tryPromise({
    try: (abortSignal) =>
      generateText({
        model: input.provider.cleanupModel,
        system: input.system,
        prompt: input.prompt,
        providerOptions: input.provider.cleanupOptions,
        temperature: 0,
        maxRetries: PROVIDER_CALL_MAX_RETRIES,
        abortSignal,
      }),
    catch: classifyProviderError,
  }).pipe(Effect.map((result) => result.text.replace(/[ \t]+$/gm, "").trim()));

export const make = (makeProvider: MakeDictationProvider) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const recentMessages = yield* RecentThreadMessages;
    const readDictationSettings = serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.dictation),
      Effect.orDie,
    );
    const readConfiguredDictation = readDictationSettings.pipe(
      Effect.filterOrFail(
        (dictation) => dictation.apiKey.length > 0,
        () => new VoiceTranscriptionFailure({ reason: "not-configured" }),
      ),
    );
    const readConversation = (threadId: ThreadId | undefined) =>
      threadId === undefined
        ? Effect.succeed([])
        : recentMessages.list({ threadId, limit: CONVERSATION_MESSAGES }).pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("Could not read thread context for dictation.", { cause }),
            ),
            Effect.orElseSucceed(() => []),
          );

    const transcribeRecording = Effect.fn("VoiceTranscription.transcribe")(function* ({
      audio,
      threadId,
    }: {
      readonly audio: Uint8Array;
      readonly threadId?: ThreadId | undefined;
    }) {
      const dictation = yield* readConfiguredDictation;
      const provider = makeProvider({ apiKey: dictation.apiKey });
      const conversation = yield* readConversation(threadId);
      const vocabulary = [
        ...new Set([
          ...parseDictationVocabulary(dictation.vocabulary),
          ...dictation.learnedVocabulary,
        ]),
      ];
      const namesInThread = threadNames(conversation).filter((name) => !vocabulary.includes(name));
      const vocabularyPrompt = buildTranscriptionPrompt([
        ...parseDictationVocabulary(dictation.vocabulary),
        ...namesInThread,
        ...dictation.learnedVocabulary,
      ]);
      const transcript = yield* transcribeWithProvider({ provider, audio, vocabularyPrompt });
      if (transcript.length === 0 || isEchoedTranscriptionPrompt(transcript, vocabularyPrompt)) {
        return "";
      }

      // A failed cleanup still leaves the speaker's words, which beats losing the recording.
      return yield* generateWithProvider({
        provider,
        system: buildCleanupSystemPrompt({ vocabulary, threadNames: namesInThread }),
        prompt: buildCleanupUserPrompt(transcript),
      }).pipe(
        Effect.catch((failure) =>
          Effect.logWarning("Dictation cleanup failed; using the raw transcript.", {
            reason: failure.reason,
            cause: failure.cause,
          }).pipe(Effect.as(transcript)),
        ),
      );
    });

    const learnCorrections = Effect.fn("VoiceTranscription.learnCorrections")(function* (
      corrections: ReadonlyArray<VoiceCorrection>,
    ) {
      if (corrections.length === 0) return [];
      const dictation = yield* readConfiguredDictation;
      const reply = yield* generateWithProvider({
        provider: makeProvider({ apiKey: dictation.apiKey }),
        system: CORRECTION_REVIEW_SYSTEM_PROMPT,
        prompt: buildCorrectionReviewPrompt(corrections),
      });
      const { added, learned } = mergeLearnedVocabulary({
        reviewed: parseReviewedTerms(reply, corrections),
        vocabulary: parseDictationVocabulary(dictation.vocabulary),
        learned: dictation.learnedVocabulary,
        forgotten: dictation.forgottenVocabulary,
        limit: LEARNED_VOCABULARY_LIMIT,
      });
      if (added.length > 0) {
        yield* serverSettings
          .updateSettings({ dictation: { learnedVocabulary: learned } })
          .pipe(Effect.orDie);
      }
      return added;
    });

    return VoiceTranscription.of({
      isConfigured: readDictationSettings.pipe(
        Effect.map((dictation) => dictation.apiKey.length > 0),
      ),
      transcribe: transcribeRecording,
      learnCorrections,
    });
  });

export const layer = Layer.effect(VoiceTranscription, make(makeGroqDictationProvider));

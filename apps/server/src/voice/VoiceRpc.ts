import {
  VoiceTranscriptionNotConfiguredError,
  WS_METHODS,
  type VoiceLearnCorrectionsInput,
  type VoiceTranscriptionCreateUrlInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as VoiceTranscription from "./VoiceTranscription.ts";
import { issueVoiceTranscriptionUrl } from "./VoiceTranscriptionUrl.ts";

export const makeRpcHandlers = VoiceTranscription.VoiceTranscription.pipe(
  Effect.map((voiceTranscription) => ({
    [WS_METHODS.voiceCreateTranscriptionUrl]: (input: VoiceTranscriptionCreateUrlInput) =>
      Effect.gen(function* () {
        if (!(yield* voiceTranscription.isConfigured)) {
          return yield* new VoiceTranscriptionNotConfiguredError();
        }
        return yield* issueVoiceTranscriptionUrl(input);
      }),
    [WS_METHODS.voiceLearnCorrections]: ({ corrections }: VoiceLearnCorrectionsInput) =>
      voiceTranscription.learnCorrections(corrections).pipe(
        Effect.map((learned) => ({ learned })),
        Effect.catchTags({
          VoiceTranscriptionFailure: (failure) =>
            failure.reason === "not-configured"
              ? Effect.fail(new VoiceTranscriptionNotConfiguredError())
              : Effect.logWarning("Could not learn from dictation corrections.", {
                  reason: failure.reason,
                }).pipe(Effect.as({ learned: [] })),
        }),
      ),
  })),
);

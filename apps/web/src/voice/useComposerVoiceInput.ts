import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  createEnvironmentVoiceTranscriber,
  environmentSupportsVoiceTranscription,
  findDictationCorrections,
  VoiceInputController,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { resolveShortcutCommand, type ShortcutEventLike } from "../keybindings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { voiceEnvironment } from "../state/voice";
import { makeEnvironmentVoiceTranscriptionTransport } from "./environmentVoiceTranscription";
import { createPushToTalkGesture, type PushToTalkGesture } from "./pushToTalkGesture";
import { canRecordVoice, requestMicrophonePermission, WebVoiceRecorder } from "./webVoiceRecorder";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

type ComposerVoiceInputOptions = {
  readonly environmentId: EnvironmentId;
  /** Identifies the draft; a transcript never lands in a draft other than the one it started in. */
  readonly ownerKey: string;
  /** The thread being dictated into, whose recent messages help spell names; null for a new draft. */
  readonly threadId: ThreadId | null;
  /** Inserts at the caret; returns false when the composer cannot take text right now. */
  readonly insertTranscript: (text: string) => boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly shortcutContext: () => Parameters<typeof resolveShortcutCommand>[2];
};

type ComposerVoiceSession = {
  readonly controller: VoiceInputController;
  readonly gesture: PushToTalkGesture;
  /** Transcripts inserted into each draft since it was last sent. */
  readonly dictatedByOwner: Map<string, Array<string>>;
};

function supportsVoiceInput(environmentId: EnvironmentId): boolean {
  return (
    canRecordVoice() &&
    environmentSupportsVoiceTranscription(
      appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId)),
    )
  );
}

function reportVoiceInputError(state: VoiceInputState, onRetry: () => void): void {
  if (state.error === null) return;
  toastManager.add({
    type: "error",
    title: "Voice input",
    description:
      state.errorAction === "settings"
        ? `${state.error} Allow microphone access for T3 Code in your system settings.`
        : state.error,
    ...(state.errorAction === "retry"
      ? { actionProps: { children: "Retry", onClick: onRetry } }
      : {}),
  });
}

function createComposerVoiceSession(input: {
  readonly readOptions: () => ComposerVoiceInputOptions;
  readonly onStateChange: (state: VoiceInputState) => void;
}): ComposerVoiceSession {
  const dictatedByOwner = new Map<string, Array<string>>();
  const recorder = new WebVoiceRecorder((status) => {
    void controller.handleRecorderStatus(status);
  });
  const controller: VoiceInputController = new VoiceInputController({
    recorder,
    getTranscriber: () => {
      const { environmentId, threadId } = input.readOptions();
      if (!supportsVoiceInput(environmentId)) return null;
      return createEnvironmentVoiceTranscriber({
        locale: navigator.language,
        threadId,
        transport: makeEnvironmentVoiceTranscriptionTransport(environmentId),
      });
    },
    requestPermission: requestMicrophonePermission,
    configureRecording: () => recorder.acquireMicrophone(),
    releaseRecording: async () => recorder.releaseMicrophone(),
    deleteRecording: (uri) => URL.revokeObjectURL(uri),
    // The web composer stays editable while recording, so the transcript is
    // inserted at the caret when it arrives. Only the draft owner is pinned.
    readDraft: () => ({
      ownerKey: input.readOptions().ownerKey,
      text: "",
      selection: { start: 0, end: 0 },
      revision: 0,
    }),
    commitDraft: (text) => {
      const { ownerKey, insertTranscript } = input.readOptions();
      if (insertTranscript(text)) {
        dictatedByOwner.set(ownerKey, [...(dictatedByOwner.get(ownerKey) ?? []), text]);
        return;
      }
      void navigator.clipboard.writeText(text);
      toastManager.add({
        type: "info",
        title: "Voice input copied",
        description:
          "The composer could not take text right now, so the transcript is on your clipboard.",
      });
    },
    onStateChange: (next) => {
      input.onStateChange(next);
      if (next.phase !== "preparing" && next.phase !== "recording") gesture.reset();
      if (next.phase === "error") {
        controller.cancel();
        reportVoiceInputError(next, () => void controller.start());
      }
    },
  });
  const gesture = createPushToTalkGesture({
    actions: {
      start: () => void controller.start(),
      stop: () => {
        // Released before the microphone opened, e.g. during the permission prompt.
        if (controller.currentState.phase === "preparing") controller.cancel();
        else void controller.stop();
      },
      cancel: () => controller.cancel(),
    },
    now: () => performance.now(),
    schedule: (callback, delayMs) => {
      const timer = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(timer);
    },
  });
  return { controller, gesture, dictatedByOwner };
}

/** Sends the words the user respelled in dictated text so the environment can learn them. */
async function learnFromSentMessage(input: {
  readonly environmentId: EnvironmentId;
  readonly dictated: ReadonlyArray<string>;
  readonly sent: string;
}): Promise<void> {
  const corrections = findDictationCorrections({ dictated: input.dictated, sent: input.sent });
  if (corrections.length === 0) return;
  const result = await runAtomCommand(
    appAtomRegistry,
    voiceEnvironment.learnCorrections,
    { environmentId: input.environmentId, input: { corrections } },
    { reportFailure: false },
  );
  if (result._tag !== "Success" || result.value.learned.length === 0) return;
  toastManager.add({
    type: "info",
    title: "Voice input learned new words",
    description: `${result.value.learned.join(", ")}. Manage them in Settings → General → Voice input.`,
  });
}

export function useComposerVoiceInput(options: ComposerVoiceInputOptions) {
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(options.environmentId));
  const isAvailable = canRecordVoice() && environmentSupportsVoiceTranscription(serverConfig);
  const [state, setState] = useState<VoiceInputState>(IDLE_STATE);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const latestOptions = useRef(options);
  useLayoutEffect(() => {
    latestOptions.current = options;
  });
  const [session] = useState(() =>
    createComposerVoiceSession({
      readOptions: () => latestOptions.current,
      onStateChange: (next) => {
        setState(next);
        setRecordingStartedAt((startedAt) =>
          next.phase === "recording" ? (startedAt ?? Date.now()) : null,
        );
      },
    }),
  );

  useEffect(() => () => void session.controller.dispose(), [session]);

  const { ownerKey } = options;
  useEffect(() => {
    if (ownerKey) session.controller.ownerChanged();
  }, [ownerKey, session]);

  useEffect(() => {
    if (!isAvailable) return;
    let heldCode: string | null = null;
    const matchesDictationShortcut = (event: ShortcutEventLike) =>
      resolveShortcutCommand(
        event,
        latestOptions.current.keybindings,
        latestOptions.current.shortcutContext(),
      ) === "composer.dictate";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.controller.currentState.phase !== "idle") {
        event.preventDefault();
        event.stopPropagation();
        session.gesture.reset();
        session.controller.cancel();
        return;
      }
      if (!matchesDictationShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      heldCode = event.code;
      session.gesture.press();
    };
    const release = () => {
      if (heldCode === null) return;
      heldCode = null;
      session.gesture.release();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === heldCode) release();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", release);
    };
  }, [isAvailable, session]);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!isAvailable || !bridge?.setDictationKeyEnabled || !bridge.onDictationKey) return;
    const setDictationKeyEnabled = bridge.setDictationKeyEnabled;
    let fnHeld = false;
    const unsubscribe = bridge.onDictationKey((keyState) => {
      fnHeld = keyState === "down";
      if (keyState === "down") session.gesture.press();
      else if (keyState === "up") session.gesture.release();
      else {
        session.gesture.reset();
        session.controller.cancel();
      }
    });
    // Releasing fn in another app never reaches this window's monitor.
    const releaseOnBlur = () => {
      if (!fnHeld) return;
      fnHeld = false;
      session.gesture.release();
    };
    window.addEventListener("blur", releaseOnBlur);
    setDictationKeyEnabled(true);
    return () => {
      setDictationKeyEnabled(false);
      window.removeEventListener("blur", releaseOnBlur);
      unsubscribe();
    };
  }, [isAvailable, session]);

  return {
    isAvailable,
    state,
    recordingStartedAt,
    /** Call once a message leaves this draft so fixes to dictated words are learned. */
    messageSent: (sent: string) => {
      const { environmentId, ownerKey } = latestOptions.current;
      const dictated = session.dictatedByOwner.get(ownerKey);
      if (!dictated) return;
      session.dictatedByOwner.delete(ownerKey);
      void learnFromSentMessage({ environmentId, dictated, sent });
    },
    toggle: () => session.gesture.toggle(),
    cancel: () => {
      session.gesture.reset();
      session.controller.cancel();
    },
    /** Drives the gesture from an external key source such as the desktop fn key. */
    gesture: session.gesture,
  };
}

export type ComposerVoiceInput = ReturnType<typeof useComposerVoiceInput>;

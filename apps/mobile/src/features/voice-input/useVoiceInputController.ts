import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  environmentSupportsVoiceTranscription,
  voiceInputBlocksSubmission,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import { useEnvironmentServerConfig } from "../../state/entities";
import { getNativeShowcaseScene } from "../showcase/nativeShowcaseScene";
import {
  createMobileEnvironmentVoiceTranscriber,
  learnFromSentMessage,
} from "./environmentVoiceTranscriber";
import { useGlobalVoiceInput } from "./VoiceInputProvider";
import { createVoiceInputTarget } from "./voiceInputSession";

const IDLE_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

/**
 * Transcripts inserted into each draft since it was last sent. Module-level
 * because a dictation can finish after its composer unmounted.
 */
const dictatedByOwner = new Map<string, Array<string>>();

export function useVoiceInputController(input: {
  readonly ownerKey: string | null;
  readonly environmentId: EnvironmentId | null;
  /** The thread being dictated into, whose recent messages help spell names; null for a new task. */
  readonly threadId: ThreadId | null;
  /** Shown by the global dictation pill when this composer is off screen. */
  readonly label: string;
  readonly readDraftMessage: () => string | null;
  readonly subscribeToDraftChanges: (onChange: () => void) => () => void;
  readonly selection: ComposerEditorSelection;
  readonly disabled?: boolean;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onChangeSelection: (selection: ComposerEditorSelection) => void;
  /** Sends the draft once a stop-and-send transcript has landed in it; absent where there is nothing to send. */
  readonly onSend?: () => void;
}) {
  const global = useGlobalVoiceInput();
  const { setOwnerFocused, session } = global;
  const latestInput = useRef(input);
  latestInput.current = input;
  const serverConfig = useEnvironmentServerConfig(input.environmentId);
  const transcriptionEnvironmentId = environmentSupportsVoiceTranscription(serverConfig)
    ? input.environmentId
    : null;
  const transcriptionEnvironmentIdRef = useRef(transcriptionEnvironmentId);
  transcriptionEnvironmentIdRef.current = transcriptionEnvironmentId;
  const [sendRequestCount, setSendRequestCount] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const ownerKey = input.ownerKey;
      if (!ownerKey) return;
      setOwnerFocused(ownerKey, true);
      return () => setOwnerFocused(ownerKey, false);
    }, [input.ownerKey, setOwnerFocused]),
  );

  const start = useCallback(() => {
    const captured = latestInput.current;
    if (!captured.ownerKey || captured.disabled) return;
    const { ownerKey } = captured;
    const environmentId = transcriptionEnvironmentIdRef.current;
    void session.start({
      ...createVoiceInputTarget(
        ownerKey,
        captured.readDraftMessage,
        (text, selection) => {
          captured.onChangeDraftMessage(text);
          if (mounted.current && latestInput.current.ownerKey === ownerKey) {
            latestInput.current.onChangeSelection(selection);
          }
        },
        captured.selection,
        captured.subscribeToDraftChanges,
      ),
      label: captured.label,
      getTranscriber: () =>
        environmentId === null
          ? null
          : createMobileEnvironmentVoiceTranscriber({ environmentId, threadId: captured.threadId }),
      onTranscriptInserted: (transcript) =>
        dictatedByOwner.set(ownerKey, [...(dictatedByOwner.get(ownerKey) ?? []), transcript]),
    });
  }, [session]);
  const { stop } = global;
  const stopAndSend = useCallback(() => {
    void stop().then((inserted) => {
      if (inserted && mounted.current) setSendRequestCount((count) => count + 1);
    });
  }, [stop]);
  // Sends after the render that carries the transcript, so the host sends the new draft.
  useEffect(() => {
    if (sendRequestCount > 0) latestInput.current.onSend?.();
  }, [sendRequestCount]);
  /** Call once a message leaves this draft so fixes to dictated words are learned. */
  const messageSent = useCallback((sent: string) => {
    const { ownerKey } = latestInput.current;
    const environmentId = transcriptionEnvironmentIdRef.current;
    const dictated = ownerKey ? dictatedByOwner.get(ownerKey) : undefined;
    if (!ownerKey || !dictated) return;
    dictatedByOwner.delete(ownerKey);
    if (environmentId !== null) void learnFromSentMessage({ environmentId, dictated, sent });
  }, []);
  const state = global.ownerKey === input.ownerKey ? global.state : IDLE_STATE;
  const isBusy = voiceInputBlocksSubmission(state);
  return {
    isAvailable:
      (global.isAvailable || transcriptionEnvironmentId !== null) &&
      (!global.isBusy || global.ownerKey === input.ownerKey),
    state,
    audioLevels: global.audioLevels,
    elapsedSeconds: global.elapsedSeconds,
    isBusy,
    freezesEditor: isBusy,
    blocksSubmission: isBusy,
    start,
    stop,
    stopAndSend,
    cancel: global.cancel,
    messageSent,
  };
}

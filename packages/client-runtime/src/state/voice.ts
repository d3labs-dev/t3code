import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

/** Each client instantiates this with its own connection runtime (`voiceEnvironment`). */
export function createVoiceEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    createTranscriptionUrl: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:voice:create-transcription-url",
      tag: WS_METHODS.voiceCreateTranscriptionUrl,
    }),
    learnCorrections: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:voice:learn-corrections",
      tag: WS_METHODS.voiceLearnCorrections,
    }),
  };
}

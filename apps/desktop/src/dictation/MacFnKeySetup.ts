import type { DesktopFnKeySetup } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";

const { logWarning } = makeComponentLogger("desktop-fn-key-setup");

// TISGetFnUsageType/TISUpdateFnUsageType are the private HIToolbox calls System
// Settings uses for "Press 🌐 key to" (0 Do Nothing, 1 Change Input Source,
// 2 Emoji & Symbols, 3 Start Dictation). Only the update call applies live;
// `defaults write` stays cached until the next login. Symbolic hot key 164 is
// Apple Dictation's shortcut; mask 0x800000 on a modifier shortcut is "Press 🌐 twice".
const READ_STATE_SCRIPT = `
ObjC.import("Carbon");
ObjC.bindFunction("TISGetFnUsageType", ["int", []]);
const hotKeys = ObjC.deepUnwrap(
  $.NSUserDefaults.alloc.initWithSuiteName("com.apple.symbolichotkeys").objectForKey("AppleSymbolicHotKeys"),
) ?? {};
const dictation = hotKeys["164"];
const fnTwiceDictation = Boolean(
  dictation?.enabled && dictation.value?.type === "modifier" && dictation.value.parameters[0] & 0x800000,
);
`;

const READ_SCRIPT = `${READ_STATE_SCRIPT}
JSON.stringify({ fnUsageType: $.TISGetFnUsageType(), fnTwiceDictation });
`;

// Switching away from "Start Dictation" is what turns fn-twice dictation off,
// so a leftover fn-twice shortcut is cleared by passing through 3 first.
const APPLY_SCRIPT = `${READ_STATE_SCRIPT}
ObjC.bindFunction("TISUpdateFnUsageType", ["void", ["int"]]);
if (fnTwiceDictation && $.TISGetFnUsageType() !== 3) $.TISUpdateFnUsageType(3);
$.TISUpdateFnUsageType(0);
`;

const MacFnKeyState = Schema.Struct({
  fnUsageType: Schema.Int,
  fnTwiceDictation: Schema.Boolean,
});
export type MacFnKeyState = typeof MacFnKeyState.Type;
const decodeMacFnKeyState = Schema.decodeUnknownEffect(Schema.fromJsonString(MacFnKeyState));

function fnKeySetupFromState(state: MacFnKeyState): DesktopFnKeySetup {
  return state.fnUsageType === 0 && !state.fnTwiceDictation ? "ready" : "needs-setup";
}

export class MacFnKeySetup extends Context.Service<
  MacFnKeySetup,
  {
    readonly read: Effect.Effect<DesktopFnKeySetup>;
    /** Sets "Press 🌐 key to" to Do Nothing and moves Apple Dictation off fn. */
    readonly apply: Effect.Effect<DesktopFnKeySetup>;
  }
>()("@t3tools/desktop/dictation/MacFnKeySetup") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const runScript = (script: string) =>
    spawner.string(ChildProcess.make("/usr/bin/osascript", ["-l", "JavaScript", "-e", script]));

  const read = runScript(READ_SCRIPT).pipe(
    Effect.flatMap(decodeMacFnKeyState),
    Effect.map(fnKeySetupFromState),
    Effect.catch((cause) =>
      logWarning("could not read the fn key setup", { cause }).pipe(
        Effect.as<DesktopFnKeySetup>("needs-setup"),
      ),
    ),
  );

  const apply = runScript(APPLY_SCRIPT).pipe(
    Effect.andThen(read),
    Effect.catch((cause) =>
      logWarning("could not free the fn key", { cause }).pipe(
        Effect.as<DesktopFnKeySetup>("needs-setup"),
      ),
    ),
  );

  const unsupported = Effect.succeed<DesktopFnKeySetup>("needs-setup");
  return MacFnKeySetup.of(
    environment.platform === "darwin" ? { read, apply } : { read: unsupported, apply: unsupported },
  );
});

export const layer = Layer.effect(MacFnKeySetup, make);

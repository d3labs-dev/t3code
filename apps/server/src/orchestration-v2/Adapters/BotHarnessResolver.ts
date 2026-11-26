import type { BotHarnessProfile, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export class BotHarnessResolver extends Context.Reference<{
  readonly resolve: (threadId: ThreadId) => Effect.Effect<Option.Option<BotHarnessProfile>>;
}>("t3/orchestration-v2/BotHarnessResolver", {
  defaultValue: () => ({ resolve: () => Effect.succeedNone }),
}) {}

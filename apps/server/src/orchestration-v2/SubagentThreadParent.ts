import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";

/**
 * Server-only: a `thread.create` dispatched with this set becomes a hidden subagent of that thread.
 * It has no delegated task, so its runs never wake the parent. Clients cannot set Effect context.
 */
export const SubagentThreadParent = Context.Reference<ThreadId | undefined>(
  "t3/orchestration-v2/SubagentThreadParent",
  { defaultValue: () => undefined },
);

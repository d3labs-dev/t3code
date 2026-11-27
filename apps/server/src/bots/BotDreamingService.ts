import {
  CommandId,
  IDLE_COMPACTION_TEXT,
  MessageId,
  resolveProjectProviderInstanceEnabled,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { BOT_DREAMING_PROMPT } from "@t3tools/shared/botDreaming";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { BOT_DREAMING_FALLBACK_TURNS, botDreamingAction } from "./BotDreaming.ts";
import * as BotStore from "./BotStore.ts";

/**
 * When a Bot's run completes, waits until the Bot is idle and asks it to consolidate NOW.md and
 * MEMORY.md, then sends a native `/compact` on providers that have one. Timers live in memory, so
 * a server restart skips consolidations that were still waiting.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const bots = yield* BotStore.BotStore;

  const actWhenDue = Effect.fn("BotDreamingService.actWhenDue")(
    function* (threadId: ThreadId, completedRunId: RunId) {
      let runId = completedRunId;
      // Loops after the wait or a retarget: the Bot may have moved on.
      while (true) {
        const bot = yield* bots.findByThreadId(threadId);
        if (Option.isNone(bot)) return;
        const current = yield* settings.getSettings;
        const thread = yield* projections.getThread(threadId);
        if (
          !resolveProjectProviderInstanceEnabled(
            current,
            thread.projectId,
            thread.providerInstanceId,
          )
        )
          return;
        const activeProviderThreadIds =
          thread.activeProviderThreadId === null ? [] : [thread.activeProviderThreadId];
        const records = yield* projections.getThreadRecords(
          threadId,
          [
            "runs",
            "providerThreads",
            "providerTurns",
            "runtimeRequests",
            "turnItems",
            "contextTransfers",
          ],
          {
            turnItemStatuses: ["pending", "running", "waiting"],
            // Enough recent runs to count turns since the last consolidation, plus active runs
            // that hold background work and rolled-back runs whose items it ignores.
            latestRunLimit: BOT_DREAMING_FALLBACK_TURNS * 2,
            runStatuses: ["preparing", "starting", "running", "rolled_back"],
            providerThreadIds: activeProviderThreadIds,
            providerTurnThreadIds: activeProviderThreadIds,
            latestProviderTurnUsageOnly: true,
            runtimeRequestStatuses: ["pending"],
            contextTransferStatuses: ["pending"],
          },
        );
        const latestRun = records.runs
          .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
          .reduce<(typeof records.runs)[number] | undefined>(
            (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
            undefined,
          );
        // A late update for an earlier run replaced the latest run's timer, so take it over.
        if (latestRun?.status === "completed" && latestRun.id !== runId) {
          runId = latestRun.id;
          continue;
        }
        const { messages } = yield* projections.getThreadRecords(threadId, ["messages"], {
          messageRunIds: records.runs.map((run) => run.id),
          messageRoles: ["user"],
        });
        const exchanges = yield* bots.listExchangesForBot(bot.value.id);
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        const action = botDreamingAction(
          { ...records, messages },
          bot.value,
          { hasPendingBotExchanges: exchanges.some((exchange) => exchange.status === "pending") },
          nowMs,
        );
        if (action?.runId !== runId) return;
        if (action.kind === "dream" && nowMs < action.startMs) {
          yield* Effect.sleep(Duration.millis(action.startMs - nowMs));
          continue;
        }
        // One dispatch per completed run, even across duplicate events.
        yield* orchestrator.dispatch(
          action.kind === "dream"
            ? {
                type: "message.dispatch",
                commandId: CommandId.make(`server:bot-dream:${threadId}:${runId}`),
                messageId: MessageId.make(`bot-dream:${threadId}:${runId}`),
                threadId,
                text: BOT_DREAMING_PROMPT,
                attachments: [],
                createdBy: "agent",
                creationSource: "server",
                dispatchMode: { type: "start_immediately" },
              }
            : {
                type: "message.dispatch",
                commandId: CommandId.make(`server:bot-compact:${threadId}:${runId}`),
                messageId: MessageId.make(`bot-compact:${threadId}:${runId}`),
                threadId,
                text: IDLE_COMPACTION_TEXT,
                attachments: [],
                createdBy: "agent",
                creationSource: "server",
                idleCompaction: "beforeCacheExpires",
                dispatchMode: { type: "start_immediately" },
              },
        );
        return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("bot dreaming skipped", { threadId, cause })),
      ),
  );

  const start = Effect.fn("BotDreamingService.start")(function* () {
    // Keyed by thread: a newer completed run replaces the waiting timer.
    const timers = yield* FiberMap.make<ThreadId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? FiberMap.run(timers, event.threadId, actWhenDue(event.threadId, event.payload.id))
          : Effect.void,
      ),
    );
  });
  return { start };
});

import {
  type BotId,
  type BotListResult,
  type BotRecord,
  CommandId,
  MessageId,
  type ProjectId,
  resolveProjectProviderInstanceEnabled,
  type RunId,
  ThreadId,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import {
  BOT_SCOUT_PROMPT,
  buildBotCheckInHandoffPrompt,
  isBotNoReplyMessage,
} from "@t3tools/shared/botProactive";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { SubagentThreadParent } from "../orchestration-v2/SubagentThreadParent.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BotFolders from "./BotFolders.ts";
import {
  ACTIVE_RUN_STATUSES,
  nextHeartbeatAtMs,
  scoutModelSelectionFor,
  shouldRunBotHeartbeatScout,
} from "./BotHeartbeat.ts";
import * as BotService from "./BotService.ts";
import * as BotStore from "./BotStore.ts";

const isProactivePrimary = (bot: BotRecord) =>
  bot.isPrimary && bot.proactive.enabled && !bot.muted && bot.archivedAt === null;

const proactivePrimary = (list: BotListResult) =>
  list.bots.map((entry) => entry.bot).find(isProactivePrimary) ?? null;

const resubscribe = Schedule.spaced(Duration.seconds(5));

const sameSchedule = (left: BotRecord | null, right: BotRecord | null) =>
  left === null || right === null
    ? left === right
    : left.id === right.id && JSON.stringify(left.proactive) === JSON.stringify(right.proactive);

/**
 * Checks in for the primary Bot on its interval: a hidden scout thread reads NOW.md and
 * HEARTBEAT.md, and only a brief that is not `NO_REPLY` reaches the Bot's own thread. Attempt
 * times live in memory; after a restart the first check-in waits a full interval.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const bots = yield* BotStore.BotStore;
  const folders = yield* BotFolders.BotFolders;
  const botService = yield* BotService.BotService;
  const lastAttemptAtMs = yield* Ref.make(new Map<BotId, number>());

  const liveScoutThreadId = Effect.fn("BotHeartbeatService.liveScoutThreadId")(function* (
    bot: BotRecord,
  ) {
    const stored = yield* bots.getHeartbeatThreadId(bot.id);
    if (Option.isNone(stored)) return null;
    const thread = yield* projections.findThread(stored.value);
    return thread === null || thread.deletedAt !== null ? null : thread.id;
  });

  const createScoutThread = Effect.fn("BotHeartbeatService.createScoutThread")(function* (
    bot: BotRecord,
    projectId: ProjectId,
  ) {
    const threadId = ThreadId.make(`thread:bot-scout:${bot.id}:${yield* randomUuidV4}`);
    yield* orchestrator
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(`server:bot-scout-thread:${threadId}`),
        threadId,
        projectId,
        title: `${bot.name} check-in`,
        modelSelection: scoutModelSelectionFor(bot.modelSelection),
        runtimeMode: bot.runtimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: bot.folderPath,
        createdBy: "agent",
        creationSource: "server",
      })
      .pipe(Effect.provideService(SubagentThreadParent, bot.threadId));
    yield* bots.setHeartbeatThreadId({ botId: bot.id, threadId });
    return threadId;
  });

  const checkIn = Effect.fn("BotHeartbeatService.checkIn")(
    function* (botId: BotId, tickMs: number) {
      const found = yield* bots.get(botId);
      if (Option.isNone(found) || !isProactivePrimary(found.value)) return;
      const bot = found.value;
      const mainThread = yield* projections.getThread(bot.threadId);
      if (
        !resolveProjectProviderInstanceEnabled(
          yield* settings.getSettings,
          mainThread.projectId,
          bot.modelSelection.instanceId,
        )
      )
        return;
      const activeProviderThreadIds =
        mainThread.activeProviderThreadId === null ? [] : [mainThread.activeProviderThreadId];
      const mainThreadRecords = yield* projections.getThreadRecords(
        bot.threadId,
        ["runs", "providerThreads", "runtimeRequests", "turnItems", "contextTransfers"],
        {
          turnItemStatuses: ["pending", "running", "waiting"],
          latestRunLimit: 1,
          runStatuses: [...ACTIVE_RUN_STATUSES, "rolled_back"],
          providerThreadIds: activeProviderThreadIds,
          runtimeRequestStatuses: ["pending"],
          contextTransferStatuses: ["pending"],
        },
      );
      const scoutThreadId = yield* liveScoutThreadId(bot);
      const scoutThreadBusy =
        scoutThreadId !== null &&
        (yield* projections.getThreadRecords(scoutThreadId, ["runs"], {
          runStatuses: ACTIVE_RUN_STATUSES,
        })).runs.some((run) => ACTIVE_RUN_STATUSES.includes(run.status));
      const exchanges = yield* bots.listExchangesForBot(bot.id);
      const documents = yield* folders.readDocuments(bot.folderPath);
      if (
        !shouldRunBotHeartbeatScout({
          bot,
          mainThreadRecords,
          scoutThreadBusy,
          hasPendingBotExchanges: exchanges.some((exchange) => exchange.status === "pending"),
          documents,
          nowMs: tickMs,
        })
      )
        return;
      const threadId = scoutThreadId ?? (yield* createScoutThread(bot, mainThread.projectId));
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:bot-scout:${bot.id}:${tickMs}`),
        messageId: MessageId.make(`bot-scout:${bot.id}:${tickMs}`),
        threadId,
        text: BOT_SCOUT_PROMPT,
        attachments: [],
        freshContext: true,
        modelSelection: scoutModelSelectionFor(bot.modelSelection),
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      });
    },
    (effect, botId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("bot check-in skipped", { botId, cause })),
      ),
  );

  const runSchedule = Effect.fn("BotHeartbeatService.runSchedule")(function* (bot: BotRecord) {
    while (true) {
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      const attempts = yield* Ref.get(lastAttemptAtMs);
      const dueMs = nextHeartbeatAtMs({
        config: bot.proactive,
        lastAttemptAtMs: attempts.get(bot.id) ?? null,
        nowMs,
      });
      // A settings change restarts this loop; the first schedule's baseline keeps it from slipping.
      if (!attempts.has(bot.id)) {
        yield* Ref.set(lastAttemptAtMs, new Map(attempts).set(bot.id, nowMs));
      }
      yield* Effect.sleep(Duration.millis(Math.max(dueMs - nowMs, 0)));
      const tickMs = DateTime.toEpochMillis(yield* DateTime.now);
      yield* Ref.update(lastAttemptAtMs, (current) => new Map(current).set(bot.id, tickMs));
      yield* checkIn(bot.id, tickMs);
    }
  });

  const handOff = Effect.fn("BotHeartbeatService.handOff")(
    function* (scoutThreadId: ThreadId, runId: RunId) {
      const found = yield* bots.findByHeartbeatThreadId(scoutThreadId);
      if (Option.isNone(found)) return;
      const { messages } = yield* projections.getThreadRecords(scoutThreadId, ["messages"], {
        messageRunIds: [runId],
        messageRoles: ["assistant"],
      });
      const brief = messages
        .filter((message) => !message.streaming)
        .toSorted(
          (left, right) =>
            DateTime.toEpochMillis(right.createdAt) - DateTime.toEpochMillis(left.createdAt),
        )[0]?.text;
      if (brief === undefined || brief.trim() === "" || isBotNoReplyMessage(brief)) return;
      const bot = yield* bots.get(found.value.id);
      if (Option.isNone(bot) || !isProactivePrimary(bot.value)) return;
      // One handoff per scout run, even across duplicate events; a busy Bot takes it next.
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:bot-checkin:${bot.value.id}:${runId}`),
        messageId: MessageId.make(`bot-checkin:${bot.value.id}:${runId}`),
        threadId: bot.value.threadId,
        text: buildBotCheckInHandoffPrompt(brief),
        attachments: [],
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      });
    },
    (effect, scoutThreadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("bot check-in handoff skipped", { scoutThreadId, cause }),
        ),
      ),
  );

  const start = Effect.fn("BotHeartbeatService.start")(function* () {
    const schedule = yield* FiberHandle.make<void, never>();
    const handoffs = yield* FiberMap.make<RunId>();
    yield* forkParked(
      Stream.runForEach(
        botService.subscribeList().pipe(
          Stream.tapCause((cause) => Effect.logWarning("bot check-in list failed", { cause })),
          Stream.retry(resubscribe),
          Stream.map(proactivePrimary),
          Stream.changesWith(sameSchedule),
        ),
        (bot) =>
          // A Bot that stops checking in starts over, so turning it back on waits a full interval.
          Ref.update(
            lastAttemptAtMs,
            (attempts) => new Map([...attempts].filter(([botId]) => botId === bot?.id)),
          ).pipe(
            Effect.andThen(
              bot === null
                ? FiberHandle.clear(schedule)
                : FiberHandle.run(schedule, runSchedule(bot)),
            ),
          ),
      ),
    );
    yield* forkParked(
      Stream.runForEach(
        orchestrator.streamDomainEvents.pipe(
          Stream.tapCause((cause) => Effect.logWarning("bot check-in events failed", { cause })),
          Stream.retry(resubscribe),
        ),
        (event) =>
          event.type === "run.updated" && event.payload.status === "completed"
            ? FiberMap.run(handoffs, event.payload.id, handOff(event.threadId, event.payload.id), {
                onlyIfMissing: true,
              })
            : Effect.void,
      ),
    );
  });
  return { start };
});

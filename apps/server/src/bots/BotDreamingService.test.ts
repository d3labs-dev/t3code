import { describe, expect, it } from "@effect/vitest";
import {
  BotId,
  type BotRecord,
  BotSlug,
  DEFAULT_BOT_PROACTIVE_CONFIG,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  IDLE_COMPACTION_TEXT,
  MessageId,
  type OrchestrationV2DomainEvent,
  ProviderInstanceId,
  RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { BOT_DREAMING_PROMPT } from "@t3tools/shared/botDreaming";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as TestClock from "effect/testing/TestClock";

import * as IdleCompactionService from "../orchestration-v2/IdleCompactionService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { BOT_DREAMING_CACHE_LEAD_MS } from "./BotDreaming.ts";
import {
  at,
  botProjection,
  botRecords,
  botThreadId,
  MINUTE_MS,
  NOW_MS,
} from "./BotDreaming.testFixtures.ts";
import * as BotDreamingService from "./BotDreamingService.ts";
import * as BotStore from "./BotStore.ts";

const bot: BotRecord = {
  id: BotId.make("bot"),
  slug: BotSlug.make("bot"),
  name: "Bot",
  role: "",
  groupName: null,
  icon: "bot",
  color: "blue",
  isPrimary: false,
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "model" },
  runtimeMode: "full-access",
  tools: [],
  mcpServerNames: [],
  customMcpServers: {},
  skills: [],
  systemPromptMode: "preset",
  proactive: DEFAULT_BOT_PROACTIVE_CONFIG,
  muted: false,
  threadId: botThreadId,
  folderPath: "/bots/bot",
  hopCount: 0,
  archivedAt: null,
  createdAt: DateTime.formatIso(at()),
  updatedAt: DateTime.formatIso(at()),
};

const botStore = Layer.mock(BotStore.BotStore)({
  findByThreadId: (threadId: ThreadId) =>
    Effect.succeed(threadId === botThreadId ? Option.some(bot) : Option.none()),
  listExchangesForBot: () => Effect.succeed([]),
});

const completed = (run: ReturnType<typeof botRecords>["runs"][number]) =>
  ({
    id: EventId.make(`completed-${run.id}`),
    type: "run.updated",
    threadId: run.threadId,
    runId: run.id,
    occurredAt: at(),
    payload: run,
  }) satisfies OrchestrationV2DomainEvent;

describe("BotDreamingService", () => {
  it.effect("consolidates a warm Claude Bot before its cache expires, then compacts natively", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      let records = botRecords({ cacheExpiresInMs: 10 * MINUTE_MS });
      const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
      const dispatched: Array<{ commandId: string; text: string }> = [];
      const dreamed = yield* Deferred.make<void>();
      const compacted = yield* Deferred.make<void>();
      const dependencies = Layer.mergeAll(
        botStore,
        Layer.mock(Orchestrator.OrchestratorV2)({
          streamDomainEvents: Stream.fromQueue(events),
          dispatch: (command) =>
            Effect.sync(() => {
              if (command.type === "message.dispatch") {
                dispatched.push({ commandId: command.commandId, text: command.text });
                Deferred.doneUnsafe(
                  command.text === IDLE_COMPACTION_TEXT ? compacted : dreamed,
                  Effect.void,
                );
              }
              return { sequence: 1, storedEvents: [] };
            }),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: () => Effect.sync(() => records.thread),
          getThreadRecords: () => Effect.sync(() => botProjection(records)),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* BotDreamingService.make;
        yield* service.start();
        yield* Queue.offer(events, completed(records.runs[0]!));
        yield* TestClock.adjust(10 * MINUTE_MS - BOT_DREAMING_CACHE_LEAD_MS);
        yield* Deferred.await(dreamed);

        const dreamRun = {
          ...records.runs[0]!,
          id: RunId.make("run-dream"),
          ordinal: 2,
          userMessageId: MessageId.make("message-dream"),
        };
        records = {
          ...records,
          runs: [...records.runs, dreamRun],
          messages: [
            ...records.messages,
            {
              ...records.messages[0]!,
              id: dreamRun.userMessageId,
              runId: dreamRun.id,
              text: BOT_DREAMING_PROMPT,
            },
          ],
        };
        yield* Queue.offer(events, completed(dreamRun));
        yield* Deferred.await(compacted);
      }).pipe(Effect.provide(dependencies));

      expect(dispatched).toEqual([
        { commandId: "server:bot-dream:bot-thread:run-1", text: BOT_DREAMING_PROMPT },
        { commandId: "server:bot-compact:bot-thread:run-dream", text: IDLE_COMPACTION_TEXT },
      ]);
    }),
  );

  it.effect("leaves Bot threads out of idle compaction", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_MS);
      const records = botRecords({ cacheExpiresInMs: 2 * MINUTE_MS, usedTokens: 250_000 });
      let dispatches = 0;
      const done = yield* Deferred.make<void>();
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (...args) => {
            end(...args);
            if (span.name === "IdleCompactionService.compactWhenDue")
              Deferred.doneUnsafe(done, Effect.void);
          };
          return span;
        },
      });
      const dependencies = Layer.mergeAll(
        botStore,
        Layer.mock(Orchestrator.OrchestratorV2)({
          streamDomainEvents: Stream.make(completed(records.runs[0]!)),
          dispatch: () =>
            Effect.sync(() => {
              dispatches++;
              return { sequence: 1, storedEvents: [] };
            }),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: () => Effect.succeed(records.thread),
          getThreadRecords: () => Effect.succeed(botProjection(records)),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            idleCompaction: "beforeCacheExpires",
          }),
        }),
      );
      yield* Effect.gen(function* () {
        const service = yield* IdleCompactionService.make;
        yield* service.start();
        yield* Deferred.await(done);
      }).pipe(Effect.provide(dependencies), Effect.withTracer(tracer));
      expect(dispatches).toBe(0);
    }),
  );
});

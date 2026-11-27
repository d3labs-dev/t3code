import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EventId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { BOT_SCOUT_PROMPT, buildBotCheckInHandoffPrompt } from "@t3tools/shared/botProactive";
import type { BotRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as TestClock from "effect/testing/TestClock";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { SubagentThreadParent } from "../orchestration-v2/SubagentThreadParent.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BotFolders from "./BotFolders.ts";
import {
  at,
  botProjection,
  botRecords,
  botThreadId,
  MINUTE_MS,
  NOW_MS,
} from "./BotDreaming.testFixtures.ts";
import { primaryBot } from "./BotHeartbeat.testFixtures.ts";
import * as BotHeartbeatService from "./BotHeartbeatService.ts";
import * as BotService from "./BotService.ts";
import * as BotStore from "./BotStore.ts";

type Dispatched =
  | { readonly type: "thread.create"; readonly parent: ThreadId | undefined }
  | Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const scoutHarness = Effect.gen(function* () {
  yield* TestClock.setTime(NOW_MS);
  const records = botRecords();
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const dispatched = yield* Queue.unbounded<Dispatched>();
  const lists = yield* Queue.unbounded<BotRecord>();
  const handedOff = yield* Queue.unbounded<void>();
  const schedulesStarted = yield* Queue.unbounded<void>();
  const state = { bot: primaryBot, scoutThreadId: null as ThreadId | null };
  const scoutReplies = new Map<RunId, string>();
  const handledCommandIds = new Set<string>();
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      if (span.name === "BotHeartbeatService.runSchedule") {
        Queue.offerUnsafe(schedulesStarted, undefined);
      }
      const end = span.end.bind(span);
      span.end = (...args) => {
        end(...args);
        if (span.name === "BotHeartbeatService.handOff") Queue.offerUnsafe(handedOff, undefined);
      };
      return span;
    },
  });

  const completeScout = (runId: RunId, reply: string) =>
    Effect.gen(function* () {
      scoutReplies.set(runId, reply);
      yield* Queue.offer(events, {
        id: EventId.make(`completed-${runId}`),
        type: "run.updated",
        threadId: state.scoutThreadId!,
        runId,
        occurredAt: at(),
        payload: {
          ...records.runs[0]!,
          id: runId,
          threadId: state.scoutThreadId!,
          status: "completed",
        },
      });
    });

  const setBot = (bot: BotRecord) =>
    Effect.gen(function* () {
      state.bot = bot;
      yield* Queue.offer(lists, bot);
    });

  const layer = Layer.mergeAll(
    Layer.mock(BotService.BotService)({
      subscribeList: () =>
        Stream.fromQueue(lists).pipe(
          Stream.map((bot) => ({
            bots: [{ bot, status: "idle" as const }],
            availableMcpServers: [],
            backingProjectId: null,
            codingThreads: [],
          })),
        ),
    }),
    Layer.mock(BotStore.BotStore)({
      get: () => Effect.sync(() => Option.some(state.bot)),
      listExchangesForBot: () => Effect.succeed([]),
      getHeartbeatThreadId: () => Effect.sync(() => Option.fromNullOr(state.scoutThreadId)),
      setHeartbeatThreadId: ({ threadId }) =>
        Effect.sync(() => {
          state.scoutThreadId = threadId;
        }),
      findByHeartbeatThreadId: (threadId) =>
        Effect.sync(() =>
          threadId === state.scoutThreadId ? Option.some(state.bot) : Option.none(),
        ),
    }),
    Layer.mock(BotFolders.BotFolders)({
      root: "/bots",
      sharedDir: "/bots/_shared",
      folderFor: () => primaryBot.folderPath,
      readDocuments: () =>
        Effect.succeed({ soul: "", now: "- Merge PR #286", memory: "", heartbeat: "" }),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.fromQueue(events),
      dispatch: (command) =>
        Effect.gen(function* () {
          // The orchestrator's command receipts answer a repeated command id without new work.
          if (handledCommandIds.has(command.commandId)) return { sequence: 1, storedEvents: [] };
          handledCommandIds.add(command.commandId);
          if (command.type === "thread.create") {
            yield* Queue.offer(dispatched, {
              type: command.type,
              parent: yield* SubagentThreadParent,
            });
          } else if (command.type === "message.dispatch") {
            yield* Queue.offer(dispatched, command);
          }
          return { sequence: 1, storedEvents: [] };
        }),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThread: () => Effect.succeed(records.thread),
      findThread: (threadId) =>
        Effect.succeed(
          threadId === state.scoutThreadId ? { ...records.thread, id: threadId } : null,
        ),
      getThreadRecords: (threadId, _fields, filter) =>
        Effect.sync(() =>
          threadId === botThreadId
            ? botProjection(records)
            : {
                ...botProjection({ ...records, runs: [] }),
                messages: (filter?.messageRunIds ?? []).flatMap(
                  (runId): ReadonlyArray<OrchestrationV2ConversationMessage> => {
                    const text = scoutReplies.get(runId);
                    return text === undefined
                      ? []
                      : [
                          {
                            ...records.messages[0]!,
                            id: MessageId.make(`reply-${runId}`),
                            threadId,
                            runId,
                            role: "assistant",
                            text,
                          },
                        ];
                  },
                ),
              },
        ),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    }),
  );

  const startService = Effect.gen(function* () {
    const service = yield* BotHeartbeatService.make;
    yield* setBot(primaryBot);
    yield* service.start();
    yield* Queue.take(schedulesStarted);
  });

  return {
    state,
    dispatched,
    handedOff,
    schedulesStarted,
    completeScout,
    setBot,
    run: <A, E>(
      program: Effect.Effect<
        A,
        E,
        | BotService.BotService
        | BotStore.BotStore
        | BotFolders.BotFolders
        | Orchestrator.OrchestratorV2
        | ProjectionStore.ProjectionStoreV2
        | ServerSettings.ServerSettingsService
      >,
    ) =>
      startService.pipe(Effect.andThen(program), Effect.provide(layer), Effect.withTracer(tracer)),
  };
});

describe("BotHeartbeatService", () => {
  it.effect("scouts on its interval and hands only a real brief to the primary Bot", () =>
    Effect.gen(function* () {
      const harness = yield* scoutHarness;
      const { dispatched } = harness;

      const handOffs = yield* harness.run(
        Effect.gen(function* () {
          yield* TestClock.adjust(30 * MINUTE_MS);
          const created = yield* Queue.take(dispatched);
          const firstScout = yield* Queue.take(dispatched);

          yield* harness.completeScout(RunId.make("scout-run-quiet"), "NO_REPLY");
          yield* Queue.take(harness.handedOff);
          const afterQuiet = yield* Queue.size(dispatched);

          yield* TestClock.adjust(30 * MINUTE_MS);
          const secondScout = yield* Queue.take(dispatched);
          const briefRun = RunId.make("scout-run-brief");
          yield* harness.completeScout(briefRun, "- PR #286 checks are green");
          const handoff = yield* Queue.take(dispatched);
          yield* Queue.take(harness.handedOff);

          yield* harness.completeScout(briefRun, "- PR #286 checks are green");
          yield* Queue.take(harness.handedOff);
          return { created, firstScout, afterQuiet, secondScout, handoff };
        }),
      );

      expect(handOffs.created).toEqual({ type: "thread.create", parent: botThreadId });
      for (const scout of [handOffs.firstScout, handOffs.secondScout]) {
        expect(scout).toMatchObject({
          threadId: harness.state.scoutThreadId,
          text: BOT_SCOUT_PROMPT,
          freshContext: true,
          modelSelection: { options: [{ id: "effort", value: "medium" }] },
        });
      }
      expect(handOffs.afterQuiet).toBe(0);
      expect(handOffs.handoff).toMatchObject({
        threadId: botThreadId,
        commandId: "server:bot-checkin:kelsier:scout-run-brief",
        text: buildBotCheckInHandoffPrompt("- PR #286 checks are green"),
        createdBy: "agent",
        creationSource: "server",
      });
      expect(yield* Queue.size(dispatched)).toBe(0);
    }),
  );

  it.effect("stops checking in while muted and waits a full interval once turned back on", () =>
    Effect.gen(function* () {
      const harness = yield* scoutHarness;
      const { dispatched } = harness;

      const sizes = yield* harness.run(
        Effect.gen(function* () {
          yield* TestClock.adjust(30 * MINUTE_MS);
          yield* Queue.take(dispatched);
          yield* Queue.take(dispatched);

          yield* harness.setBot({ ...primaryBot, muted: true });
          yield* TestClock.adjust(90 * MINUTE_MS);
          const whileMuted = yield* Queue.size(dispatched);

          yield* harness.setBot(primaryBot);
          yield* Queue.take(harness.schedulesStarted);
          const onUnmute = yield* Queue.size(dispatched);
          yield* TestClock.adjust(29 * MINUTE_MS);
          const beforeInterval = yield* Queue.size(dispatched);
          yield* TestClock.adjust(MINUTE_MS);
          const scout = yield* Queue.take(dispatched);
          return { whileMuted, onUnmute, beforeInterval, scout };
        }),
      );

      expect(sizes).toMatchObject({
        whileMuted: 0,
        onUnmute: 0,
        beforeInterval: 0,
        scout: { text: BOT_SCOUT_PROMPT },
      });
    }),
  );
});

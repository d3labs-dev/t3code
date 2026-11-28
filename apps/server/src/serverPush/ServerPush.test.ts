import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  BotId,
  BotSlug,
  type BotRecord,
  EnvironmentId,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type Project,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ServerPushDeviceRegistration,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as BotService from "../bots/BotService.ts";
import * as BotStore from "../bots/BotStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectService } from "../project/ProjectService.ts";
import * as ServerPush from "./ServerPush.ts";

const environmentId = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");

const phone: ServerPushDeviceRegistration = {
  deviceId: "phone-1",
  userId: "server-push",
  expoPushToken: "ExponentPushToken[phone-1]",
  preferences: {
    liveActivitiesEnabled: true,
    notificationsEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
};

type ExpoTicket =
  | { readonly status: "ok"; readonly id: string }
  | {
      readonly status: "error";
      readonly message: string;
      readonly details: { readonly error: string };
    };

const decodeExpoMessages = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        to: Schema.String,
        priority: Schema.String,
        data: Schema.Record(Schema.String, Schema.String),
      }),
    ),
  ),
);
type ExpoMessage = ReturnType<typeof decodeExpoMessages>[number];
const decodeSavedDevices = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(ServerPushDeviceRegistration)),
);

function threadShell(
  threadId: ThreadId,
  at: DateTime.Utc,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  return {
    id: threadId,
    projectId,
    title: `Task ${threadId}`,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "running",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

const completed = (at: DateTime.Utc): Partial<OrchestrationV2ThreadShell> => ({
  status: "completed",
  latestRunCompletedAt: at,
});

function bot(threadId: ThreadId, overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    id: BotId.make(`bot-${threadId}`),
    slug: BotSlug.make("kelsier"),
    name: "Kelsier",
    role: "Chief of Staff",
    groupName: null,
    icon: "sparkles",
    color: "amber",
    isPrimary: true,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    tools: [],
    mcpServerNames: [],
    customMcpServers: {},
    skills: [],
    systemPromptMode: "preset",
    proactive: {
      enabled: false,
      intervalMinutes: 30,
      activeHoursStart: "08:00",
      activeHoursEnd: "22:00",
      timezone: "UTC",
    },
    muted: false,
    threadId,
    folderPath: "/bots/kelsier",
    hopCount: 0,
    archivedAt: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    ...overrides,
  };
}

function assistantReply(
  threadId: ThreadId,
  runId: RunId,
  text: string,
  at: DateTime.Utc,
): OrchestrationV2ConversationMessage {
  return {
    id: MessageId.make(`reply-${runId}`),
    threadId,
    runId,
    nodeId: null,
    role: "assistant",
    text,
    attachments: [],
    streaming: false,
    createdBy: "agent",
    creationSource: "provider",
    createdAt: at,
    updatedAt: at,
  };
}

function threadEvent(threadId: ThreadId): OrchestrationV2DomainEvent {
  return { type: "run.updated", threadId } as unknown as OrchestrationV2DomainEvent;
}

/** A server with fake thread and project services and a fake Expo push endpoint. */
const makeHarness = Effect.fn("makeHarness")(function* (baseDir: string) {
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const threadReads = yield* Queue.unbounded<ThreadId>();
  const threads = new Map<ThreadId, OrchestrationV2ThreadShell>();
  const bots = new Map<ThreadId, BotRecord>();
  const botLists = yield* Queue.unbounded<ReadonlyArray<BotRecord>>();
  const messages = new Map<ThreadId, ReadonlyArray<OrchestrationV2ConversationMessage>>();
  const requests: Array<ReadonlyArray<ExpoMessage>> = [];
  const urls = new Set<string>();
  let nextTicket: ExpoTicket = { status: "ok", id: "ticket" };
  const project = {
    id: projectId,
    title: "T3 Code",
    workspaceRoot: "/workspace",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    deletedAt: null,
  } satisfies Project;

  const expo = HttpClient.make((request) =>
    Effect.sync(() => {
      urls.add(request.url);
      const body = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
      const messages = decodeExpoMessages(new TextDecoder().decode(body));
      requests.push(messages);
      return HttpClientResponse.fromWeb(
        request,
        Response.json({ data: messages.map(() => nextTicket) }),
      );
    }),
  );

  const layer = ServerPush.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ServerEnvironment.ServerEnvironment, {
          getEnvironmentId: Effect.succeed(environmentId),
          getDescriptor: Effect.die("unused descriptor"),
        }),
        Layer.mock(ThreadManagementService)({
          streamDomainEvents: Stream.fromQueue(events),
          getThreadShell: (threadId) =>
            Queue.offer(threadReads, threadId).pipe(Effect.as(threads.get(threadId) ?? null)),
          // ServerPush reads only the messages.
          getThreadRecords: (threadId) =>
            Effect.succeed({ messages: messages.get(threadId) ?? [] } as never),
          getShellSnapshot: () =>
            Effect.sync(() => ({
              schemaVersion: 2,
              snapshotSequence: 1,
              threads: [...threads.values()],
              archivedThreads: [],
            })),
        }),
        Layer.mock(ProjectService)({
          getById: () => Effect.succeedSome(project),
          snapshot: Effect.succeed({ projects: [project] } as never),
        }),
        Layer.mock(BotStore.BotStore)({
          findByThreadId: (threadId) => Effect.succeed(Option.fromUndefinedOr(bots.get(threadId))),
        }),
        Layer.mock(BotService.BotService)({
          subscribeList: () =>
            Stream.fromQueue(botLists).pipe(
              Stream.map((list) => ({
                bots: list.map((bot) => ({ bot, status: "idle" as const })),
                availableMcpServers: [],
                backingProjectId: null,
                codingThreads: [],
              })),
            ),
        }),
        Layer.succeed(HttpClient.HttpClient, expo),
        ServerConfig.layerTest(process.cwd(), baseDir),
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

  /** Publishes a thread change and waits until the server has handled it. */
  const publish = Effect.fn("publish")(function* (thread: OrchestrationV2ThreadShell) {
    threads.set(thread.id, thread);
    yield* Queue.offer(events, threadEvent(thread.id));
    yield* Queue.take(threadReads);
    yield* ServerPush.ServerPush.pipe(Effect.flatMap((serverPush) => serverPush.drain));
  });

  /** Saves Bots the way BotService does, which announces the new list. */
  const saveBots = (...saved: ReadonlyArray<BotRecord>) =>
    Effect.gen(function* () {
      for (const bot of saved) bots.set(bot.threadId, bot);
      yield* Queue.offer(botLists, [...bots.values()]);
    });

  return {
    layer,
    requests,
    urls,
    bots,
    saveBots,
    messages,
    publish,
    threadReads,
    rejectNextPushes: (error: string) => {
      nextTicket = { status: "error", message: error, details: { error } };
    },
  };
});

const tempBaseDir = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "server-push-test-" })),
  Effect.provide(NodeServices.layer),
);

const readSavedDevices = (baseDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const contents = yield* fs.readFileString(
      path.join(config.stateDir, "server-push-devices.json"),
    );
    return yield* decodeSavedDevices(contents);
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), baseDir).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );

describe("ServerPush", { concurrent: false }, () => {
  it.effect("pushes the card and alerts to a phone, and drops it once Expo says it is gone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseDir = yield* tempBaseDir;
        const harness = yield* makeHarness(baseDir);
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread-1");

        yield* Effect.gen(function* () {
          const serverPush = yield* ServerPush.ServerPush;
          yield* serverPush.registerDevice(phone);
          yield* serverPush.drain;
          expect(harness.requests).toEqual([]);
          expect(yield* readSavedDevices(baseDir)).toEqual([phone]);

          yield* harness.publish(threadShell(threadId, now));
          expect([...harness.urls]).toEqual([ServerPush.EXPO_PUSH_URL]);
          const [running] = harness.requests[0]!;
          expect(running).toMatchObject({ to: phone.expoPushToken, priority: "high" });
          expect(running!.data).toMatchObject({
            t3_kind: "agent_activity",
            device_id: phone.deviceId,
            user_id: phone.userId,
            active: "true",
            activity_title: "1 active agent",
          });
          expect(running!.data.alert_id).toBeUndefined();

          yield* harness.publish(
            threadShell(threadId, now, {
              pendingRuntimeRequest: {
                id: RuntimeRequestId.make("request-1"),
                kind: "dynamic_tool_call",
                createdAt: now,
              },
            }),
          );
          const [approval] = harness.requests[1]!;
          expect(approval!.data).toMatchObject({
            alert_title: "Task thread-1",
            alert_body: "Approval: T3 Code",
            alert_path: `/threads/${environmentId}/${threadId}`,
          });
          expect(approval!.data.alert_id).toMatch(/^[0-9a-f]{64}$/);

          harness.rejectNextPushes("DeviceNotRegistered");
          yield* harness.publish(threadShell(threadId, now));
          expect(harness.requests).toHaveLength(3);
          expect(yield* readSavedDevices(baseDir)).toEqual([]);
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );

  it.effect(
    "stays quiet about work finished before startup and confirms a thread's first completion",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const baseDir = yield* tempBaseDir;
          const harness = yield* makeHarness(baseDir);
          const now = yield* DateTime.now;
          // Recent enough to alert, had this process done the work.
          const beforeStartup = DateTime.add(now, { minutes: -1 });
          const justNow = DateTime.add(now, { seconds: 1 });

          yield* Effect.gen(function* () {
            const serverPush = yield* ServerPush.ServerPush;
            yield* serverPush.registerDevice(phone);
            yield* serverPush.drain;

            yield* harness.publish(
              threadShell(ThreadId.make("thread-old"), beforeStartup, completed(beforeStartup)),
            );
            expect(harness.requests).toEqual([]);

            const finished = threadShell(ThreadId.make("thread-new"), justNow, completed(justNow));
            yield* harness.publish(finished);
            expect(harness.requests).toEqual([]);

            yield* TestClock.adjust("5 seconds");
            yield* Queue.take(harness.threadReads);
            yield* serverPush.drain;
            expect(harness.requests).toHaveLength(1);
            const [done] = harness.requests[0]!;
            expect(done!.data).toMatchObject({
              alert_title: "Task thread-new",
              alert_body: "Done: T3 Code",
              active: "false",
            });
          }).pipe(Effect.provide(harness.layer));
        }),
      ),
  );

  it.effect("names Bot alerts after the Bot, shows replies, skips NO_REPLY and check-ins", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseDir = yield* tempBaseDir;
        const harness = yield* makeHarness(baseDir);
        const now = yield* DateTime.now;
        const justNow = DateTime.add(now, { seconds: 1 });
        const replying = ThreadId.make("bot-replying");
        const silent = ThreadId.make("bot-silent");
        const toolOnly = ThreadId.make("bot-tool-only");
        const runId = RunId.make("run-1");
        harness.bots.set(replying, bot(replying));
        harness.bots.set(silent, bot(silent, { id: BotId.make("bot-silent"), name: "Vin" }));
        harness.bots.set(
          toolOnly,
          bot(toolOnly, { id: BotId.make("bot-tool-only"), name: "Sazed" }),
        );
        harness.messages.set(replying, [
          assistantReply(
            replying,
            runId,
            `## Update\nShipped the **[release notes](https://example.com/notes)** for \`v2\`.\n\n${"More detail. ".repeat(20)}`,
            justNow,
          ),
        ]);
        harness.messages.set(silent, [
          assistantReply(silent, runId, "```text\nNO_REPLY\n```", justNow),
        ]);

        yield* Effect.gen(function* () {
          const serverPush = yield* ServerPush.ServerPush;
          yield* serverPush.registerDevice(phone);
          yield* serverPush.drain;

          yield* harness.publish(threadShell(replying, now));
          yield* harness.publish(
            threadShell(replying, justNow, { ...completed(justNow), latestRunId: runId }),
          );
          const [done] = harness.requests[1]!;
          expect(done!.data).toMatchObject({
            alert_title: "Kelsier",
            activity_line_0: "Done\tKelsier\tChief of Staff",
          });
          expect(done!.data.alert_body).toMatch(
            /^Update Shipped the release notes for v2\. More detail\. .*\.\.\.$/,
          );
          expect(done!.data.alert_body).toHaveLength(120);

          for (const quiet of [silent, toolOnly]) {
            yield* harness.publish(threadShell(quiet, now));
            const shown = harness.requests.length;
            yield* harness.publish(
              threadShell(quiet, justNow, { ...completed(justNow), latestRunId: runId }),
            );
            yield* TestClock.adjust("5 seconds");
            yield* Queue.take(harness.threadReads);
            yield* serverPush.drain;
            expect(harness.requests).toHaveLength(shown + 1);
            expect(harness.requests[shown]![0]!.data.alert_id).toBeUndefined();
          }

          const checkIn = ThreadId.make("bot-check-in");
          const lineage = {
            rootThreadId: replying,
            parentThreadId: replying,
            relationshipToParent: "subagent" as const,
          };
          const shown = harness.requests.length;
          yield* harness.publish(threadShell(checkIn, now, { lineage }));
          yield* harness.publish(
            threadShell(checkIn, justNow, { ...completed(justNow), latestRunId: runId, lineage }),
          );
          expect(harness.requests).toHaveLength(shown);
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );

  it.effect("never shows a muted Bot, and clears its card once it is muted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseDir = yield* tempBaseDir;
        const harness = yield* makeHarness(baseDir);
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("bot-thread");
        harness.bots.set(threadId, bot(threadId, { muted: true }));

        yield* Effect.gen(function* () {
          const serverPush = yield* ServerPush.ServerPush;
          yield* serverPush.registerDevice(phone);
          yield* serverPush.drain;

          yield* harness.publish(threadShell(threadId, now));
          expect(harness.requests).toEqual([]);

          harness.bots.set(threadId, bot(threadId));
          yield* harness.publish(threadShell(threadId, now));
          expect(harness.requests).toHaveLength(1);

          harness.bots.set(threadId, bot(threadId, { muted: true }));
          yield* harness.publish(
            threadShell(threadId, now, {
              pendingRuntimeRequest: {
                id: RuntimeRequestId.make("request-1"),
                kind: "dynamic_tool_call",
                createdAt: now,
              },
            }),
          );
          yield* TestClock.adjust("5 seconds");
          yield* Queue.take(harness.threadReads);
          yield* serverPush.drain;
          expect(harness.requests).toHaveLength(2);
          const [cleared] = harness.requests[1]!;
          expect(cleared!.data).toMatchObject({ active: "false", activity_expires_at: "0" });
          expect(cleared!.data.alert_id).toBeUndefined();
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );

  it.effect("clears a Bot's card as soon as it is muted, with no thread change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseDir = yield* tempBaseDir;
        const harness = yield* makeHarness(baseDir);
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("bot-thread");

        yield* Effect.gen(function* () {
          const serverPush = yield* ServerPush.ServerPush;
          yield* serverPush.registerDevice(phone);
          yield* serverPush.drain;
          yield* harness.saveBots(bot(threadId));

          yield* harness.publish(threadShell(threadId, now));
          expect(harness.requests).toHaveLength(1);

          yield* harness.saveBots(bot(threadId, { muted: true }));
          yield* Queue.take(harness.threadReads);
          yield* serverPush.drain;
          yield* TestClock.adjust("5 seconds");
          yield* Queue.take(harness.threadReads);
          yield* serverPush.drain;
          expect(harness.requests).toHaveLength(2);
          const [cleared] = harness.requests[1]!;
          expect(cleared!.data).toMatchObject({ active: "false", activity_expires_at: "0" });
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
  );

  it.effect("keeps pushing to phones registered before a restart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseDir = yield* tempBaseDir;
        const now = yield* DateTime.now;

        const firstRun = yield* makeHarness(baseDir);
        yield* ServerPush.ServerPush.pipe(
          Effect.flatMap((serverPush) =>
            serverPush.registerDevice(phone).pipe(Effect.andThen(serverPush.drain)),
          ),
          Effect.provide(firstRun.layer),
        );

        const secondRun = yield* makeHarness(baseDir);
        yield* secondRun
          .publish(threadShell(ThreadId.make("thread-1"), now))
          .pipe(Effect.provide(secondRun.layer));
        expect(secondRun.requests[0]?.[0]?.to).toBe(phone.expoPushToken);
      }),
    ),
  );
});

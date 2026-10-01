import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type Project,
  ProjectId,
  ProviderInstanceId,
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
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

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

function threadEvent(threadId: ThreadId): OrchestrationV2DomainEvent {
  return { type: "run.updated", threadId } as unknown as OrchestrationV2DomainEvent;
}

/** A server with fake thread and project services and a fake Expo push endpoint. */
const makeHarness = Effect.fn("makeHarness")(function* (baseDir: string) {
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const threadReads = yield* Queue.unbounded<ThreadId>();
  const threads = new Map<ThreadId, OrchestrationV2ThreadShell>();
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
          getShellSnapshot: () =>
            Effect.sync(() => ({
              schemaVersion: 2,
              snapshotSequence: 1,
              threads: [...threads.values()],
              archivedThreads: [],
            })),
        }),
        Layer.mock(ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
          snapshot: Effect.succeed({ projects: [project] } as never),
        }),
        Layer.succeed(HttpClient.HttpClient, expo),
        ServerConfig.layerTest(process.cwd(), baseDir),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

  /** Publishes a thread change and waits until the server has handled it. */
  const publish = Effect.fn("publish")(function* (thread: OrchestrationV2ThreadShell) {
    threads.set(thread.id, thread);
    yield* Queue.offer(events, threadEvent(thread.id));
    yield* Queue.take(threadReads);
    yield* ServerPush.ServerPush.pipe(Effect.flatMap((serverPush) => serverPush.drain));
  });

  return {
    layer,
    requests,
    urls,
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

describe("ServerPush", () => {
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

/**
 * D3 Code fork: pushes agent activity to registered Android phones through
 * Expo's push service, in place of the T3 Connect relay the fork cannot use.
 * It follows the relay publisher's thread-state rules (AgentAwarenessRelay)
 * and the relay's Android delivery rules (serverPushPayloads).
 */
import {
  type OrchestrationV2ThreadShell,
  type Project,
  type ServerPushDeviceRegistration,
  ServerPushDeviceRegistration as ServerPushDeviceRegistrationSchema,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
} from "@t3tools/contracts/relay";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  agentAwarenessPublishIdentity,
  resolveAgentAwarenessRelayActiveThreadIds,
  resolveAgentAwarenessRelayPublishSnapshot,
  shouldPublishAgentAwarenessEvent,
} from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import { deliveryForDevice, fitPushData, makeAggregateState } from "./serverPushPayloads.ts";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts at most 100 messages per request.
const EXPO_BATCH_SIZE = 100;
const CONFIRMATION_DELAY_MS = 5_000;

const ExpoPushTicket = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ok") }),
  Schema.Struct({
    status: Schema.Literal("error"),
    message: Schema.String,
    details: Schema.optional(Schema.Struct({ error: Schema.optional(Schema.String) })),
  }),
]);
const ExpoPushResponse = Schema.Struct({ data: Schema.Array(ExpoPushTicket) });
const DevicesJson = Schema.fromJsonString(Schema.Array(ServerPushDeviceRegistrationSchema));
const decodeDevicesJson = Schema.decodeUnknownEffect(DevicesJson);
const encodeDevicesJson = Schema.encodeEffect(DevicesJson);

export class ServerPush extends Context.Service<
  ServerPush,
  {
    /** Adds or replaces a phone, then replays the current card to it. */
    readonly registerDevice: (registration: ServerPushDeviceRegistration) => Effect.Effect<void>;
    readonly unregisterDevice: (deviceId: string) => Effect.Effect<void>;
    /** Resolves once queued thread updates, registrations and their pushes finish. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/serverPush/ServerPush") {}

type ServerPushJob =
  | { readonly _tag: "thread"; readonly threadId: ThreadId }
  | { readonly _tag: "register"; readonly registration: ServerPushDeviceRegistration }
  | { readonly _tag: "unregister"; readonly deviceId: string };

interface RegisteredDevice {
  readonly registration: ServerPushDeviceRegistration;
  /** The card last delivered to this phone, which the next update is compared with. */
  readonly baseline: RelayAgentActivityAggregateState | null;
}

function isTerminalState(state: RelayAgentActivityState | null): boolean {
  return state?.phase === "completed" || state?.phase === "failed";
}

// Mirrors AgentAwarenessRelay: only work from this process may produce an
// initial terminal alert.
function terminalWorkSinceStart(
  thread: Option.Option<OrchestrationV2ThreadShell>,
  startedAt: number,
): boolean {
  return (
    Option.isSome(thread) &&
    thread.value.latestRunCompletedAt != null &&
    DateTime.toEpochMillis(thread.value.latestRunCompletedAt) > startedAt
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const scope = yield* Effect.scope;
  const startedAt = yield* Clock.currentTimeMillis;
  const devicesPath = path.join(config.stateDir, "server-push-devices.json");

  const loadDevices = Effect.gen(function* () {
    if (!(yield* fs.exists(devicesPath))) return [];
    return yield* fs.readFileString(devicesPath).pipe(Effect.flatMap(decodeDevicesJson));
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("server push device registrations could not be read", {
        path: devicesPath,
        cause: Cause.pretty(cause),
      }).pipe(Effect.as([])),
    ),
  );

  // Only the worker fiber reads or writes these, so jobs never interleave.
  const devices = new Map<string, RegisteredDevice>(
    (yield* loadDevices).map((registration) => [
      registration.deviceId,
      { registration, baseline: null },
    ]),
  );
  const states = new Map<ThreadId, RelayAgentActivityState>();
  const confirmDeadlines = new Map<ThreadId, number>();

  const persistDevices = Effect.suspend(() =>
    encodeDevicesJson([...devices.values()].map((device) => device.registration)),
  ).pipe(
    Effect.flatMap((contents) => writeFileStringAtomically({ filePath: devicesPath, contents })),
    Effect.catchCause((cause) =>
      Effect.logWarning("server push device registrations could not be saved", {
        path: devicesPath,
        cause: Cause.pretty(cause),
      }),
    ),
  );

  const hashAlertId = (alertId: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(alertId))
      .pipe(
        Effect.map((digest) =>
          Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        ),
      );

  const sendToExpo = (
    messages: ReadonlyArray<{ readonly to: string; readonly data: Record<string, string> }>,
  ) =>
    httpClient
      .execute(
        HttpClientRequest.post(EXPO_PUSH_URL).pipe(
          HttpClientRequest.acceptJson,
          // Data-only, so the app's own messaging service renders it.
          HttpClientRequest.bodyJsonUnsafe(
            messages.map((message) => ({ ...message, priority: "high" })),
          ),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ExpoPushResponse)),
        Effect.map((response) => response.data),
        Effect.timeout("15 seconds"),
      );

  const deliver = Effect.fn("ServerPush.deliver")(function* (input: {
    readonly changedState: RelayAgentActivityState | null;
    readonly deviceIds: ReadonlyArray<string>;
  }) {
    const nowMs = yield* Clock.currentTimeMillis;
    const aggregate = makeAggregateState({ states: [...states.values()], nowMs });
    const deliveries: Array<{
      readonly device: RegisteredDevice;
      readonly data: Record<string, string>;
      readonly baseline: RelayAgentActivityAggregateState | null;
    }> = [];
    for (const deviceId of input.deviceIds) {
      const device = devices.get(deviceId);
      if (device === undefined) continue;
      const delivery = deliveryForDevice({
        deviceId,
        userId: device.registration.userId,
        preferences: device.registration.preferences,
        previousAggregate: device.baseline,
        aggregate,
        changedState: input.changedState,
        nowMs,
      });
      if (delivery === null) continue;
      const alertId = delivery.data.alert_id;
      // Grouped alert identities list every thread; the phone only compares them.
      const data =
        alertId === undefined
          ? delivery.data
          : { ...delivery.data, alert_id: yield* hashAlertId(alertId) };
      deliveries.push({ device, data: fitPushData(data), baseline: delivery.baseline });
    }

    let removedDevices = false;
    for (let start = 0; start < deliveries.length; start += EXPO_BATCH_SIZE) {
      const batch = deliveries.slice(start, start + EXPO_BATCH_SIZE);
      const tickets = yield* sendToExpo(
        batch.map(({ device, data }) => ({ to: device.registration.expoPushToken, data })),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("server push request to Expo failed", {
            devices: batch.length,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(null)),
        ),
      );
      if (tickets === null) continue;
      for (const [index, { device, baseline }] of batch.entries()) {
        const ticket = tickets[index];
        const deviceId = device.registration.deviceId;
        if (ticket?.status === "ok") {
          devices.set(deviceId, { ...device, baseline });
        } else if (ticket?.details?.error === "DeviceNotRegistered") {
          devices.delete(deviceId);
          removedDevices = true;
          yield* Effect.logInfo("server push device removed; Expo reports it unregistered", {
            deviceId,
          });
        } else {
          yield* Effect.logWarning("server push delivery rejected by Expo", {
            deviceId,
            error: ticket?.details?.error ?? null,
            message: ticket?.status === "error" ? ticket.message : "missing ticket",
          });
        }
      }
    }
    if (removedDevices) yield* persistDevices;
  });

  const enqueue = (job: ServerPushJob): Effect.Effect<void> => worker.enqueue(job);
  // One queued update per thread covers every event that arrives before it runs.
  const queuedThreads = new Set<ThreadId>();
  const enqueueThread = (threadId: ThreadId) =>
    Effect.suspend(() => {
      if (queuedThreads.has(threadId)) return Effect.void;
      queuedThreads.add(threadId);
      return enqueue({ _tag: "thread", threadId });
    });

  const catchUp = Effect.gen(function* () {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const [projectSnapshot, shellSnapshot] = yield* Effect.all([
      projects.snapshot,
      threads.getShellSnapshot(),
    ]);
    const threadIds = resolveAgentAwarenessRelayActiveThreadIds({
      environmentId,
      startedAt,
      projects: projectSnapshot.projects,
      threads: shellSnapshot.threads,
    });
    yield* Effect.forEach(threadIds, enqueueThread, { discard: true });
  });

  // The relay publisher's guards against startup and transient noise.
  const updateThread = Effect.fn("ServerPush.updateThread")(function* (threadId: ThreadId) {
    if (devices.size === 0) return;
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    // Archived threads leave the card, as they do for the relay.
    const shell = yield* threads.getThreadShell(threadId);
    const thread =
      shell === null || shell.archivedAt !== null
        ? Option.none<OrchestrationV2ThreadShell>()
        : Option.some(shell);
    const project = Option.isSome(thread)
      ? yield* projects.getById(thread.value.projectId)
      : Option.none<Project>();
    const { state } = resolveAgentAwarenessRelayPublishSnapshot({
      environmentId,
      threadId,
      thread,
      project,
    });
    const previous = states.get(threadId);
    if (isTerminalState(state) && previous === undefined) {
      if (!terminalWorkSinceStart(thread, startedAt)) return;
    }
    if (agentAwarenessPublishIdentity(state) === agentAwarenessPublishIdentity(previous ?? null)) {
      confirmDeadlines.delete(threadId);
      return;
    }
    // A removed thread and a first-state completion both appear transiently
    // while the projector is mid-write; hold them until they persist.
    const requiresConfirmation =
      state === null || (state.phase === "completed" && previous === undefined);
    if (requiresConfirmation) {
      const nowMs = yield* Clock.currentTimeMillis;
      const deadline = confirmDeadlines.get(threadId);
      if (deadline === undefined) {
        confirmDeadlines.set(threadId, nowMs + CONFIRMATION_DELAY_MS);
        yield* Effect.sleep(CONFIRMATION_DELAY_MS).pipe(
          Effect.andThen(enqueueThread(threadId)),
          Effect.forkIn(scope),
        );
        return;
      }
      if (nowMs < deadline) return;
    }
    confirmDeadlines.delete(threadId);

    if (state === null) {
      states.delete(threadId);
    } else {
      states.set(threadId, state);
    }
    yield* deliver({ changedState: state, deviceIds: [...devices.keys()] });
  });

  const runJob = Effect.fn("ServerPush.runJob")(function* (job: ServerPushJob) {
    switch (job._tag) {
      case "thread":
        queuedThreads.delete(job.threadId);
        return yield* updateThread(job.threadId);
      case "register": {
        const deviceId = job.registration.deviceId;
        const firstDevice = devices.size === 0;
        devices.set(deviceId, {
          registration: job.registration,
          baseline: devices.get(deviceId)?.baseline ?? null,
        });
        yield* persistDevices;
        if (firstDevice) {
          // Thread states are not tracked while no phone listens.
          states.clear();
          confirmDeadlines.clear();
          yield* catchUp;
        }
        return yield* deliver({ changedState: null, deviceIds: [deviceId] });
      }
      case "unregister":
        if (devices.delete(job.deviceId)) yield* persistDevices;
        return;
    }
  });

  const worker = yield* makeDrainableWorker((job: ServerPushJob) =>
    runJob(job).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("server push job failed", { job: job._tag, cause: Cause.pretty(cause) }),
      ),
    ),
  );

  if (devices.size > 0) {
    yield* forkParked(catchUp.pipe(Effect.ignoreCause({ log: true })));
  }
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      devices.size > 0 && shouldPublishAgentAwarenessEvent(event)
        ? enqueueThread(event.threadId)
        : Effect.void,
    ),
  );

  return ServerPush.of({
    registerDevice: (registration) => enqueue({ _tag: "register", registration }),
    unregisterDevice: (deviceId) => enqueue({ _tag: "unregister", deviceId }),
    drain: worker.drain,
  });
});

export const layer = Layer.effect(ServerPush, make);

/** The WebSocket handlers for this module's RPCs, spread into ws.ts's handler map. */
export const makeRpcHandlers = ServerPush.pipe(
  Effect.map((serverPush) => ({
    [WS_METHODS.serverPushRegisterDevice]: (registration: ServerPushDeviceRegistration) =>
      serverPush.registerDevice(registration),
    [WS_METHODS.serverPushUnregisterDevice]: (input: { readonly deviceId: string }) =>
      serverPush.unregisterDevice(input.deviceId),
  })),
);

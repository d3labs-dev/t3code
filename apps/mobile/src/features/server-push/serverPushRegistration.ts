import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import {
  type EnvironmentId,
  type ServerPushDeviceRegistration,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";

import { MobilePreferencesStore } from "../../persistence/mobile-preferences";
import * as MobileStorage from "../../persistence/mobile-storage";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { configureAndroidAgentNotifications } from "../agent-awareness/androidNotifications";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { SERVER_PUSH_USER_ID, serverPushExpoProjectId } from "./serverPushConfig";

const REQUEST_TIMEOUT = "10 seconds";
// Removing an environment waits on this request.
const UNREGISTER_TIMEOUT = "3 seconds";

/** Which connected environments a registration round covers. */
type RegistrationTargets = ReadonlyArray<EnvironmentId> | "all";

let unregisterFromEnvironment: ((environmentId: EnvironmentId) => Promise<void>) | null = null;

/**
 * Asks an environment to stop pushing to this phone. Call it before the phone
 * forgets the environment, while the connection can still carry the request.
 */
export function unregisterServerPushDevice(environmentId: EnvironmentId): Promise<void> {
  return unregisterFromEnvironment?.(environmentId) ?? Promise.resolve();
}

const connectedSessions = Stream.unwrap(
  EnvironmentSupervisor.EnvironmentSupervisor.pipe(
    Effect.map((supervisor) => SubscriptionRef.changes(supervisor.session)),
  ),
).pipe(Stream.filter(Option.isSome));

/**
 * D3 Code fork: registers this phone with every connected environment so the
 * environment pushes agent activity itself, through Expo. Registers again on
 * each connection, app foreground, push token rotation and preference change,
 * because each can change what the environment needs to know.
 */
export const serverPushRegistrationLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const projectId = serverPushExpoProjectId();
    if (projectId === null) return;
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const storage = yield* MobileStorage.MobileStorage;
    const preferencesStore = yield* MobilePreferencesStore;
    const context = yield* Effect.context<never>();
    const rounds = yield* Queue.unbounded<RegistrationTargets>();
    let expoPushToken: string | null = null;
    let permissionRequested = false;

    // The first round may prompt; later rounds only read, so a dismissed
    // prompt does not return on every foreground.
    const notificationsGranted = Effect.gen(function* () {
      if (permissionRequested) {
        return (yield* Effect.tryPromise(() => Notifications.getPermissionsAsync())).granted;
      }
      permissionRequested = true;
      return (yield* requestAgentNotificationPermission).type === "granted";
    });

    const readExpoPushToken = Effect.gen(function* () {
      expoPushToken ??= (yield* Effect.tryPromise(() =>
        Notifications.getExpoPushTokenAsync({ projectId }),
      )).data;
      return expoPushToken;
    });

    // The settings screen's latest write, which may not have reached storage yet.
    const readPreferences = Effect.suspend(() => {
      const current = appAtomRegistry.get(mobilePreferencesAtom);
      return AsyncResult.isSuccess(current) ? Effect.succeed(current.value) : preferencesStore.load;
    });

    const makeRegistration = Effect.gen(function* () {
      const notificationsEnabled = yield* notificationsGranted;
      const [deviceId, preferences, token] = yield* Effect.all([
        storage.loadOrCreateAgentAwarenessDeviceId,
        readPreferences,
        readExpoPushToken,
      ]);
      const liveActivitiesEnabled = preferences.liveActivitiesEnabled !== false;
      configureAndroidAgentNotifications(deviceId, SERVER_PUSH_USER_ID, liveActivitiesEnabled);
      return {
        deviceId,
        userId: SERVER_PUSH_USER_ID,
        expoPushToken: token,
        preferences: {
          liveActivitiesEnabled,
          notificationsEnabled,
          notifyOnApproval: true,
          notifyOnInput: true,
          notifyOnCompletion: true,
          notifyOnFailure: true,
        },
      } satisfies ServerPushDeviceRegistration;
    });

    const runRound = Effect.fn("serverPush.register")(function* (targets: RegistrationTargets) {
      const environmentIds =
        targets === "all" ? [...(yield* SubscriptionRef.get(registry.entries)).keys()] : targets;
      if (environmentIds.length === 0) return;
      const registration = yield* makeRegistration;
      yield* Effect.forEach(
        environmentIds,
        (environmentId) =>
          registry
            .run(environmentId, request(WS_METHODS.serverPushRegisterDevice, registration))
            .pipe(
              // A disconnected environment registers once its session opens.
              Effect.catchTag("EnvironmentRpcUnavailableError", () => Effect.void),
              Effect.timeout(REQUEST_TIMEOUT),
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not register for server push.", { environmentId, cause }),
              ),
            ),
        { concurrency: "unbounded", discard: true },
      );
    });

    const unregister = (environmentId: EnvironmentId) =>
      storage.loadOrCreateAgentAwarenessDeviceId.pipe(
        Effect.flatMap((deviceId) =>
          registry.run(environmentId, request(WS_METHODS.serverPushUnregisterDevice, { deviceId })),
        ),
        Effect.timeout(UNREGISTER_TIMEOUT),
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not unregister from server push.", { environmentId, cause }),
        ),
      );

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const requestAll = () => Queue.offerUnsafe(rounds, "all");
        let liveActivitiesEnabled: boolean | undefined;
        const preferences = appAtomRegistry.subscribe(mobilePreferencesAtom, (result) => {
          if (!AsyncResult.isSuccess(result)) return;
          const next = result.value.liveActivitiesEnabled !== false;
          if (next === liveActivitiesEnabled) return;
          liveActivitiesEnabled = next;
          requestAll();
        });
        const appState = AppState.addEventListener("change", (state) => {
          if (state === "active") requestAll();
        });
        const pushToken = Notifications.addPushTokenListener(() => {
          expoPushToken = null;
          requestAll();
        });
        unregisterFromEnvironment = (environmentId) =>
          Effect.runPromiseWith(context)(unregister(environmentId));
        return { preferences, appState, pushToken };
      }),
      ({ preferences, appState, pushToken }) =>
        Effect.sync(() => {
          unregisterFromEnvironment = null;
          preferences();
          appState.remove();
          pushToken.remove();
        }),
    );

    const followedEnvironments = new Set<EnvironmentId>();
    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach((entries) =>
        Effect.forEach(
          [...entries.keys()].filter((environmentId) => !followedEnvironments.has(environmentId)),
          (environmentId) => {
            followedEnvironments.add(environmentId);
            return registry.followStream(environmentId, connectedSessions).pipe(
              Stream.runForEach(() => Queue.offer(rounds, [environmentId])),
              Effect.forkScoped,
            );
          },
          { discard: true },
        ),
      ),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(rounds).pipe(
      Stream.runForEach((targets) =>
        runRound(targets).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not prepare server push registration.", cause),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);

import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RelayAgentAwarenessPreferences } from "./relay.ts";

/** D3 Code fork: the environment itself pushes agent activity to phones through Expo. */
export const SERVER_PUSH_WS_METHODS = {
  serverPushRegisterDevice: "serverPush.registerDevice",
  serverPushUnregisterDevice: "serverPush.unregisterDevice",
} as const;

export const ServerPushDeviceRegistration = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
  userId: TrimmedNonEmptyString,
  expoPushToken: TrimmedNonEmptyString,
  preferences: RelayAgentAwarenessPreferences,
});
export type ServerPushDeviceRegistration = typeof ServerPushDeviceRegistration.Type;

export const ServerPushUnregisterDeviceInput = Schema.Struct({
  deviceId: TrimmedNonEmptyString,
});
export type ServerPushUnregisterDeviceInput = typeof ServerPushUnregisterDeviceInput.Type;

export const WsServerPushRegisterDeviceRpc = Rpc.make(
  SERVER_PUSH_WS_METHODS.serverPushRegisterDevice,
  {
    payload: ServerPushDeviceRegistration,
    error: EnvironmentAuthorizationError,
  },
);

export const WsServerPushUnregisterDeviceRpc = Rpc.make(
  SERVER_PUSH_WS_METHODS.serverPushUnregisterDevice,
  {
    payload: ServerPushUnregisterDeviceInput,
    error: EnvironmentAuthorizationError,
  },
);

import { AuthOrchestrationReadScope, SERVER_PUSH_WS_METHODS } from "@t3tools/contracts";

// A phone asking for pushes about work it can already read needs no more than read access.
export const SERVER_PUSH_RPC_SCOPES = {
  [SERVER_PUSH_WS_METHODS.serverPushRegisterDevice]: AuthOrchestrationReadScope,
  [SERVER_PUSH_WS_METHODS.serverPushUnregisterDevice]: AuthOrchestrationReadScope,
} as const;

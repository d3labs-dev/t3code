import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * The identity servers stamp on their pushes. The phone's native handler drops
 * any push whose identity differs from the one it was configured with.
 */
export const SERVER_PUSH_USER_ID = "server-push";

/**
 * D3 Code fork: the Expo project that delivers pushes from the user's own
 * servers. Null, and server push stays off, until the build names one.
 */
export function serverPushExpoProjectId(): string | null {
  if (Platform.OS !== "android") return null;
  const projectId: unknown = Constants.expoConfig?.extra?.serverPush?.expoProjectId;
  return typeof projectId === "string" && projectId.trim().length > 0 ? projectId.trim() : null;
}

/** Server push owns the phone's notification identity, so the relay must not reconfigure it. */
export function isServerPushEnabled(): boolean {
  return serverPushExpoProjectId() !== null;
}

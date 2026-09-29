import type { DesktopMascotMood } from "@t3tools/contracts";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

interface LauncherMoodModule {
  /** Applied the next time the app leaves the foreground. */
  setLauncherMood(mood: DesktopMascotMood): void;
}

/** Only the D3 Code (preview) Android build declares the mood launcher icons. */
export const launcherMoodModule =
  Platform.OS === "android" && Constants.expoConfig?.extra?.appVariant === "preview"
    ? requireOptionalNativeModule<LauncherMoodModule>("T3LauncherMood")
    : null;

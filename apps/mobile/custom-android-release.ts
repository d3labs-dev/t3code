import type { ExpoConfig } from "expo/config";

// Google Play's ceiling; Android itself accepts any positive 32-bit integer.
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
// .github/workflows/custom-nightly.yml publishes to this channel.
const CUSTOM_UPDATE_CHANNEL = "custom-nightly";

/**
 * Gives the D3 Code (preview) build its mood launcher icons, and turns the
 * build into this fork's sideloaded Android release when
 * `T3CODE_ANDROID_UPDATE_RELEASES_URL` points at the GitHub releases API
 * listing its APKs. Once `T3CODE_EXPO_PROJECT_ID` names the fork's Expo
 * project, that release also takes over-the-air updates from it. Lives outside
 * app.config.ts so upstream merges stay clean.
 */
function withSideloadedRelease(
  baseConfig: ExpoConfig,
  env: Readonly<Record<string, string | undefined>>,
): ExpoConfig {
  const config: ExpoConfig =
    baseConfig.extra?.appVariant === "preview"
      ? {
          ...baseConfig,
          plugins: [...(baseConfig.plugins ?? []), "./plugins/withAndroidLauncherMoods.cjs"],
        }
      : baseConfig;
  const releasesUrl = env.T3CODE_ANDROID_UPDATE_RELEASES_URL?.trim();
  if (!releasesUrl) return config;

  if (!URL.canParse(releasesUrl) || !/^https?:$/.test(new URL(releasesUrl).protocol)) {
    throw new Error("T3CODE_ANDROID_UPDATE_RELEASES_URL must be an http(s) URL.");
  }
  const versionCode = Number(env.T3CODE_ANDROID_VERSION_CODE);
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > MAX_ANDROID_VERSION_CODE
  ) {
    throw new Error(
      `T3CODE_ANDROID_VERSION_CODE must be an integer from 1 to ${MAX_ANDROID_VERSION_CODE}.`,
    );
  }
  const versionName = env.T3CODE_ANDROID_VERSION_NAME?.trim();
  if (!versionName) {
    throw new Error("T3CODE_ANDROID_VERSION_NAME is required for a custom Android release.");
  }

  const expoProjectId = env.T3CODE_EXPO_PROJECT_ID?.trim();
  // Upstream's over-the-air bundles must never replace the fork's JavaScript,
  // so updates come from the fork's own Expo project or not at all.
  const { owner: _upstreamOwner, ...forkConfig } = config;
  return {
    ...forkConfig,
    version: versionName,
    updates: expoProjectId
      ? {
          ...config.updates,
          url: `https://u.expo.dev/${expoProjectId}`,
          requestHeaders: { "expo-channel-name": CUSTOM_UPDATE_CHANNEL },
        }
      : { ...config.updates, enabled: false },
    android: {
      ...config.android,
      versionCode,
      permissions: [
        ...(config.android?.permissions ?? []),
        "android.permission.REQUEST_INSTALL_PACKAGES",
      ],
    },
    extra: {
      ...config.extra,
      apkUpdates: { releasesUrl },
      eas: { ...config.extra?.eas, projectId: expoProjectId ?? config.extra?.eas?.projectId },
    },
  };
}

/** Lets the app register for server push once `T3CODE_EXPO_PROJECT_ID` names its Expo project. */
function withServerPush(
  config: ExpoConfig,
  env: Readonly<Record<string, string | undefined>>,
): ExpoConfig {
  const expoProjectId = env.T3CODE_EXPO_PROJECT_ID?.trim();
  return expoProjectId
    ? { ...config, extra: { ...config.extra, serverPush: { expoProjectId } } }
    : config;
}

export function withCustomAndroidRelease(
  config: ExpoConfig,
  env: Readonly<Record<string, string | undefined>>,
): ExpoConfig {
  return withServerPush(withSideloadedRelease(config, env), env);
}

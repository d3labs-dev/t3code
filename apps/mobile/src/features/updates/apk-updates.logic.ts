import type { ExpoConfig } from "expo/config";
import * as Schema from "effect/Schema";

export interface ApkRelease {
  readonly versionCode: number;
  readonly versionName: string;
  readonly downloadUrl: string;
  readonly sizeBytes: number;
}

export interface InstalledApk {
  readonly versionCode: number;
  /** Null when over-the-air updates are off, so every newer APK is offered. */
  readonly runtimeVersion: string | null;
}

export interface ApkUpdateConfig {
  readonly releasesUrl: string;
  readonly installed: InstalledApk;
}

const GitHubReleases = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    body: Schema.NullOr(Schema.String),
    assets: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        state: Schema.String,
        size: Schema.Number,
        browser_download_url: Schema.String,
      }),
    ),
  }),
);

export type GitHubReleases = typeof GitHubReleases.Type;

export const decodeGitHubReleases = Schema.decodeUnknownSync(GitHubReleases);

// Written into the release notes by .github/workflows/custom-nightly.yml.
const VERSION_CODE_MARKER = /<!-- android-version-code: (\d+) -->/;
// Only present once the release's JavaScript was published over the air.
const RUNTIME_VERSION_MARKER = /<!-- android-runtime-version: (\S+) -->/;

/** Set by custom-android-release.ts only in the fork's sideloaded Android builds. */
export function resolveApkUpdateConfig({
  expoConfig,
  runtimeVersion,
}: {
  readonly expoConfig: Pick<ExpoConfig, "android" | "extra"> | null | undefined;
  readonly runtimeVersion: string | null;
}): ApkUpdateConfig | null {
  const releasesUrl: unknown = expoConfig?.extra?.apkUpdates?.releasesUrl;
  const versionCode = expoConfig?.android?.versionCode;
  if (typeof releasesUrl !== "string" || versionCode === undefined) return null;
  return { releasesUrl, installed: { versionCode, runtimeVersion } };
}

/**
 * Picks the highest-versioned APK newer than the installed one. Android refuses
 * to install a lower versionCode, so that number alone decides what is newer.
 * A release published over the air for the installed runtime arrives without
 * an install, so its APK is never offered.
 */
export function findNewerApkRelease(
  releases: GitHubReleases,
  installed: InstalledApk,
): ApkRelease | undefined {
  let newest: ApkRelease | undefined;
  for (const release of releases) {
    const marker = release.body?.match(VERSION_CODE_MARKER);
    const apk = release.assets.find(
      (asset) => asset.state === "uploaded" && asset.name.endsWith(".apk"),
    );
    if (!marker?.[1] || !apk) continue;
    const runtimeVersion = release.body?.match(RUNTIME_VERSION_MARKER)?.[1];
    if (runtimeVersion !== undefined && runtimeVersion === installed.runtimeVersion) continue;
    const versionCode = Number(marker[1]);
    if (versionCode <= (newest?.versionCode ?? installed.versionCode)) continue;
    newest = {
      versionCode,
      versionName: release.tag_name.replace(/^v/, ""),
      downloadUrl: apk.browser_download_url,
      sizeBytes: apk.size,
    };
  }
  return newest;
}

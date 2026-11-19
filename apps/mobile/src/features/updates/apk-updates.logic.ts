import type { ExpoConfig } from "expo/config";
import * as Schema from "effect/Schema";

export interface ApkRelease {
  readonly versionCode: number;
  readonly versionName: string;
  readonly downloadUrl: string;
  readonly sizeBytes: number;
}

export interface ApkUpdateConfig {
  readonly releasesUrl: string;
  readonly installedVersionCode: number;
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

/** Set by custom-android-release.ts only in the fork's sideloaded Android builds. */
export function resolveApkUpdateConfig(
  expoConfig: Pick<ExpoConfig, "android" | "extra"> | null | undefined,
): ApkUpdateConfig | null {
  const releasesUrl: unknown = expoConfig?.extra?.apkUpdates?.releasesUrl;
  const installedVersionCode = expoConfig?.android?.versionCode;
  if (typeof releasesUrl !== "string" || installedVersionCode === undefined) return null;
  return { releasesUrl, installedVersionCode };
}

/**
 * Picks the highest-versioned APK newer than the installed one. Android refuses
 * to install a lower versionCode, so that number alone decides what is newer.
 */
export function findNewerApkRelease(
  releases: GitHubReleases,
  installedVersionCode: number,
): ApkRelease | undefined {
  let newest: ApkRelease | undefined;
  for (const release of releases) {
    const marker = release.body?.match(VERSION_CODE_MARKER);
    const apk = release.assets.find(
      (asset) => asset.state === "uploaded" && asset.name.endsWith(".apk"),
    );
    if (!marker?.[1] || !apk) continue;
    const versionCode = Number(marker[1]);
    if (versionCode <= (newest?.versionCode ?? installedVersionCode)) continue;
    newest = {
      versionCode,
      versionName: release.tag_name.replace(/^v/, ""),
      downloadUrl: apk.browser_download_url,
      sizeBytes: apk.size,
    };
  }
  return newest;
}

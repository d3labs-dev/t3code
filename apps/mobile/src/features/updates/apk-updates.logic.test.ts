import { describe, expect, it } from "vite-plus/test";

import {
  decodeGitHubReleases,
  findNewerApkRelease,
  resolveApkUpdateConfig,
} from "./apk-updates.logic";

function release(options: {
  readonly tag: string;
  readonly versionCode?: number;
  readonly runtimeVersion?: string;
  readonly assets?: ReadonlyArray<{ readonly name: string; readonly state?: string }>;
}) {
  return {
    tag_name: options.tag,
    body: [
      "Automated custom build.",
      options.versionCode === undefined
        ? undefined
        : `<!-- android-version-code: ${options.versionCode} -->`,
      options.runtimeVersion === undefined
        ? undefined
        : `<!-- android-runtime-version: ${options.runtimeVersion} -->`,
    ]
      .filter((line) => line !== undefined)
      .join("\n\n"),
    assets: (options.assets ?? [{ name: `T3-Code-${options.tag}-android-arm64.apk` }]).map(
      (asset) => ({
        name: asset.name,
        state: asset.state ?? "uploaded",
        size: 1234,
        browser_download_url: `https://github.com/owner/repo/releases/download/${options.tag}/${asset.name}`,
        uploader: { login: "ignored" },
      }),
    ),
    draft: false,
  };
}

describe("findNewerApkRelease", () => {
  it("offers the highest version code above the installed one", () => {
    const releases = decodeGitHubReleases([
      release({ tag: "v0.0.44-nightly.3", versionCode: 300 }),
      release({ tag: "v0.0.44-nightly.5", versionCode: 500 }),
      release({ tag: "v0.0.44-nightly.4", versionCode: 400 }),
    ]);

    expect(findNewerApkRelease(releases, { versionCode: 350, runtimeVersion: null })).toEqual({
      versionCode: 500,
      versionName: "0.0.44-nightly.5",
      downloadUrl:
        "https://github.com/owner/repo/releases/download/v0.0.44-nightly.5/T3-Code-v0.0.44-nightly.5-android-arm64.apk",
      sizeBytes: 1234,
    });
  });

  it("reports nothing when the installed build is the newest", () => {
    const releases = decodeGitHubReleases([release({ tag: "v1", versionCode: 500 })]);

    expect(
      findNewerApkRelease(releases, { versionCode: 500, runtimeVersion: null }),
    ).toBeUndefined();
  });

  it("leaves releases published over the air for the installed runtime to that update", () => {
    const releases = decodeGitHubReleases([
      release({ tag: "v-native", versionCode: 400, runtimeVersion: "fingerprint-b" }),
      release({ tag: "v-ota", versionCode: 500, runtimeVersion: "fingerprint-a" }),
      release({ tag: "v-ota-failed", versionCode: 300 }),
    ]);

    expect(
      findNewerApkRelease(releases, { versionCode: 100, runtimeVersion: "fingerprint-a" })
        ?.versionName,
    ).toBe("-native");
    expect(
      findNewerApkRelease(releases, { versionCode: 100, runtimeVersion: null })?.versionName,
    ).toBe("-ota");
  });

  it("skips releases whose Android build is missing, unfinished, or unmarked", () => {
    const releases = decodeGitHubReleases([
      release({ tag: "v-macos-only", versionCode: 900, assets: [{ name: "T3-Code-arm64.dmg" }] }),
      release({
        tag: "v-uploading",
        versionCode: 800,
        assets: [{ name: "T3-Code-android-arm64.apk", state: "starter" }],
      }),
      release({ tag: "v-unmarked" }),
      release({ tag: "v-ready", versionCode: 600 }),
    ]);

    expect(
      findNewerApkRelease(releases, { versionCode: 1, runtimeVersion: null })?.versionName,
    ).toBe("-ready");
  });
});

describe("resolveApkUpdateConfig", () => {
  it("requires both the releases URL and the installed version code", () => {
    const releasesUrl = "https://api.github.com/repos/owner/repo/releases";
    const runtimeVersion = "fingerprint-a";
    expect(
      resolveApkUpdateConfig({
        expoConfig: { android: { versionCode: 7 }, extra: { apkUpdates: { releasesUrl } } },
        runtimeVersion,
      }),
    ).toEqual({ releasesUrl, installed: { versionCode: 7, runtimeVersion } });
    expect(
      resolveApkUpdateConfig({
        expoConfig: { android: { versionCode: 7 }, extra: {} },
        runtimeVersion,
      }),
    ).toBeNull();
    expect(
      resolveApkUpdateConfig({
        expoConfig: { extra: { apkUpdates: { releasesUrl } } },
        runtimeVersion,
      }),
    ).toBeNull();
  });
});

import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { useSyncExternalStore } from "react";
import { Alert, AppState, Platform } from "react-native";

import {
  type AtomCommandResult,
  reportAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { defaultFlushPendingWrites, shouldRecheckAppUpdateOnForeground } from "./app-updates";
import {
  type ApkRelease,
  decodeGitHubReleases,
  findNewerApkRelease,
  resolveApkUpdateConfig,
} from "./apk-updates.logic";

export type ApkUpdateState =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "current" }
  | { readonly status: "available"; readonly release: ApkRelease }
  | { readonly status: "downloading"; readonly release: ApkRelease; readonly percent: number }
  | { readonly status: "installing"; readonly release: ApkRelease };

const config = Platform.OS === "android" ? resolveApkUpdateConfig(Constants.expoConfig) : null;
const downloadDirectory = new Directory(Paths.cache, "apk-updates");
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export const apkUpdatesEnabled = config !== null;

let state: ApkUpdateState = { status: "idle" };
const listeners = new Set<() => void>();
let promptedVersionCode: number | undefined;
let automaticChecksStarted = false;

function setState(next: ApkUpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): ApkUpdateState {
  return state;
}

export function useApkUpdateState(): ApkUpdateState {
  return useSyncExternalStore(subscribe, getState, getState);
}

function isBusy(current: ApkUpdateState): boolean {
  return (
    current.status === "checking" ||
    current.status === "downloading" ||
    current.status === "installing"
  );
}

/**
 * Checks at launch and after the app returns from a long backgrounding, with
 * the same cadence as the over-the-air check it replaces in these builds.
 */
export function startApkUpdateChecks(): void {
  if (!config || automaticChecksStarted) return;
  automaticChecksStarted = true;
  // Nothing installs at launch, so any APK left here is from a finished or abandoned update.
  if (downloadDirectory.exists) downloadDirectory.delete();
  void checkForApkUpdate("automatic");

  let backgroundedAtMs: number | null = null;
  AppState.addEventListener("change", (appState) => {
    if (appState === "background") {
      backgroundedAtMs = Date.now();
      return;
    }
    if (appState !== "active") return;
    const shouldCheck = shouldRecheckAppUpdateOnForeground(backgroundedAtMs, Date.now(), false);
    backgroundedAtMs = null;
    if (shouldCheck) void checkForApkUpdate("automatic");
  });
}

/** Automatic checks prompt once per release and fail quietly; manual ones report failures. */
export async function checkForApkUpdate(trigger: "automatic" | "manual"): Promise<void> {
  if (!config || isBusy(state)) return;
  const previous = state;
  setState({ status: "checking" });

  const result = await settlePromise(async () => {
    const response = await fetch(`${config.releasesUrl}?per_page=10`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub responded with HTTP ${response.status}.`);
    return findNewerApkRelease(
      decodeGitHubReleases(await response.json()),
      config.installedVersionCode,
    );
  });

  if (result._tag === "Failure") {
    setState(previous.status === "available" ? previous : { status: "idle" });
    reportFailure(result, trigger === "manual" ? "Update check failed" : undefined);
    return;
  }
  const release = result.value;
  if (!release) {
    setState({ status: "current" });
    return;
  }
  setState({ status: "available", release });
  if (trigger === "automatic" && promptedVersionCode !== release.versionCode) {
    promptedVersionCode = release.versionCode;
    Alert.alert(
      "Update available",
      `T3 Code ${release.versionName} is ready to download (${formatMegabytes(release.sizeBytes)}). The installer opens when the download finishes.`,
      [
        { style: "cancel", text: "Later" },
        { onPress: () => void installApkUpdate(release), text: "Update" },
      ],
    );
  }
}

/** Android asks the user to confirm; a confirmed install replaces this process. */
export async function installApkUpdate(release: ApkRelease): Promise<void> {
  if (isBusy(state)) return;
  setState({ status: "downloading", release, percent: 0 });

  const result = await settlePromise(async () => {
    const apk = await downloadApk(release);
    setState({ status: "installing", release });
    const flushed = await settlePromise(defaultFlushPendingWrites);
    // The user asked for this install, so a failed flush is reported but does not block it.
    reportFailure(flushed, undefined);
    await waitUntilForeground();
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: apk.contentUri,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      type: APK_MIME_TYPE,
    });
  });

  // Reaching this point means the installer was dismissed or failed; offer the update again.
  setState({ status: "available", release });
  reportFailure(result, "Update failed");
}

/**
 * Android blocks background apps from opening the installer and reports the
 * blocked launch as a dismissal, so the installer opens once the user is back.
 */
function waitUntilForeground(): Promise<void> {
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve) => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState !== "active") return;
      subscription.remove();
      resolve();
    });
  });
}

async function downloadApk(release: ApkRelease): Promise<File> {
  downloadDirectory.create({ idempotent: true });
  let percent = 0;
  return File.downloadFileAsync(release.downloadUrl, new File(downloadDirectory, "update.apk"), {
    idempotent: true,
    onProgress: ({ bytesWritten }) => {
      const nextPercent = Math.floor((bytesWritten / release.sizeBytes) * 100);
      if (nextPercent === percent) return;
      percent = nextPercent;
      setState({ status: "downloading", release, percent });
    },
  });
}

export function formatMegabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

function reportFailure(
  result: AtomCommandResult<unknown, unknown>,
  alertTitle: string | undefined,
): void {
  if (result._tag !== "Failure") return;
  reportAtomCommandResult(result, { label: "android apk update" });
  if (!alertTitle) return;
  const error = squashAtomCommandFailure(result);
  Alert.alert(alertTitle, error instanceof Error ? error.message : "Something went wrong.");
}

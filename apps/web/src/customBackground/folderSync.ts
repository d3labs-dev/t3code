import type { CustomBackgroundImageId } from "@t3tools/contracts";

import {
  ensureClientSettingsHydrated,
  getClientSettings,
  persistClientSettingsUpdate,
} from "~/hooks/useSettings";

import { listBackgroundImageIds, storeBackgroundImages } from "./imageStore";
import { syncBackgroundFolder } from "./records";

export type BackgroundFolderSyncResult =
  | { status: "synced"; pictures: number; imported: number; failed: number }
  | { status: "missing" };

function folderBridge() {
  const bridge = window.desktopBridge;
  if (
    !bridge?.pickBackgroundFolder ||
    !bridge.listBackgroundFolder ||
    !bridge.readBackgroundFolderImage
  ) {
    return null;
  }
  return {
    pick: bridge.pickBackgroundFolder,
    list: bridge.listBackgroundFolder,
    read: bridge.readBackgroundFolderImage,
  };
}

/** Only the desktop app can read a folder again later; browsers import a folder once. */
export function canSyncBackgroundFolders(): boolean {
  return typeof window !== "undefined" && folderBridge() !== null;
}

export function pickBackgroundFolder(): Promise<string | null> {
  return folderBridge()?.pick() ?? Promise.resolve(null);
}

export function backgroundFolderName(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? path;
}

const inFlight = new Map<string, Promise<BackgroundFolderSyncResult>>();

async function runSync(
  backgroundId: string,
  path: string,
  onProgress: (done: number, total: number) => void,
): Promise<BackgroundFolderSyncResult> {
  const bridge = folderBridge();
  const listed = await bridge?.list(path);
  if (!bridge || !listed) return { status: "missing" };
  const known = await listBackgroundImageIds();
  const missing = [...new Map(listed.map((image) => [image.id, image])).values()].filter(
    (image) => !known.has(image.id),
  );
  let done = 0;
  onProgress(done, missing.length);
  const results = await storeBackgroundImages(
    missing.map(
      (image) => () =>
        bridge.read(image.path).then(
          (bytes) =>
            new File([new Uint8Array(bytes)], backgroundFolderName(image.path), {
              type: image.type,
            }),
        ),
    ),
    () => onProgress(++done, missing.length),
  );
  const stored = new Set(results.flatMap((result) => (result.ok ? [result.image.id] : [])));
  const imageIds: Array<CustomBackgroundImageId> = [
    ...new Set(listed.map((image) => image.id).filter((id) => known.has(id) || stored.has(id))),
  ];
  // A folder unlinked, or a playlist deleted, while its pictures imported stays that way.
  await persistClientSettingsUpdate((current) => ({
    ...current,
    customBackgrounds: current.customBackgrounds.map((record) =>
      record.id === backgroundId && record.folders.some((folder) => folder.path === path)
        ? syncBackgroundFolder(record, { path, imageIds })
        : record,
    ),
  }));
  return {
    status: "synced",
    pictures: imageIds.length,
    imported: stored.size,
    failed: results.length - stored.size,
  };
}

/** Brings a playlist's linked folder up to date; overlapping calls for one folder share a run. */
export function syncBackgroundFolderNow({
  backgroundId,
  path,
  onProgress = () => {},
}: {
  backgroundId: string;
  path: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<BackgroundFolderSyncResult> {
  const key = `${backgroundId}\n${path}`;
  const running = inFlight.get(key);
  if (running) return running;
  const run = runSync(backgroundId, path, onProgress).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

export async function linkBackgroundFolder(input: {
  backgroundId: string;
  path: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<BackgroundFolderSyncResult> {
  await persistClientSettingsUpdate((current) => ({
    ...current,
    customBackgrounds: current.customBackgrounds.map((record) =>
      record.id === input.backgroundId &&
      !record.folders.some((folder) => folder.path === input.path)
        ? { ...record, folders: [...record.folders, { path: input.path, imageIds: [] }] }
        : record,
    ),
  }));
  return syncBackgroundFolderNow(input);
}

let launchSync: Promise<void> | null = null;

/** Catches every linked folder up with what changed on disk while the app was closed. */
export function syncBackgroundFoldersOnLaunch(): Promise<void> {
  launchSync ??= (async () => {
    if (!canSyncBackgroundFolders()) return;
    await ensureClientSettingsHydrated();
    const settings = getClientSettings();
    if (!settings.customBackgroundEnabled) return;
    for (const record of settings.customBackgrounds) {
      for (const folder of record.folders) {
        await syncBackgroundFolderNow({ backgroundId: record.id, path: folder.path });
      }
    }
  })().catch(() => undefined);
  return launchSync;
}

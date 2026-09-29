import { sha256 } from "@noble/hashes/sha2";
import type { CustomBackgroundImageId } from "@t3tools/contracts";
import type { PictureTone } from "@t3tools/shared/customBackgroundBrightness";
import { useSyncExternalStore } from "react";

import { type ImageCompressionFailureReason, reencodeImage } from "~/lib/imageCompression";

import { sourceColorFromImage, toneFromImage } from "./sourceColor";

const DATABASE_NAME = "t3code:custom-backgrounds";
const DATABASE_VERSION = 3;
const IMAGES_STORE = "images";

/** 4K covers the widest display anyone runs this on without upscaling the picture. */
const CUSTOM_BACKGROUND_IMAGE_MAX_DIMENSION = 4096;
/**
 * Roomy enough that a 4K WebP never trips the encoder's fallback scales, which
 * would quietly undo the dimension cap, and tight enough that a lossless
 * upload re-encodes instead of parking tens of megabytes per image.
 */
const CUSTOM_BACKGROUND_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Paper uploads a shader's source as a texture at its natural size, and the
 * dithering canvas never draws more than BackgroundRenderer's MAX_PIXEL_COUNT.
 * Handing it the 4K copy would hold several times the VRAM to render pixels
 * the filter throws away, and blows past the texture ceiling on weak GPUs.
 */
const SHADER_MAX_DIMENSION = 1920;
const SHADER_MAX_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_MAX_DIMENSION = 256;
const THUMBNAIL_MAX_BYTES = 200 * 1024;

const IMAGE_RENDITIONS = {
  full: {
    maxDimension: CUSTOM_BACKGROUND_IMAGE_MAX_DIMENSION,
    maxBytes: CUSTOM_BACKGROUND_IMAGE_MAX_BYTES,
  },
  shader: { maxDimension: SHADER_MAX_DIMENSION, maxBytes: SHADER_MAX_BYTES },
  thumbnail: { maxDimension: THUMBNAIL_MAX_DIMENSION, maxBytes: THUMBNAIL_MAX_BYTES },
} as const;

export const CUSTOM_BACKGROUND_ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export interface StoredBackgroundImage {
  readonly id: CustomBackgroundImageId;
  readonly full: Blob;
  readonly shader: Blob;
  readonly thumbnail: Blob;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  /** Material seed color scored from the picture; null when it scored nothing. */
  readonly sourceColor: number | null;
  readonly createdAt: string;
}

export type StoreBackgroundImageResult =
  | { ok: true; image: StoredBackgroundImage; existed: boolean }
  | { ok: false; reason: ImageCompressionFailureReason | "quota" | "unavailable" | "unreadable" };

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("IndexedDB is unavailable in this browser context."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      // Renditions are derived from an original this store never kept, so a
      // shape change starts the library over rather than migrating it.
      if (request.result.objectStoreNames.contains(IMAGES_STORE)) {
        request.result.deleteObjectStore(IMAGES_STORE);
      }
      request.result.createObjectStore(IMAGES_STORE, { keyPath: "id" });
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Could not open the background image store."));
    });
    request.addEventListener("success", () => {
      const database = request.result;
      // A version bump from another tab closes this connection; drop the
      // cache so the next call reopens instead of failing forever.
      database.addEventListener("versionchange", () => {
        database.close();
        databasePromise = null;
      });
      resolve(database);
    });
  });
  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB error")));
    request.addEventListener("success", () => resolve(request.result));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction error")),
    );
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
    transaction.addEventListener("complete", () => resolve());
  });
}

function isStoredBackgroundImage(value: unknown): value is StoredBackgroundImage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.full instanceof Blob &&
    candidate.shader instanceof Blob &&
    candidate.thumbnail instanceof Blob &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.byteLength === "number" &&
    (candidate.sourceColor === null || typeof candidate.sourceColor === "number") &&
    typeof candidate.createdAt === "string"
  );
}

async function readBackgroundImage(
  id: CustomBackgroundImageId,
): Promise<StoredBackgroundImage | null> {
  const database = await openDatabase();
  const value = await requestToPromise(
    database.transaction(IMAGES_STORE, "readonly").objectStore(IMAGES_STORE).get(id),
  );
  return isStoredBackgroundImage(value) ? value : null;
}

async function writeImage(image: StoredBackgroundImage): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(IMAGES_STORE, "readwrite");
  transaction.objectStore(IMAGES_STORE).put(image);
  await transactionDone(transaction);
}

export async function listBackgroundImages(): Promise<ReadonlyArray<StoredBackgroundImage>> {
  if (!hasIndexedDb()) return [];
  const database = await openDatabase();
  const values = await requestToPromise(
    database.transaction(IMAGES_STORE, "readonly").objectStore(IMAGES_STORE).getAll(),
  );
  return values
    .filter(isStoredBackgroundImage)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function listBackgroundImageIds(): Promise<ReadonlySet<string>> {
  if (!hasIndexedDb()) return new Set();
  const database = await openDatabase();
  const keys = await requestToPromise(
    database.transaction(IMAGES_STORE, "readonly").objectStore(IMAGES_STORE).getAllKeys(),
  );
  return new Set(keys.filter((key) => typeof key === "string"));
}

export async function deleteBackgroundImage(id: CustomBackgroundImageId): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(IMAGES_STORE, "readwrite");
  transaction.objectStore(IMAGES_STORE).delete(id);
  await transactionDone(transaction);
  for (const variant of URL_VARIANTS) releaseUrl(id, variant);
  sourceColorStates.delete(id);
  toneStates.delete(id);
  emitUrlChange();
  emitStoreChange();
}

async function hashBackgroundImageFile(file: Blob): Promise<CustomBackgroundImageId> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

let persistenceRequested = false;

function requestPersistentStorage(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  void navigator.storage.persist().catch(() => undefined);
}

export async function storeBackgroundImage(file: File): Promise<StoreBackgroundImageResult> {
  if (!hasIndexedDb()) return { ok: false, reason: "unavailable" };
  const id = await hashBackgroundImageFile(file);
  try {
    const existing = await readBackgroundImage(id);
    if (existing) {
      refreshImageUrls(existing);
      return { ok: true, image: existing, existed: true };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const encoded = await reencodeImage(file, IMAGE_RENDITIONS);
  if (!encoded.ok) return encoded;

  const { full, shader, thumbnail } = encoded.images;
  const image: StoredBackgroundImage = {
    id,
    full: full.blob,
    shader: shader.blob,
    thumbnail: thumbnail.blob,
    width: full.width,
    height: full.height,
    byteLength: full.blob.size,
    sourceColor: await sourceColorFromImage(thumbnail.blob),
    createdAt: new Date().toISOString(),
  };
  try {
    await writeImage(image);
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? "quota" : "unavailable" };
  }
  requestPersistentStorage();
  refreshImageUrls(image);
  emitStoreChange();
  return { ok: true, image, existed: false };
}

const STORE_CONCURRENCY = 4;

/**
 * Stores pictures a few at a time; each decode holds a full bitmap in memory,
 * so the pool stays small. Pictures load only when their turn comes, and
 * results keep the input order.
 */
export async function storeBackgroundImages(
  loads: ReadonlyArray<() => Promise<File>>,
  onSettled: () => void,
): Promise<Array<StoreBackgroundImageResult>> {
  const results: Array<StoreBackgroundImageResult> = [];
  let next = 0;
  const worker = async () => {
    while (next < loads.length) {
      const index = next;
      next += 1;
      results[index] = await loads[index]!().then(storeBackgroundImage, () => ({
        ok: false as const,
        reason: "unreadable" as const,
      }));
      onSettled();
    }
  };
  await Promise.all(Array.from({ length: Math.min(STORE_CONCURRENCY, loads.length) }, worker));
  return results;
}

type UrlVariant = keyof typeof IMAGE_RENDITIONS;
const URL_VARIANTS = Object.keys(IMAGE_RENDITIONS) as ReadonlyArray<UrlVariant>;

type UrlState = { status: "loading" } | { status: "ready"; url: string } | { status: "missing" };

const urlStates = new Map<string, UrlState>();
// URL resolutions and store writes notify different consumers: a resolved
// thumbnail should not make every image list refetch.
const urlListeners = new Set<() => void>();
const storeListeners = new Set<() => void>();

function urlKey(id: CustomBackgroundImageId, variant: UrlVariant): string {
  return `${variant}:${id}`;
}

function emitUrlChange(): void {
  for (const listener of urlListeners) listener();
}

function emitStoreChange(): void {
  for (const listener of storeListeners) listener();
}

function releaseUrl(id: CustomBackgroundImageId, variant: UrlVariant): void {
  const key = urlKey(id, variant);
  const state = urlStates.get(key);
  if (state?.status === "ready") URL.revokeObjectURL(state.url);
  urlStates.delete(key);
}

// Repair missing or in-flight lookups after a successful upload, including a
// deduplicated upload following a transient read failure. Keep healthy URLs stable.
function refreshImageUrls(image: StoredBackgroundImage): void {
  for (const variant of URL_VARIANTS) {
    const key = urlKey(image.id, variant);
    const state = urlStates.get(key);
    if (!state || state.status === "ready") continue;
    urlStates.set(key, { status: "ready", url: URL.createObjectURL(image[variant]) });
  }
  sourceColorStates.set(image.id, { status: "ready", sourceColor: image.sourceColor });
  emitUrlChange();
}

function subscribeUrls(listener: () => void): () => void {
  urlListeners.add(listener);
  return () => {
    urlListeners.delete(listener);
  };
}

function ensureUrl(id: CustomBackgroundImageId, variant: UrlVariant): UrlState {
  const key = urlKey(id, variant);
  const cached = urlStates.get(key);
  if (cached) return cached;
  const loading: UrlState = { status: "loading" };
  urlStates.set(key, loading);
  void readBackgroundImage(id)
    .then((image) => {
      // A delete that raced the read already cleared the slot; leave it.
      if (urlStates.get(key) !== loading) return;
      urlStates.set(
        key,
        image
          ? { status: "ready", url: URL.createObjectURL(image[variant]) }
          : { status: "missing" },
      );
    })
    .catch(() => {
      if (urlStates.get(key) === loading) urlStates.set(key, { status: "missing" });
    })
    .finally(emitUrlChange);
  return loading;
}

/** Resolves an image id to an object URL; `null` while loading, `false` when the image is gone. */
export function useBackgroundImageUrl(
  id: CustomBackgroundImageId | null,
  variant: UrlVariant = "full",
): string | null | false {
  return useSyncExternalStore(
    subscribeUrls,
    () => {
      if (id === null) return false;
      const state = ensureUrl(id, variant);
      return state.status === "ready" ? state.url : state.status === "missing" ? false : null;
    },
    () => null,
  );
}

type SourceColorState = { status: "loading" } | { status: "ready"; sourceColor: number | null };

const sourceColorStates = new Map<CustomBackgroundImageId, SourceColorState>();

function ensureSourceColor(id: CustomBackgroundImageId): SourceColorState {
  const cached = sourceColorStates.get(id);
  if (cached) return cached;
  const loading: SourceColorState = { status: "loading" };
  sourceColorStates.set(id, loading);
  const settle = (sourceColor: number | null) => {
    // A delete that raced the read already cleared the slot; leave it.
    if (sourceColorStates.get(id) === loading) {
      sourceColorStates.set(id, { status: "ready", sourceColor });
    }
  };
  void readBackgroundImage(id)
    .then((image) => settle(image?.sourceColor ?? null))
    .catch(() => settle(null))
    .finally(emitUrlChange);
  return loading;
}

/** The image's Material seed color; `null` while it loads, `false` when it scored none. */
export function useBackgroundImageSourceColor(
  id: CustomBackgroundImageId | null,
): number | null | false {
  return useSyncExternalStore(
    subscribeUrls,
    () => {
      if (id === null) return false;
      const state = ensureSourceColor(id);
      return state.status === "ready" ? (state.sourceColor ?? false) : null;
    },
    () => null,
  );
}

type ToneState = { status: "loading" } | { status: "ready"; tone: PictureTone | null };

// Measured from the stored thumbnail on first use rather than at upload, so
// pictures added before brightness adapt existed get a value too.
const toneStates = new Map<CustomBackgroundImageId, ToneState>();

function ensureTone(id: CustomBackgroundImageId): ToneState {
  const cached = toneStates.get(id);
  if (cached) return cached;
  const loading: ToneState = { status: "loading" };
  toneStates.set(id, loading);
  const settle = (tone: PictureTone | null) => {
    // A delete that raced the read already cleared the slot; leave it.
    if (toneStates.get(id) === loading) {
      toneStates.set(id, { status: "ready", tone });
    }
  };
  void readBackgroundImage(id)
    .then((image) => (image ? toneFromImage(image.thumbnail) : null))
    .then(settle, () => settle(null))
    .finally(emitUrlChange);
  return loading;
}

/** The image's tone; `null` while it loads, `false` when it cannot be measured. */
export function useBackgroundImageTone(
  id: CustomBackgroundImageId | null,
): PictureTone | null | false {
  return useSyncExternalStore(
    subscribeUrls,
    () => {
      if (id === null) return false;
      const state = ensureTone(id);
      return state.status === "ready" ? (state.tone ?? false) : null;
    },
    () => null,
  );
}

export function subscribeBackgroundImages(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

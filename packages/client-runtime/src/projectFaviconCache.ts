import { EnvironmentId } from "@t3tools/contracts";
import { mediaMimeType } from "@t3tools/shared/mediaPreview";
import {
  getProjectFaviconCacheKey,
  getProjectFaviconResourceKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import * as Base64 from "effect/encoding/Base64";
import * as Schema from "effect/Schema";

import { createImageCache, type ImageCacheStorage } from "./imageCache.ts";

export const PROJECT_FAVICON_THUMBNAIL_SIZE = 96;
export const PROJECT_FAVICON_MAX_DATA_URL_LENGTH = 32 * 1024;
export const PROJECT_FAVICON_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const PROJECT_FAVICON_CACHE_MAX_BYTES = 1024 * 1024;
export const PROJECT_FAVICON_CACHE_MAX_ENTRIES = 128;

export interface ProjectFaviconTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly faviconPath?: string | null | undefined;
}

export const ImageDataUrl = Schema.String.check(
  Schema.isMaxLength(PROJECT_FAVICON_MAX_DATA_URL_LENGTH),
  Schema.isPattern(
    /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+={0,2}$/,
  ),
);
const Entry = Schema.Struct({
  environmentId: EnvironmentId,
  cwd: Schema.String,
  faviconPath: Schema.NullOr(Schema.String),
  revision: Schema.String,
  dataUrl: ImageDataUrl,
});
export type ProjectFaviconEntry = typeof Entry.Type;
const isImageDataUrl = Schema.is(ImageDataUrl);

export type ProjectFaviconStorage = ImageCacheStorage<ProjectFaviconEntry>;

async function readBounded(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Project icon is too large to decode.");
  }
  if (!response.body) {
    const bytes = new Uint8Array<ArrayBuffer>(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("Project icon is too large to decode.");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Project icon is too large to decode.");
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array<ArrayBuffer>(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Larger bitmaps go through the platform downscaler; larger SVGs stay remote because rasterizing
 * them without intrinsic dimensions is unreliable.
 */
export function createProjectFaviconImageLoader(input: {
  readonly fetch?: typeof fetch;
  readonly downscale: (
    image: {
      readonly url: string;
      readonly mimeType: string;
      readonly bytes: Uint8Array<ArrayBuffer>;
    },
    signal: AbortSignal,
  ) => Promise<string>;
}) {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  return async (url: string, signal: AbortSignal): Promise<string> => {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`Project icon request failed with ${response.status}.`);
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const mimeType = contentType?.startsWith("image/") ? contentType : mediaMimeType(url);
    if (!mimeType) throw new Error("Project icon has no image type.");
    const bytes = await readBounded(response, PROJECT_FAVICON_MAX_SOURCE_BYTES);
    signal.throwIfAborted();
    const dataUrl = `data:${mimeType};base64,${Base64.encode(bytes)}`;
    if (isImageDataUrl(dataUrl)) return dataUrl;
    if (mimeType === "image/svg+xml") throw new Error("Project icon exceeds the cache limit.");
    return input.downscale({ url, mimeType, bytes }, signal);
  };
}

const revisionOf = (target: ProjectFaviconTarget, url: string) =>
  getProjectFaviconCacheKey(target.environmentId, target.cwd, url);

export function createProjectFaviconCache(input: {
  readonly storage: ProjectFaviconStorage;
  readonly load: (url: string, signal: AbortSignal) => Promise<string>;
}) {
  return createImageCache({
    ...input,
    decodeEntry: Schema.decodeUnknownOption(Entry),
    keyFor: (target: ProjectFaviconTarget) =>
      getProjectFaviconResourceKey(target.environmentId, target.cwd, target.faviconPath),
    entryFor: (target, url, dataUrl) => ({
      environmentId: target.environmentId,
      cwd: target.cwd,
      faviconPath: target.faviconPath || null,
      revision: revisionOf(target, url),
      dataUrl,
    }),
    isCurrent: (cached, target, url) => cached.revision === revisionOf(target, url),
    isMissingImageUrl: isProjectFaviconFallbackUrl,
    maxEntries: PROJECT_FAVICON_CACHE_MAX_ENTRIES,
    maxBytes: PROJECT_FAVICON_CACHE_MAX_BYTES,
  });
}

export type ProjectFaviconCache = ReturnType<typeof createProjectFaviconCache>;

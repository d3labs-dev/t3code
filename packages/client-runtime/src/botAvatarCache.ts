import { BotAvatarReference, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { createImageCache, type ImageCacheStorage } from "./imageCache.ts";
import {
  ImageDataUrl,
  PROJECT_FAVICON_CACHE_MAX_BYTES,
  PROJECT_FAVICON_CACHE_MAX_ENTRIES,
} from "./projectFaviconCache.ts";

export interface BotAvatarTarget {
  readonly environmentId: EnvironmentId;
  readonly reference: BotAvatarReference;
}

const Entry = Schema.Struct({
  environmentId: EnvironmentId,
  reference: BotAvatarReference,
  dataUrl: ImageDataUrl,
});
export type BotAvatarEntry = typeof Entry.Type;

/** Avatars load through the project icon loader, so they share its thumbnail format and limits. */
export function createBotAvatarCache(input: {
  readonly storage: ImageCacheStorage<BotAvatarEntry>;
  readonly load: (url: string, signal: AbortSignal) => Promise<string>;
}) {
  return createImageCache({
    ...input,
    decodeEntry: Schema.decodeUnknownOption(Entry),
    keyFor: (target: BotAvatarTarget) => JSON.stringify([target.environmentId, target.reference]),
    entryFor: (target, _url, dataUrl) => ({
      environmentId: target.environmentId,
      reference: target.reference,
      dataUrl,
    }),
    // The reference names the image's SHA-256, so a cached avatar never goes stale.
    isCurrent: () => true,
    maxEntries: PROJECT_FAVICON_CACHE_MAX_ENTRIES,
    maxBytes: PROJECT_FAVICON_CACHE_MAX_BYTES,
  });
}

export type BotAvatarCache = ReturnType<typeof createBotAvatarCache>;

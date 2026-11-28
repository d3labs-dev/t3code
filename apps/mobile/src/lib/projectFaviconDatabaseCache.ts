import {
  createProjectFaviconCache as createSharedProjectFaviconCache,
  createProjectFaviconImageLoader,
  PROJECT_FAVICON_MAX_DATA_URL_LENGTH,
  PROJECT_FAVICON_THUMBNAIL_SIZE,
} from "@t3tools/client-runtime/project-favicon-cache";

import { createImageCacheDatabaseStorage } from "./imageCacheDatabase";

/** expo-image encodes only through disk cache; remove the temporary frame after reading bytes. */
export async function downscaleProjectFavicon(
  image: { readonly url: string },
  signal: AbortSignal,
) {
  const [{ Image }, { File }] = await Promise.all([
    import("expo-image"),
    import("expo-file-system"),
  ]);
  for (const size of [PROJECT_FAVICON_THUMBNAIL_SIZE, PROJECT_FAVICON_THUMBNAIL_SIZE / 2]) {
    signal.throwIfAborted();
    const decoded = await Image.loadAsync(image.url, { maxWidth: size, maxHeight: size });
    const cacheKey = `t3-favicon-thumbnail:${size}:${image.url}`;
    try {
      signal.throwIfAborted();
      if (decoded.width > size || decoded.height > size) {
        throw new Error("Project icon was not resized.");
      }
      await Image.writeToCacheAsync(decoded, cacheKey);
      const path = await Image.getCachePathAsync(cacheKey);
      if (!path) throw new Error("Project icon thumbnail was not written.");
      const file = new File(path.startsWith("file:") ? path : `file://${path}`);
      try {
        if (file.size > PROJECT_FAVICON_MAX_DATA_URL_LENGTH) continue;
        const base64 = await file.base64();
        // SDWebImage chooses JPEG for opaque images and PNG for transparency; Glide always writes PNG.
        const mimeType = base64.startsWith("/9j/")
          ? "image/jpeg"
          : base64.startsWith("iVBORw0KGgo")
            ? "image/png"
            : null;
        if (!mimeType) throw new Error("Unsupported project icon thumbnail encoding.");
        const dataUrl = `data:${mimeType};base64,${base64}`;
        if (dataUrl.length <= PROJECT_FAVICON_MAX_DATA_URL_LENGTH) return dataUrl;
      } finally {
        file.delete();
      }
    } finally {
      decoded.release();
    }
  }
  throw new Error("Project icon thumbnail exceeds the cache limit.");
}

export const projectFaviconDatabaseCache = createSharedProjectFaviconCache({
  storage: createImageCacheDatabaseStorage("project-favicon"),
  load: createProjectFaviconImageLoader({ downscale: downscaleProjectFavicon }),
});

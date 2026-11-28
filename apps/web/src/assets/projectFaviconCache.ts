import {
  createProjectFaviconCache,
  createProjectFaviconImageLoader,
  PROJECT_FAVICON_MAX_DATA_URL_LENGTH,
  PROJECT_FAVICON_THUMBNAIL_SIZE,
} from "@t3tools/client-runtime/project-favicon-cache";

import { createIndexedDbImageCacheStorage } from "./imageCacheDatabase";

export async function downscaleProjectFavicon(
  image: { readonly mimeType: string; readonly bytes: Uint8Array<ArrayBuffer> },
  signal: AbortSignal,
) {
  const bitmap = await createImageBitmap(new Blob([image.bytes], { type: image.mimeType }));
  try {
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    for (const size of [PROJECT_FAVICON_THUMBNAIL_SIZE, PROJECT_FAVICON_THUMBNAIL_SIZE / 2]) {
      const scale = Math.min(1, size / bitmap.width, size / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/webp", 0.85);
      if (dataUrl.length <= PROJECT_FAVICON_MAX_DATA_URL_LENGTH) return dataUrl;
    }
    throw new Error("Project icon thumbnail exceeds the cache limit.");
  } finally {
    bitmap.close();
  }
}

export const projectFaviconCache = createProjectFaviconCache({
  storage: createIndexedDbImageCacheStorage("t3code:project-favicons"),
  load: createProjectFaviconImageLoader({ downscale: downscaleProjectFavicon }),
});

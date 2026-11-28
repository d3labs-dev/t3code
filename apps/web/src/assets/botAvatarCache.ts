import { createBotAvatarCache } from "@t3tools/client-runtime/bot-avatar-cache";
import { createProjectFaviconImageLoader } from "@t3tools/client-runtime/project-favicon-cache";

import { createIndexedDbImageCacheStorage } from "./imageCacheDatabase";
import { downscaleProjectFavicon } from "./projectFaviconCache";

export const botAvatarCache = createBotAvatarCache({
  storage: createIndexedDbImageCacheStorage("t3code:bot-avatars"),
  load: createProjectFaviconImageLoader({ downscale: downscaleProjectFavicon }),
});

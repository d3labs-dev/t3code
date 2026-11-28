import { createBotAvatarCache } from "@t3tools/client-runtime/bot-avatar-cache";
import { createProjectFaviconImageLoader } from "@t3tools/client-runtime/project-favicon-cache";

import { createImageCacheDatabaseStorage } from "./imageCacheDatabase";
import { downscaleProjectFavicon } from "./projectFaviconDatabaseCache";

export const botAvatarDatabaseCache = createBotAvatarCache({
  storage: createImageCacheDatabaseStorage("bot-avatar"),
  load: createProjectFaviconImageLoader({ downscale: downscaleProjectFavicon }),
});

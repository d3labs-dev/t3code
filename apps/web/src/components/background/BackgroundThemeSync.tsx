import {
  useBackgroundStudioOpen,
  useBackgroundStudioStore,
} from "~/customBackground/backgroundStudioStore";
import { useBackgroundImageSourceColor } from "~/customBackground/imageStore";
import { resolveActiveBackground } from "~/customBackground/records";
import { useRotatingBackgroundImage } from "~/customBackground/rotation";
import { useActiveBackground } from "~/customBackground/useActiveBackground";
import { usePictureThemeSync } from "~/customBackground/usePictureTheme";
import { useClientSettings } from "~/hooks/useSettings";

const NO_SOURCE = { kind: "none" } as const;

/**
 * Keeps the picture theme seeded on every route. The picture itself only
 * draws behind chats, but the palette it seeds stays put in settings and the
 * rest of the app, the way a phone keeps its wallpaper colors on every screen.
 */
export function BackgroundThemeSync() {
  const selected = useActiveBackground();
  const enabled = useClientSettings((settings) => settings.customBackgroundEnabled);
  const editing = useBackgroundStudioOpen();
  const preview = useBackgroundStudioStore((store) => store.preview);
  const record = resolveActiveBackground({ selected, preview, enabled, editing });
  const { current, upcoming } = useRotatingBackgroundImage(record?.source ?? NO_SOURCE);
  usePictureThemeSync(current);
  // Warm the next picture's colors so the theme switches in the same frame as
  // the picture, which CustomBackground preloads the same way.
  useBackgroundImageSourceColor(upcoming);
  return null;
}

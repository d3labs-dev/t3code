import type { CustomBackgroundImageId } from "@t3tools/contracts";
import { useEffect, useSyncExternalStore } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveThemeHalf } from "~/themePalette";

import { useBackgroundImageSourceColor } from "./imageStore";
import {
  PICTURE_THEME_ID,
  getPictureTheme,
  setPictureThemeSeed,
  subscribeToPictureTheme,
} from "./pictureTheme";

type RefreshTheme = ReturnType<typeof useTheme>["refreshTheme"];

/**
 * Crossfades the whole interface from the old palette to the new one as two
 * composited snapshots, timed in custom.css to match the picture fade. The
 * repaint must not suppress transitions: that would cancel the picture fade
 * that started in the same commit.
 */
function repaintWithCrossfade(refreshTheme: RefreshTheme): void {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || !("startViewTransition" in document)) {
    refreshTheme({ suppressTransitions: reducedMotion });
    return;
  }
  document.startViewTransition(() => refreshTheme({ suppressTransitions: false }));
}

export function usePictureTheme() {
  return useSyncExternalStore(subscribeToPictureTheme, getPictureTheme, () => null);
}

function usePictureThemeActive(): boolean {
  const { theme, themeHalves, resolvedTheme } = useTheme();
  return resolveThemeHalf(theme, themeHalves, resolvedTheme) === PICTURE_THEME_ID;
}

/**
 * Reseeds the picture theme from the picture on screen, and repaints when that
 * theme is the one showing. A picture without color leaves the last seed.
 */
export function usePictureThemeSync(imageId: CustomBackgroundImageId | null): void {
  const { refreshTheme } = useTheme();
  const active = usePictureThemeActive();
  const sourceColor = useBackgroundImageSourceColor(imageId);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the picture's colors into the theme store and repaints the document
  useEffect(() => {
    if (typeof sourceColor !== "number") return;
    if (setPictureThemeSeed(sourceColor) && active) repaintWithCrossfade(refreshTheme);
  }, [active, refreshTheme, sourceColor]);
}

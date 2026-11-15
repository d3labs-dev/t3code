import type { ThemeDefinition } from "@t3tools/shared/themePalettes";

import { PICTURE_THEME_ID, pictureThemeDefinition } from "./dynamicTheme";

export { PICTURE_THEME_ID };

const PICTURE_THEME_STORAGE_KEY = "t3code:picture-theme-seed:v1";

function readStoredSeed(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(PICTURE_THEME_STORAGE_KEY) ?? Number.NaN);
    return Number.isInteger(stored) ? stored : null;
  } catch {
    return null;
  }
}

const storedSeed = typeof window === "undefined" ? null : readStoredSeed();
let seed = storedSeed;
let definition = storedSeed === null ? null : pictureThemeDefinition(storedSeed);
const listeners = new Set<() => void>();

/**
 * The theme seeded by the last colorful background picture. It outlives the
 * picture so selecting it keeps working with the background off, the way a
 * phone keeps its wallpaper colors.
 */
export function getPictureTheme(): ThemeDefinition | null {
  return definition;
}

export function subscribeToPictureTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Returns whether the palette changed, so the caller repaints only then. */
export function setPictureThemeSeed(next: number): boolean {
  if (next === seed) return false;
  seed = next;
  definition = pictureThemeDefinition(next);
  try {
    window.localStorage.setItem(PICTURE_THEME_STORAGE_KEY, String(next));
  } catch {
    // Without the stored seed the next launch waits for the picture to load.
  }
  for (const listener of listeners) listener();
  return true;
}

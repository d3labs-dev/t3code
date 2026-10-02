import {
  type DynamicColor,
  Hct,
  MaterialDynamicColors as Material,
  QuantizerCelebi,
  SchemeTonalSpot,
  Score,
  hexFromArgb,
} from "@material/material-color-utilities";
import {
  type CustomBackgroundImageId,
  DEFAULT_CUSTOM_BACKGROUND_BRIGHTNESS_ADAPT,
  DEFAULT_CUSTOM_BACKGROUND_ROTATION_MINUTES,
  type CustomBackgroundImageSource,
  type CustomBackgroundSource,
  type PhoneBackground,
} from "@t3tools/contracts";
import type { PictureTone } from "@t3tools/shared/customBackgroundBrightness";
import {
  type CustomBackgroundFadeLevels,
  customBackgroundFadeStops,
} from "@t3tools/shared/customBackgroundFade";

import type { MaterialYouPalette } from "../../lib/materialYouPalette";
import type { MobileThemeAppearance, MobileThemeVariables } from "../../lib/mobileTheme";
// The Android file holds the palette-to-variables mapping every platform can
// run; the unsuffixed module is a no-op because system colors are Android-only.
import { materialYouPaletteToMobileThemeVariables } from "../../lib/materialYouTheme.android";

/** Android's wallpaper scheme, the same one desktop builds its image-colors theme from. */
export function seedPalette(
  sourceColor: number,
  appearance: MobileThemeAppearance,
): MaterialYouPalette {
  const scheme = new SchemeTonalSpot(Hct.fromInt(sourceColor), appearance === "dark", 0);
  const color = (role: DynamicColor) => hexFromArgb(role.getArgb(scheme)).toUpperCase();
  return {
    primary: color(Material.primary),
    onPrimary: color(Material.onPrimary),
    primaryContainer: color(Material.primaryContainer),
    onPrimaryContainer: color(Material.onPrimaryContainer),
    inversePrimary: color(Material.inversePrimary),
    secondaryContainer: color(Material.secondaryContainer),
    onSecondaryContainer: color(Material.onSecondaryContainer),
    tertiary: color(Material.tertiary),
    tertiaryContainer: color(Material.tertiaryContainer),
    onTertiaryContainer: color(Material.onTertiaryContainer),
    surface: color(Material.surface),
    onSurface: color(Material.onSurface),
    onSurfaceVariant: color(Material.onSurfaceVariant),
    surfaceContainer: color(Material.surfaceContainer),
    surfaceContainerHigh: color(Material.surfaceContainerHigh),
    surfaceContainerHighest: color(Material.surfaceContainerHighest),
    surfaceContainerLow: color(Material.surfaceContainerLow),
    surfaceContainerLowest: color(Material.surfaceContainerLowest),
    errorContainer: color(Material.errorContainer),
    onErrorContainer: color(Material.onErrorContainer),
    outline: color(Material.outline),
    outlineVariant: color(Material.outlineVariant),
    scrim: color(Material.scrim),
  };
}

const TRANSPARENT = "#00000000";

/**
 * Clears the surfaces home and threads paint their backdrop with so the
 * picture drawn behind navigation shows through, and hands that backdrop
 * color to the picture's own base and fade. Sheets and cards stay opaque.
 */
export function phoneBackgroundThemeVariables(input: {
  readonly variables: MobileThemeVariables;
  readonly appearance: MobileThemeAppearance;
  /** The current picture's seed when image-colors is on. */
  readonly sourceColor: number | null;
}): { readonly variables: MobileThemeVariables; readonly backdropColor: string } {
  const themed =
    input.sourceColor === null
      ? input.variables
      : materialYouPaletteToMobileThemeVariables(
          seedPalette(input.sourceColor, input.appearance),
          input.appearance,
          input.variables,
        );
  return {
    backdropColor: themed["--color-screen"],
    variables: {
      ...themed,
      "--color-screen": TRANSPARENT,
      "--color-header": TRANSPARENT,
      "--color-thread-canvas": TRANSPARENT,
    },
  };
}

export function withOpacity(color: string, percent: number): string {
  const rgb = /^#([\da-f]{6})/iu.exec(color)?.[1] ?? "000000";
  const alpha = Math.round((Math.min(100, Math.max(0, percent)) / 100) * 255);
  return `#${rgb}${alpha.toString(16).padStart(2, "0")}`;
}

/** The desktop's bottom fade, painted in the backdrop color. */
export function fadeOverlayGradient(color: string, levels: CustomBackgroundFadeLevels): string {
  const stops = customBackgroundFadeStops(levels).map(
    ({ opacity, position }) => `${withOpacity(color, opacity)} ${Math.round(position)}%`,
  );
  return `linear-gradient(to top, ${stops.join(", ")})`;
}

function opaqueArgb(rgba: Uint8Array): number[] {
  const pixels: number[] = [];
  for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
    if (rgba[offset + 3] !== 255) continue;
    pixels.push(
      ((255 << 24) | (rgba[offset]! << 16) | (rgba[offset + 1]! << 8) | rgba[offset + 2]!) >>> 0,
    );
  }
  return pixels;
}

/** The desktop's wallpaper seed: Material's quantize and score pass over opaque pixels. */
export function sourceColorFromPixels(rgba: Uint8Array): number | null {
  const pixels = opaqueArgb(rgba);
  if (pixels.length === 0) return null;
  return Score.score(QuantizerCelebi.quantize(pixels, 128))[0] ?? null;
}

// Material's chroma tops out near 120 for the most saturated sRGB colors.
const FULL_CHROMA = 100;

/** The desktop's picture tone: mean HCT tone and chroma of the opaque pixels. */
export function toneFromPixels(rgba: Uint8Array): PictureTone | null {
  const pixels = opaqueArgb(rgba);
  if (pixels.length === 0) return null;
  let tone = 0;
  let chroma = 0;
  for (const pixel of pixels) {
    const hct = Hct.fromInt(pixel);
    tone += hct.tone;
    chroma += Math.min(FULL_CHROMA, hct.chroma);
  }
  return {
    lightness: tone / pixels.length / 100,
    colorfulness: chroma / pixels.length / FULL_CHROMA,
  };
}

// A phone screen is small and busy, so its picture starts faint behind the list.
const PHONE_BACKGROUND_LOOK = {
  fade: 55,
  fadeHeight: 100,
  fadeSoftness: 65,
  opacity: 20,
} as const;

export interface AddedPicture {
  readonly imageId: CustomBackgroundImageId;
  readonly sourceColor: number | null;
}

function imageSource(
  imageIds: ReadonlyArray<CustomBackgroundImageId>,
): CustomBackgroundImageSource {
  return {
    kind: "image",
    imageIds,
    rotationMinutes: DEFAULT_CUSTOM_BACKGROUND_ROTATION_MINUTES,
    order: "sequential",
    transition: "fade",
  };
}

function emptyPhoneBackground(createdAt: string): PhoneBackground {
  return {
    record: {
      id: "phone",
      name: "Phone photos",
      source: imageSource([]),
      folders: [],
      filter: { kind: "none" },
      ...PHONE_BACKGROUND_LOOK,
      blur: 0,
      brightnessAdapt: DEFAULT_CUSTOM_BACKGROUND_BRIGHTNESS_ADAPT,
      createdAt,
    },
    dynamicTheme: true,
    sourceColors: {},
  };
}

function pickedImageIds(background: PhoneBackground): ReadonlyArray<CustomBackgroundImageId> {
  const source = background.record.source;
  return source.kind === "image" ? source.imageIds : [];
}

function withImageIds(
  background: PhoneBackground,
  imageIds: ReadonlyArray<CustomBackgroundImageId>,
): PhoneBackground {
  const source = background.record.source;
  return {
    ...background,
    record: {
      ...background.record,
      source: source.kind === "image" ? { ...source, imageIds } : imageSource(imageIds),
    },
  };
}

/** The background left over, or null once it has no pictures and no folders. */
function unlessEmpty(background: PhoneBackground): PhoneBackground | null {
  return pickedImageIds(background).length === 0 && background.record.folders.length === 0
    ? null
    : background;
}

/** Appends pictures, starting the playlist when the phone has none yet. */
export function phoneBackgroundWithPictures(
  current: PhoneBackground | null,
  pictures: ReadonlyArray<AddedPicture>,
  createdAt: string,
): PhoneBackground {
  const base = current ?? emptyPhoneBackground(createdAt);
  const existing = pickedImageIds(base);
  const added = pictures.map((picture) => picture.imageId).filter((id) => !existing.includes(id));
  return {
    ...withImageIds(base, [...existing, ...new Set(added)]),
    sourceColors: {
      ...base.sourceColors,
      ...Object.fromEntries(
        pictures.flatMap((picture) =>
          picture.sourceColor === null ? [] : [[picture.imageId, picture.sourceColor]],
        ),
      ),
    },
  };
}

/** Drops one picture; removing the last one, with no folder linked, clears the background. */
export function phoneBackgroundWithoutPicture(
  current: PhoneBackground,
  imageId: CustomBackgroundImageId,
): PhoneBackground | null {
  const { [imageId]: _removed, ...sourceColors } = current.sourceColors;
  return unlessEmpty({
    ...withImageIds(
      current,
      pickedImageIds(current).filter((id) => id !== imageId),
    ),
    sourceColors,
  });
}

/** Links a device folder by its media library album ID, starting the playlist when needed. */
export function phoneBackgroundWithFolder(
  current: PhoneBackground | null,
  albumId: string,
  createdAt: string,
): PhoneBackground {
  const base = current ?? emptyPhoneBackground(createdAt);
  const folders = base.record.folders;
  if (folders.some((folder) => folder.path === albumId)) return base;
  const linked = withImageIds(base, pickedImageIds(base));
  return {
    ...linked,
    record: { ...linked.record, folders: [...folders, { path: albumId, imageIds: [] }] },
  };
}

/** Unlinks a folder; unlinking the last one, with no pictures added, clears the background. */
export function phoneBackgroundWithoutFolder(
  current: PhoneBackground,
  albumId: string,
): PhoneBackground | null {
  return unlessEmpty({
    ...current,
    record: {
      ...current.record,
      folders: current.record.folders.filter((folder) => folder.path !== albumId),
    },
  });
}

export interface PhonePlaylistPicture {
  readonly id: string;
  readonly uri: string;
}

/**
 * What the phone rotates through: its own pictures, then each linked folder's
 * photos as last read. Folder photos are keyed by their media library ID.
 */
export function phonePlaylist(input: {
  readonly background: PhoneBackground;
  readonly pictureUri: (imageId: CustomBackgroundImageId) => string;
  readonly folderPictures: (albumId: string) => ReadonlyArray<PhonePlaylistPicture>;
}): {
  readonly source: CustomBackgroundSource;
  readonly pictures: ReadonlyMap<string, PhonePlaylistPicture>;
} {
  const pictures = new Map<string, PhonePlaylistPicture>();
  for (const id of pickedImageIds(input.background)) {
    pictures.set(id, { id, uri: input.pictureUri(id) });
  }
  for (const folder of input.background.record.folders) {
    for (const picture of input.folderPictures(folder.path)) pictures.set(picture.id, picture);
  }
  const source = input.background.record.source;
  return {
    source: source.kind === "image" ? { ...source, imageIds: [...pictures.keys()] } : source,
    pictures,
  };
}

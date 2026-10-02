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
  CUSTOM_BACKGROUND_NAME_MAX_LENGTH,
  type CustomBackgroundImageId,
  type CustomBackgroundRecord,
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

function pickedImageIds(record: CustomBackgroundRecord): ReadonlyArray<CustomBackgroundImageId> {
  return record.source.kind === "image" ? record.source.imageIds : [];
}

function withImageIds(
  record: CustomBackgroundRecord,
  imageIds: ReadonlyArray<CustomBackgroundImageId>,
): CustomBackgroundRecord {
  const source = record.source;
  return {
    ...record,
    source: source.kind === "image" ? { ...source, imageIds } : imageSource(imageIds),
  };
}

function sourceColorsOf(pictures: ReadonlyArray<AddedPicture>): Record<string, number> {
  return Object.fromEntries(
    pictures.flatMap((picture) =>
      picture.sourceColor === null ? [] : [[picture.imageId, picture.sourceColor]],
    ),
  );
}

/** The playlist showing now. */
export function activePhonePlaylist(background: PhoneBackground): CustomBackgroundRecord {
  // The schema rejects an active ID that names no playlist.
  return (
    background.playlists.find((playlist) => playlist.id === background.activePlaylistId) ??
    background.playlists[0]!
  );
}

/** Whether any playlist still shows the stored picture, so its file must stay. */
export function phonePictureInUse(
  background: PhoneBackground | null,
  imageId: CustomBackgroundImageId,
): boolean {
  return (
    background?.playlists.some((playlist) => pickedImageIds(playlist).includes(imageId)) ?? false
  );
}

/** Keeps the playlists that still show something, and the seeds of pictures they use. */
function withPlaylists(
  background: PhoneBackground,
  playlists: ReadonlyArray<CustomBackgroundRecord>,
): PhoneBackground | null {
  const kept = playlists.filter(
    (playlist) => pickedImageIds(playlist).length > 0 || playlist.folders.length > 0,
  );
  const first = kept[0];
  if (first === undefined) return null;
  const used = new Set(kept.flatMap(pickedImageIds));
  return {
    ...background,
    playlists: kept,
    activePlaylistId: kept.some((playlist) => playlist.id === background.activePlaylistId)
      ? background.activePlaylistId
      : first.id,
    sourceColors: Object.fromEntries(
      Object.entries(background.sourceColors).filter(([imageId]) => used.has(imageId)),
    ),
  };
}

/** Edits the showing playlist's own settings, such as its look or rotation. */
export function phoneBackgroundWithActivePlaylist(
  background: PhoneBackground,
  change: (playlist: CustomBackgroundRecord) => CustomBackgroundRecord,
): PhoneBackground {
  const activeId = activePhonePlaylist(background).id;
  return {
    ...background,
    playlists: background.playlists.map((playlist) =>
      playlist.id === activeId ? change(playlist) : playlist,
    ),
  };
}

/** Like `phoneBackgroundWithActivePlaylist`, dropping the playlist once nothing is left in it. */
function withoutFromActivePlaylist(
  background: PhoneBackground,
  change: (playlist: CustomBackgroundRecord) => CustomBackgroundRecord,
): PhoneBackground | null {
  return withPlaylists(background, phoneBackgroundWithActivePlaylist(background, change).playlists);
}

function uniquePlaylistName(background: PhoneBackground | null, base: string): string {
  const trimmed = base.trim().slice(0, CUSTOM_BACKGROUND_NAME_MAX_LENGTH - 4) || "Playlist";
  const taken = new Set(background?.playlists.map((playlist) => playlist.name));
  let name = trimmed;
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${trimmed} ${suffix}`;
  return name;
}

/** Starts a playlist from photos or a folder and shows it. */
export function phoneBackgroundWithNewPlaylist(
  current: PhoneBackground | null,
  playlist: {
    readonly id: string;
    readonly name: string;
    readonly pictures: ReadonlyArray<AddedPicture>;
    readonly albumIds: ReadonlyArray<string>;
    readonly createdAt: string;
  },
): PhoneBackground {
  const record: CustomBackgroundRecord = {
    id: playlist.id,
    name: uniquePlaylistName(current, playlist.name),
    source: imageSource([...new Set(playlist.pictures.map((picture) => picture.imageId))]),
    folders: [...new Set(playlist.albumIds)].map((path) => ({ path, imageIds: [] })),
    filter: { kind: "none" },
    ...PHONE_BACKGROUND_LOOK,
    blur: 0,
    brightnessAdapt: DEFAULT_CUSTOM_BACKGROUND_BRIGHTNESS_ADAPT,
    createdAt: playlist.createdAt,
  };
  return {
    playlists: [...(current?.playlists ?? []), record],
    activePlaylistId: record.id,
    dynamicTheme: current?.dynamicTheme ?? true,
    sourceColors: { ...current?.sourceColors, ...sourceColorsOf(playlist.pictures) },
  };
}

export function phoneBackgroundShowingPlaylist(
  background: PhoneBackground,
  playlistId: string,
): PhoneBackground {
  return background.playlists.some((playlist) => playlist.id === playlistId)
    ? { ...background, activePlaylistId: playlistId }
    : background;
}

/** Renames a playlist; a blank name leaves it as it was. */
export function phoneBackgroundWithPlaylistName(
  background: PhoneBackground,
  playlistId: string,
  name: string,
): PhoneBackground {
  const trimmed = name.trim().slice(0, CUSTOM_BACKGROUND_NAME_MAX_LENGTH);
  if (trimmed.length === 0) return background;
  return {
    ...background,
    playlists: background.playlists.map((playlist) =>
      playlist.id === playlistId ? { ...playlist, name: trimmed } : playlist,
    ),
  };
}

/** Deletes a playlist; deleting the last one clears the background. */
export function phoneBackgroundWithoutPlaylist(
  background: PhoneBackground,
  playlistId: string,
): PhoneBackground | null {
  return withPlaylists(
    background,
    background.playlists.filter((playlist) => playlist.id !== playlistId),
  );
}

/** Appends pictures to the showing playlist. */
export function phoneBackgroundWithPictures(
  background: PhoneBackground,
  pictures: ReadonlyArray<AddedPicture>,
): PhoneBackground {
  const withAdded = phoneBackgroundWithActivePlaylist(background, (playlist) => {
    const existing = pickedImageIds(playlist);
    const added = pictures
      .map((picture) => picture.imageId)
      .filter((imageId) => !existing.includes(imageId));
    return withImageIds(playlist, [...existing, ...new Set(added)]);
  });
  return {
    ...withAdded,
    sourceColors: { ...background.sourceColors, ...sourceColorsOf(pictures) },
  };
}

/** Drops a picture from the showing playlist, and the playlist once it is empty. */
export function phoneBackgroundWithoutPicture(
  background: PhoneBackground,
  imageId: CustomBackgroundImageId,
): PhoneBackground | null {
  return withoutFromActivePlaylist(background, (playlist) =>
    withImageIds(
      playlist,
      pickedImageIds(playlist).filter((id) => id !== imageId),
    ),
  );
}

/** Links a device folder, by its media library album ID, to the showing playlist. */
export function phoneBackgroundWithFolder(
  background: PhoneBackground,
  albumId: string,
): PhoneBackground {
  return phoneBackgroundWithActivePlaylist(background, (playlist) =>
    playlist.folders.some((folder) => folder.path === albumId)
      ? playlist
      : { ...playlist, folders: [...playlist.folders, { path: albumId, imageIds: [] }] },
  );
}

/** Unlinks a folder from the showing playlist, and drops the playlist once it is empty. */
export function phoneBackgroundWithoutFolder(
  background: PhoneBackground,
  albumId: string,
): PhoneBackground | null {
  return withoutFromActivePlaylist(background, (playlist) => ({
    ...playlist,
    folders: playlist.folders.filter((folder) => folder.path !== albumId),
  }));
}

export interface PhonePlaylistPicture {
  readonly id: string;
  readonly uri: string;
}

/**
 * What a playlist rotates through: its own pictures, then each linked
 * folder's photos as last read. Folder photos are keyed by their media library ID.
 */
export function phonePlaylist(input: {
  readonly playlist: CustomBackgroundRecord;
  readonly pictureUri: (imageId: CustomBackgroundImageId) => string;
  readonly folderPictures: (albumId: string) => ReadonlyArray<PhonePlaylistPicture>;
}): {
  readonly source: CustomBackgroundSource;
  readonly pictures: ReadonlyMap<string, PhonePlaylistPicture>;
} {
  const pictures = new Map<string, PhonePlaylistPicture>();
  for (const id of pickedImageIds(input.playlist)) {
    pictures.set(id, { id, uri: input.pictureUri(id) });
  }
  for (const folder of input.playlist.folders) {
    for (const picture of input.folderPictures(folder.path)) pictures.set(picture.id, picture);
  }
  const source = input.playlist.source;
  return {
    source: source.kind === "image" ? { ...source, imageIds: [...pictures.keys()] } : source,
    pictures,
  };
}

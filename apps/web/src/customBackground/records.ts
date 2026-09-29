import {
  type CustomBackgroundImageSource,
  type CustomBackgroundSource,
  type CustomBackgroundFilter,
  type CustomBackgroundFilterKind,
  type CustomBackgroundFolder,
  type CustomBackgroundImageId,
  type CustomBackgroundRecord,
  DEFAULT_CUSTOM_BACKGROUND_FADE,
  DEFAULT_CUSTOM_BACKGROUND_FADE_HEIGHT,
  DEFAULT_CUSTOM_BACKGROUND_FADE_SOFTNESS,
  DEFAULT_CUSTOM_BACKGROUND_OPACITY,
  DEFAULT_CUSTOM_BACKGROUND_BRIGHTNESS_ADAPT,
  DEFAULT_CUSTOM_BACKGROUND_ROTATION_MINUTES,
  defaultCustomBackgroundFilter,
} from "@t3tools/contracts";

export type CustomBackgroundLibrary = ReadonlyArray<CustomBackgroundRecord>;
export type CustomBackgroundRouteKind = "draft" | "conversation" | "other";

export function nextNewBackgroundName(library: CustomBackgroundLibrary): string {
  const taken = new Set(library.map((record) => record.name.toLowerCase()));
  for (let index = 1; ; index += 1) {
    const candidate = `New Playlist ${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function createEmptyBackground(input: {
  id: string;
  name: string;
  filter: CustomBackgroundFilter;
  createdAt: string;
}): CustomBackgroundRecord {
  return {
    id: input.id,
    name: input.name,
    source: { kind: "none" },
    folders: [],
    filter: input.filter,
    fade: DEFAULT_CUSTOM_BACKGROUND_FADE,
    fadeHeight: DEFAULT_CUSTOM_BACKGROUND_FADE_HEIGHT,
    fadeSoftness: DEFAULT_CUSTOM_BACKGROUND_FADE_SOFTNESS,
    opacity: DEFAULT_CUSTOM_BACKGROUND_OPACITY,
    blur: 0,
    brightnessAdapt: DEFAULT_CUSTOM_BACKGROUND_BRIGHTNESS_ADAPT,
    createdAt: input.createdAt,
  };
}

export function upsertBackground(
  library: CustomBackgroundLibrary,
  record: CustomBackgroundRecord,
): CustomBackgroundLibrary {
  const index = library.findIndex((candidate) => candidate.id === record.id);
  if (index === -1) return [...library, record];
  return library.map((candidate, position) => (position === index ? record : candidate));
}

export function removeBackground(
  library: CustomBackgroundLibrary,
  id: string,
): CustomBackgroundLibrary {
  return library.filter((record) => record.id !== id);
}

export function withFilterKind(
  record: CustomBackgroundRecord,
  kind: CustomBackgroundFilterKind,
): CustomBackgroundRecord {
  if (record.filter.kind === kind) return record;
  return { ...record, filter: defaultCustomBackgroundFilter(kind) };
}

export function nextActiveAfterRemove(activeId: string | null, removedId: string): string | null {
  return activeId === removedId ? null : activeId;
}

export function backgroundDrawMode({
  filter,
  hasImage,
  filtersAvailable,
}: {
  filter: CustomBackgroundFilter;
  hasImage: boolean;
  filtersAvailable: boolean;
}): "image" | "shader" | "none" {
  if (!hasImage) return "none";
  return filter.kind === "none" || !filtersAvailable ? "image" : "shader";
}

export function backgroundIsRenderable(
  record: CustomBackgroundRecord,
  filtersAvailable = true,
): boolean {
  return (
    backgroundDrawMode({
      filter: record.filter,
      hasImage: record.source.kind === "image",
      filtersAvailable,
    }) !== "none"
  );
}

function singleImageSource(imageId: CustomBackgroundImageId): CustomBackgroundImageSource {
  return {
    kind: "image",
    imageIds: [imageId],
    rotationMinutes: DEFAULT_CUSTOM_BACKGROUND_ROTATION_MINUTES,
    order: "sequential",
    transition: "fade",
  };
}

function withImageIds(
  source: CustomBackgroundSource,
  imageIds: ReadonlyArray<CustomBackgroundImageId>,
): CustomBackgroundSource {
  const [first] = imageIds;
  if (first === undefined) return { kind: "none" };
  return { ...(source.kind === "image" ? source : singleImageSource(first)), imageIds };
}

export function toggleBackgroundImage(
  source: CustomBackgroundSource,
  imageId: CustomBackgroundImageId,
): CustomBackgroundSource {
  if (source.kind !== "image") return singleImageSource(imageId);
  if (!source.imageIds.includes(imageId)) {
    return { ...source, imageIds: [...source.imageIds, imageId] };
  }
  const remaining = source.imageIds.filter((id) => id !== imageId);
  return remaining.length === 0 ? { kind: "none" } : { ...source, imageIds: remaining };
}

export function appendBackgroundImage(
  source: CustomBackgroundSource,
  imageId: CustomBackgroundImageId,
): CustomBackgroundImageSource {
  if (source.kind !== "image") return singleImageSource(imageId);
  return source.imageIds.includes(imageId)
    ? source
    : { ...source, imageIds: [...source.imageIds, imageId] };
}

/**
 * Follows a synced folder's current pictures: ones new to the folder join the
 * playlist, ones gone from it leave, and ones the user deselected stay out.
 */
export function syncBackgroundFolder(
  record: CustomBackgroundRecord,
  folder: CustomBackgroundFolder,
): CustomBackgroundRecord {
  const previous = new Set(
    record.folders.find((candidate) => candidate.path === folder.path)?.imageIds,
  );
  const current = new Set(folder.imageIds);
  const selected = record.source.kind === "image" ? record.source.imageIds : [];
  const kept = selected.filter((id) => current.has(id) || !previous.has(id));
  const keptIds = new Set(kept);
  const added = folder.imageIds.filter((id) => !previous.has(id) && !keptIds.has(id));
  const linked = record.folders.some((candidate) => candidate.path === folder.path);
  return {
    ...record,
    source: withImageIds(record.source, [...kept, ...added]),
    folders: linked
      ? record.folders.map((candidate) => (candidate.path === folder.path ? folder : candidate))
      : [...record.folders, folder],
  };
}

export function unlinkBackgroundFolder(
  record: CustomBackgroundRecord,
  path: string,
): CustomBackgroundRecord {
  return { ...record, folders: record.folders.filter((folder) => folder.path !== path) };
}

export function sourcesEqual(a: CustomBackgroundSource, b: CustomBackgroundSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== "image" || b.kind !== "image") return true;
  return (
    a.rotationMinutes === b.rotationMinutes &&
    a.order === b.order &&
    a.transition === b.transition &&
    a.imageIds.length === b.imageIds.length &&
    a.imageIds.every((id, index) => id === b.imageIds[index])
  );
}

export function filtersEqual(a: CustomBackgroundFilter, b: CustomBackgroundFilter): boolean {
  if (a.kind !== b.kind) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left: unknown = Reflect.get(a, key);
    const right: unknown = Reflect.get(b, key);
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      if (left.some((value, index) => value !== right[index])) return false;
      continue;
    }
    if (left !== right) return false;
  }
  return true;
}

/** The background in effect app-wide: the studio's live edits while it is open, else the saved pick. */
export function resolveActiveBackground({
  selected,
  preview,
  enabled,
  editing,
}: {
  selected: CustomBackgroundRecord | null;
  preview: CustomBackgroundRecord | null;
  enabled: boolean;
  editing: boolean;
}): CustomBackgroundRecord | null {
  if (!enabled) return null;
  return editing && preview?.id === selected?.id ? preview : selected;
}

/** The background painted behind a route; only chat routes draw one. */
export function resolveDisplayedBackground({
  routeKind,
  ...active
}: Parameters<typeof resolveActiveBackground>[0] & {
  routeKind: CustomBackgroundRouteKind;
}): CustomBackgroundRecord | null {
  return routeKind === "other" ? null : resolveActiveBackground(active);
}

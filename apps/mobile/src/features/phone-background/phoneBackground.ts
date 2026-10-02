import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { CustomBackgroundSource, PhoneBackground } from "@t3tools/contracts";
import {
  currentBackgroundImageId,
  upcomingBackgroundImageId,
} from "@t3tools/shared/customBackgroundRotation";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import type { PhoneBackgroundQuickAdjustPosition } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { phonePlaylist, type PhonePlaylistPicture } from "./phoneBackground.logic";
import { appForegroundSignal, type PhoneFolderRead, readPhoneFolder } from "./phoneFolders";
import { measurePhonePicture, type PictureMeasure, phonePictureFile } from "./phonePictures";

const DEFAULT_QUICK_ADJUST_POSITION: PhoneBackgroundQuickAdjustPosition = { x: 0, y: 0.45 };

let previousBackground: PhoneBackground | null = null;

// Preferences save for unrelated reasons; only a changed background may re-render.
const phoneBackgroundAtom = Atom.make((get) => {
  const preferences = get(mobilePreferencesAtom);
  const next = AsyncResult.isSuccess(preferences)
    ? (preferences.value.phoneBackground ?? null)
    : null;
  if (!Equal.equals(next, previousBackground)) previousBackground = next;
  return previousBackground;
}).pipe(Atom.withLabel("phone-background"));

/** The phone's own background, whether or not it is showing. */
export function usePhoneBackground(): PhoneBackground | null {
  return useAtomValue(phoneBackgroundAtom);
}

export function usePhoneBackgroundEnabled(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return !(
    AsyncResult.isSuccess(preferences) && preferences.value.phoneBackgroundEnabled === false
  );
}

export function usePhoneBackgroundQuickAdjust(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return (
    AsyncResult.isSuccess(preferences) && preferences.value.phoneBackgroundQuickAdjust === true
  );
}

export function usePhoneBackgroundQuickAdjustPosition(): PhoneBackgroundQuickAdjustPosition {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return (
    (AsyncResult.isSuccess(preferences) && preferences.value.phoneBackgroundQuickAdjustPosition) ||
    DEFAULT_QUICK_ADJUST_POSITION
  );
}

/** Edits the stored background; does nothing while the phone has none. */
export function useUpdatePhoneBackground() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  return useCallback(
    (change: (background: PhoneBackground) => PhoneBackground) =>
      savePreferences({
        transform: (current) => ({
          phoneBackground: current.phoneBackground ? change(current.phoneBackground) : null,
        }),
      }),
    [savePreferences],
  );
}

/** The phone's background, unless it is switched off. */
export function useShownPhoneBackground(): PhoneBackground | null {
  const background = usePhoneBackground();
  return usePhoneBackgroundEnabled() ? background : null;
}

const phoneFolderAtom = Atom.family((albumId: string) =>
  Atom.make((get) => {
    get(appForegroundSignal);
    get(rotationClockAtom);
    return Effect.promise(() => readPhoneFolder(albumId));
  }).pipe(Atom.withLabel(`phone-background-folder:${albumId}`)),
);

const rotationMinutesAtom = Atom.make((get) => {
  const source = get(phoneBackgroundAtom)?.record.source;
  return source?.kind === "image" ? source.rotationMinutes : null;
}).pipe(Atom.withLabel("phone-background-rotation-minutes"));

/**
 * Wall-clock time, moved forward at each rotation boundary. Linked folders are
 * read again on every tick and whenever the app returns to the foreground.
 */
const rotationClockAtom = Atom.make((get) => {
  const minutes = get(rotationMinutesAtom);
  if (minutes === null) return Date.now();
  const interval = minutes * 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    const wakeAt = (Math.floor(Date.now() / interval) + 1) * interval;
    timer = setTimeout(
      () => {
        get.setSelf(Math.max(Date.now(), wakeAt));
        schedule();
      },
      Math.max(0, wakeAt - Date.now()),
    );
  };
  schedule();
  get.addFinalizer(() => clearTimeout(timer));
  return Date.now();
}).pipe(Atom.withLabel("phone-background-rotation-clock"));

const phoneFolderReadAtom = Atom.family((albumId: string) =>
  Atom.make((get): PhoneFolderRead | null =>
    Option.getOrNull(AsyncResult.value(get(phoneFolderAtom(albumId)))),
  ),
);

const phonePlaylistAtom = Atom.make((get) => {
  const background = get(phoneBackgroundAtom);
  if (background === null) return null;
  return phonePlaylist({
    background,
    pictureUri: (imageId) => phonePictureFile(imageId).uri,
    folderPictures: (albumId) => {
      const read = get(phoneFolderReadAtom(albumId));
      return read?.status === "read" ? read.pictures : [];
    },
  });
}).pipe(Atom.withLabel("phone-background-playlist"));

/** The phone's pictures plus its linked folders' photos; null while it has no background. */
export function usePhonePlaylist() {
  return useAtomValue(phonePlaylistAtom);
}

/** A linked folder's last read; null until the first read lands. */
export function usePhoneFolderRead(albumId: string): PhoneFolderRead | null {
  return useAtomValue(phoneFolderReadAtom(albumId));
}

// Manual previous/next steps, like the desktop's: in memory only, so a restart
// lands back on the wall clock every client shares.
const rotationOffsetAtom = Atom.make(0).pipe(
  Atom.keepAlive,
  Atom.withLabel("phone-background-step"),
);

/** Steps the showing picture one back or forward. */
export function useStepPhoneBackground(): (delta: 1 | -1) => void {
  const offset = useAtomValue(rotationOffsetAtom);
  const setOffset = useAtomSet(rotationOffsetAtom);
  return useCallback((delta) => setOffset(offset + delta), [offset, setOffset]);
}

const NO_SOURCE: CustomBackgroundSource = { kind: "none" };

/** The picture showing now and the next one, on the same wall clock the desktop rotates by. */
export function usePhoneBackgroundImage(): {
  readonly current: PhonePlaylistPicture | null;
  readonly upcoming: PhonePlaylistPicture | null;
} {
  const playlist = useAtomValue(phonePlaylistAtom);
  const now = useAtomValue(rotationClockAtom);
  const offset = useAtomValue(rotationOffsetAtom);
  const source = playlist?.source ?? NO_SOURCE;
  const picture = (id: string | null) =>
    id === null ? null : (playlist?.pictures.get(id) ?? null);
  return {
    current: picture(currentBackgroundImageId(source, now, offset)),
    upcoming: picture(upcomingBackgroundImageId(source, now, offset)),
  };
}

const pictureMeasureAtom = Atom.family((uri: string | null) =>
  Atom.make(
    uri === null ? Effect.succeed(null) : Effect.promise(() => measurePhonePicture(uri)),
  ).pipe(Atom.keepAlive, Atom.withLabel(`phone-background-measure:${uri}`)),
);

/** The picture's tone and colors; null while it measures or when it cannot. */
export function usePhonePictureMeasure(uri: string | null): PictureMeasure | null {
  const measure = useAtomValue(pictureMeasureAtom(uri));
  return AsyncResult.isSuccess(measure) ? measure.value : null;
}

/** The showing picture's Material seed when colors come from pictures. */
export function usePhoneBackgroundSourceColor(background: PhoneBackground | null): number | null {
  const { current } = usePhoneBackgroundImage();
  const dynamic = background?.dynamicTheme === true ? current : null;
  const measure = usePhonePictureMeasure(dynamic?.uri ?? null);
  if (!background || dynamic === null) return null;
  return background.sourceColors[dynamic.id] ?? measure?.sourceColor ?? null;
}

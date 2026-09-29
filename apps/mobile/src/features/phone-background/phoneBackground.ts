import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  CustomBackgroundImageId,
  CustomBackgroundSource,
  PhoneBackground,
} from "@t3tools/contracts";
import type { PictureTone } from "@t3tools/shared/customBackgroundBrightness";
import {
  currentBackgroundImageId,
  nextBackgroundRotationAt,
  upcomingBackgroundImageId,
} from "@t3tools/shared/customBackgroundRotation";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useState } from "react";

import type { PhoneBackgroundQuickAdjustPosition } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { measurePhonePictureTone } from "./phonePictures";

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

const NO_SOURCE: CustomBackgroundSource = { kind: "none" };

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

/** The picture showing now and the next one, on the same wall clock the desktop rotates by. */
export function usePhoneBackgroundImage(source: CustomBackgroundSource | null) {
  const rotation = source ?? NO_SOURCE;
  const offset = useAtomValue(rotationOffsetAtom);
  const [now, setNow] = useState(Date.now);
  const wakeAt = nextBackgroundRotationAt(rotation, now);
  useEffect(() => {
    if (wakeAt === null) return;
    const timer = setTimeout(
      () => setNow(Math.max(Date.now(), wakeAt)),
      Math.max(0, wakeAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [wakeAt]);
  return {
    current: currentBackgroundImageId(rotation, now, offset),
    upcoming: upcomingBackgroundImageId(rotation, now, offset),
  };
}

const pictureToneAtom = Atom.family((imageId: CustomBackgroundImageId | null) =>
  Atom.make(
    imageId === null
      ? Effect.succeed(null)
      : Effect.promise(() => measurePhonePictureTone(imageId)),
  ).pipe(Atom.keepAlive, Atom.withLabel(`phone-background-tone:${imageId}`)),
);

/** The picture's tone for brightness adapt; null while it measures or when it cannot. */
export function usePhonePictureTone(imageId: CustomBackgroundImageId | null): PictureTone | null {
  const tone = useAtomValue(pictureToneAtom(imageId));
  return AsyncResult.isSuccess(tone) ? tone.value : null;
}

import { Atom } from "effect/reactivity";
import { AppState } from "react-native";

import { beginForegroundHandoff } from "../../lib/foreground-handoff";

/**
 * `limited` is Android 14's "selected photos": folders then hold only the
 * photos picked in that dialog. `blocked` can only change in system settings.
 */
export type PhoneFolderAccess = "granted" | "limited" | "denied" | "blocked";

export interface PhoneFolder {
  readonly id: string;
  readonly title: string;
  readonly photoCount: number;
}

export interface PhoneFolderPicture {
  readonly id: string;
  readonly uri: string;
}

export type PhoneFolderRead =
  | { readonly status: "read"; readonly pictures: ReadonlyArray<PhoneFolderPicture> }
  | { readonly status: "unreadable" };

const PAGE_SIZE = 500;

/**
 * Asks for photos only, through expo-media-library: on Android 13+
 * expo-image-picker's request reports "granted" without asking for anything,
 * and folder reads then fail.
 */
export async function requestPhoneFolderAccess(): Promise<PhoneFolderAccess> {
  const MediaLibrary = await import("expo-media-library/legacy");
  // The permission dialog covers the activity, which reports the app as backgrounded.
  const endHandoff = beginForegroundHandoff();
  try {
    const response = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
    if (response.granted) return response.accessPrivileges === "limited" ? "limited" : "granted";
    return response.canAskAgain ? "denied" : "blocked";
  } finally {
    endHandoff();
  }
}

/** Folders that hold at least one photo, by name. */
export async function listPhoneFolders(): Promise<ReadonlyArray<PhoneFolder>> {
  const MediaLibrary = await import("expo-media-library/legacy");
  const albums = await MediaLibrary.getAlbumsAsync();
  // An album's own count includes videos and other media.
  const folders = await Promise.all(
    albums.map(async (album) => {
      const page = await MediaLibrary.getAssetsAsync({
        album: album.id,
        mediaType: MediaLibrary.MediaType.photo,
        first: 0,
      });
      return { id: album.id, title: album.title, photoCount: page.totalCount };
    }),
  );
  return folders
    .filter((folder) => folder.photoCount > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The folder's photos, oldest first so new ones join the end of the rotation. */
export async function readPhoneFolder(albumId: string): Promise<PhoneFolderRead> {
  try {
    const MediaLibrary = await import("expo-media-library/legacy");
    const pictures: PhoneFolderPicture[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await MediaLibrary.getAssetsAsync({
        album: albumId,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.creationTime, true]],
        first: PAGE_SIZE,
        ...(after === undefined ? {} : { after }),
      });
      for (const asset of page.assets) pictures.push({ id: asset.id, uri: asset.uri });
      if (!page.hasNextPage) return { status: "read", pictures };
      after = page.endCursor;
    }
  } catch {
    return { status: "unreadable" };
  }
}

/** Ticks each time the app comes back to the foreground. */
export const appForegroundSignal = Atom.readable((get) => {
  let count = 0;
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") get.setSelf(++count);
  });
  get.addFinalizer(() => subscription.remove());
  return count;
}).pipe(Atom.withLabel("app-foreground-signal"));

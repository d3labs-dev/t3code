import { PhoneBackground } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { getMobileThemeRuntimeVariables } from "../../lib/mobileThemeVariables";
import {
  activePhonePlaylist,
  fadeOverlayGradient,
  phoneBackgroundShowingPlaylist,
  phoneBackgroundThemeVariables,
  phoneBackgroundWithFolder,
  phoneBackgroundWithNewPlaylist,
  phoneBackgroundWithoutFolder,
  phoneBackgroundWithoutPicture,
  phoneBackgroundWithoutPlaylist,
  phoneBackgroundWithPictures,
  phoneBackgroundWithPlaylistName,
  phonePictureInUse,
  phonePlaylist,
  sourceColorFromPixels,
  toneFromPixels,
} from "./phoneBackground.logic";

const decodePhoneBackground = Schema.decodeUnknownSync(PhoneBackground);

const background: PhoneBackground = {
  playlists: [
    {
      id: "phone",
      name: "Phone",
      source: {
        kind: "image",
        imageIds: ["a".repeat(64)],
        rotationMinutes: 10,
        order: "sequential",
        transition: "fade",
      },
      filter: { kind: "none" },
      fade: 83,
      fadeHeight: 76,
      fadeSoftness: 30,
      opacity: 75,
      blur: 0,
      brightnessAdapt: 0,
      folders: [],
      createdAt: "2026-09-22T00:00:00.000Z",
    },
  ],
  activePlaylistId: "phone",
  dynamicTheme: true,
  sourceColors: {},
};

describe("phoneBackgroundThemeVariables", () => {
  const base = getMobileThemeRuntimeVariables("t3-code", "dark", "android");

  it("clears the home and thread backdrops and keeps their color for the picture", () => {
    const result = phoneBackgroundThemeVariables({
      variables: base,
      appearance: "dark",
      sourceColor: null,
    });
    expect(result.backdropColor).toBe(base["--color-screen"]);
    expect(result.variables["--color-screen"]).toBe("#00000000");
    expect(result.variables["--color-header"]).toBe("#00000000");
    expect(result.variables["--color-thread-canvas"]).toBe("#00000000");
    expect(result.variables["--color-sheet"]).toBe(base["--color-sheet"]);
  });

  it("recolors the theme from the picture's seed", () => {
    const seeded = phoneBackgroundThemeVariables({
      variables: base,
      appearance: "dark",
      sourceColor: 0xff3366cc,
    });
    expect(seeded.variables["--color-primary"]).not.toBe(base["--color-primary"]);
    expect(seeded.backdropColor).not.toBe(base["--color-screen"]);
    expect(seeded.variables["--color-screen"]).toBe("#00000000");
  });
});

describe("fadeOverlayGradient", () => {
  it("runs from the fade at the bottom to clear at the fade height", () => {
    const gradient = fadeOverlayGradient("#112233FF", {
      fade: 100,
      fadeHeight: 60,
      fadeSoftness: 30,
    });
    expect(gradient.startsWith("linear-gradient(to top, #112233ff 0%")).toBe(true);
    expect(gradient).toContain("#11223300 60%");
    expect(gradient.endsWith("#11223300 100%)")).toBe(true);
  });

  it("follows the desktop's intensity curve", () => {
    const gradient = fadeOverlayGradient("#112233FF", {
      fade: 50,
      fadeHeight: 100,
      fadeSoftness: 100,
    });
    expect(gradient.startsWith("linear-gradient(to top, #112233bf 0%")).toBe(true);
  });
});

describe("editing the phone's playlists", () => {
  const first = "1".repeat(64);
  const second = "2".repeat(64);
  const createdAt = "2026-09-23T00:00:00.000Z";

  it("starts the first playlist from photos and shows it", () => {
    const started = phoneBackgroundWithNewPlaylist(null, {
      id: "photos",
      name: "Photos",
      pictures: [
        { imageId: first, sourceColor: 7 },
        { imageId: second, sourceColor: null },
      ],
      albumIds: [],
      createdAt,
    });
    expect(started.activePlaylistId).toBe("photos");
    expect(activePhonePlaylist(started).source).toMatchObject({ imageIds: [first, second] });
    expect(started.sourceColors).toEqual({ [first]: 7 });
    expect(activePhonePlaylist(started)).toMatchObject({ opacity: 20, brightnessAdapt: 100 });
  });

  it("adds folder playlists next to each other and switches between them", () => {
    const one = phoneBackgroundWithNewPlaylist(background, {
      id: "w1",
      name: "Wallpapers",
      pictures: [],
      albumIds: ["11"],
      createdAt,
    });
    const two = phoneBackgroundWithNewPlaylist(one, {
      id: "w2",
      name: "Wallpapers",
      pictures: [],
      albumIds: ["22"],
      createdAt,
    });
    expect(two.playlists.map((playlist) => playlist.name)).toEqual([
      "Phone",
      "Wallpapers",
      "Wallpapers 2",
    ]);
    expect(activePhonePlaylist(two).folders).toEqual([{ path: "22", imageIds: [] }]);
    expect(activePhonePlaylist(phoneBackgroundShowingPlaylist(two, "w1")).id).toBe("w1");
    expect(phoneBackgroundShowingPlaylist(two, "missing")).toBe(two);
    expect(decodePhoneBackground(two)).toEqual(two);
  });

  it("rejects a stored background whose active playlist is gone", () => {
    expect(() => decodePhoneBackground({ ...background, activePlaylistId: "gone" })).toThrow();
  });

  it("edits only the showing playlist", () => {
    const two = phoneBackgroundWithNewPlaylist(background, {
      id: "w1",
      name: "Wallpapers",
      pictures: [],
      albumIds: ["11"],
      createdAt,
    });
    const added = phoneBackgroundWithPictures(two, [{ imageId: second, sourceColor: 2 }]);
    expect(activePhonePlaylist(added).source).toMatchObject({ imageIds: [second] });
    expect(added.playlists[0]?.source).toMatchObject({ imageIds: ["a".repeat(64)] });
    const linked = phoneBackgroundWithFolder(added, "33");
    expect(activePhonePlaylist(linked).folders.map((folder) => folder.path)).toEqual(["11", "33"]);
    expect(phoneBackgroundWithFolder(linked, "33")).toEqual(linked);
  });

  it("drops an emptied playlist, falls back to another, and clears with the last", () => {
    const two = phoneBackgroundWithNewPlaylist(background, {
      id: "w1",
      name: "Wallpapers",
      pictures: [],
      albumIds: ["11"],
      createdAt,
    });
    const unlinked = phoneBackgroundWithoutFolder(two, "11");
    expect(unlinked?.playlists.map((playlist) => playlist.id)).toEqual(["phone"]);
    expect(unlinked?.activePlaylistId).toBe("phone");
    expect(phoneBackgroundWithoutPicture(unlinked!, "a".repeat(64))).toBeNull();
  });

  it("keeps a picture another playlist still shows", () => {
    const shared = phoneBackgroundWithNewPlaylist(
      { ...background, sourceColors: { ["a".repeat(64)]: 5 } },
      { id: "copy", name: "Copy", pictures: [], albumIds: ["11"], createdAt },
    );
    const both = phoneBackgroundWithPictures(shared, [{ imageId: "a".repeat(64), sourceColor: 5 }]);
    const withoutCopy = phoneBackgroundWithoutPlaylist(both, "copy");
    expect(phonePictureInUse(withoutCopy, "a".repeat(64))).toBe(true);
    expect(withoutCopy?.sourceColors).toEqual({ ["a".repeat(64)]: 5 });
    const gone = phoneBackgroundWithoutPlaylist(withoutCopy!, "phone");
    expect(gone).toBeNull();
    expect(phonePictureInUse(gone, "a".repeat(64))).toBe(false);
  });

  it("renames a playlist and ignores a blank name", () => {
    expect(
      phoneBackgroundWithPlaylistName(background, "phone", "  Beach  ").playlists[0]?.name,
    ).toBe("Beach");
    expect(phoneBackgroundWithPlaylistName(background, "phone", "   ")).toBe(background);
  });

  it("rotates through a playlist's pictures, then each folder's photos as read", () => {
    const linked = phoneBackgroundWithFolder(background, "camera");
    const playlist = phonePlaylist({
      playlist: activePhonePlaylist(linked),
      pictureUri: (imageId) => `file:///stored/${imageId}.webp`,
      folderPictures: (albumId) =>
        albumId === "camera" ? [{ id: "41", uri: "file:///DCIM/Camera/41.jpg" }] : [],
    });
    expect(playlist.source).toMatchObject({
      imageIds: ["a".repeat(64), "41"],
      rotationMinutes: 10,
    });
    expect(playlist.pictures.get("41")?.uri).toBe("file:///DCIM/Camera/41.jpg");
  });

  it("scores a seed only from opaque pixels", () => {
    const orange = [255, 120, 0, 255];
    expect(sourceColorFromPixels(Uint8Array.from([...orange, ...orange]))).not.toBeNull();
    expect(sourceColorFromPixels(Uint8Array.from([255, 120, 0, 0]))).toBeNull();
  });

  it("measures a white picture as light and a vivid one as colorful", () => {
    const white = toneFromPixels(Uint8Array.from([255, 255, 255, 255]))!;
    const orange = toneFromPixels(Uint8Array.from([255, 120, 0, 255]))!;
    expect(white.lightness).toBeCloseTo(1);
    expect(orange.colorfulness).toBeGreaterThan(white.colorfulness + 0.5);
    expect(toneFromPixels(Uint8Array.from([255, 255, 255, 0]))).toBeNull();
  });
});

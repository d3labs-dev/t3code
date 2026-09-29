import { resolveDraftHeroState } from "../components/ChatView.logic";
import { describe, expect, it } from "vite-plus/test";
import { type CustomBackgroundRecord, defaultCustomBackgroundFilter } from "@t3tools/contracts";

import {
  appendBackgroundImage,
  backgroundDrawMode,
  backgroundIsRenderable,
  createEmptyBackground,
  filtersEqual,
  nextActiveAfterRemove,
  nextNewBackgroundName,
  removeBackground,
  resolveDisplayedBackground,
  syncBackgroundFolder,
  toggleBackgroundImage,
  upsertBackground,
  withFilterKind,
} from "./records";

const imageId = "a".repeat(64);
const createdAt = "2026-09-08T00:00:00.000Z";
const sunset: CustomBackgroundRecord = {
  id: "bg-1",
  name: "Sunset",
  source: {
    kind: "image",
    imageIds: [imageId],
    rotationMinutes: 10,
    order: "sequential",
    transition: "fade",
  },
  folders: [],
  filter: defaultCustomBackgroundFilter("image-dithering"),
  fade: 100,
  fadeHeight: 60,
  fadeSoftness: 30,
  opacity: 100,
  blur: 0,
  brightnessAdapt: 0,
  createdAt,
};
const mesh = createEmptyBackground({
  id: "bg-2",
  name: "Mesh",
  filter: defaultCustomBackgroundFilter("image-dithering"),
  createdAt,
});

describe("nextNewBackgroundName", () => {
  it("numbers from 1 and skips names already in the library", () => {
    expect(nextNewBackgroundName([])).toBe("New Playlist 1");
    expect(nextNewBackgroundName([sunset])).toBe("New Playlist 1");
    expect(
      nextNewBackgroundName([
        { ...sunset, name: "New Playlist 1" },
        { ...mesh, name: "New Playlist 3" },
      ]),
    ).toBe("New Playlist 2");
  });
});

describe("library edits", () => {
  it("upserts by id and keeps order", () => {
    const library = upsertBackground([sunset, mesh], { ...sunset, name: "Dusk" });
    expect(library.map((record) => record.name)).toEqual(["Dusk", "Mesh"]);
    expect(upsertBackground([sunset], mesh)).toEqual([sunset, mesh]);
  });

  it("removes and clears the active pointer only when it was the removed one", () => {
    expect(removeBackground([sunset, mesh], "bg-1")).toEqual([mesh]);
    expect(nextActiveAfterRemove("bg-1", "bg-1")).toBeNull();
    expect(nextActiveAfterRemove("bg-2", "bg-1")).toBe("bg-2");
  });

  it("resets parameters when the filter kind changes and keeps the image", () => {
    const plain = withFilterKind(sunset, "none");
    expect(plain.filter.kind).toBe("none");
    expect(withFilterKind(plain, "none")).toBe(plain);
    const dithered = withFilterKind(plain, "image-dithering");
    expect(dithered.filter).toEqual(defaultCustomBackgroundFilter("image-dithering"));
    expect(plain.source).toEqual(sunset.source);
  });
});

describe("images", () => {
  it("only renders records that have an image", () => {
    expect(backgroundIsRenderable(sunset)).toBe(true);
    expect(backgroundIsRenderable(mesh)).toBe(false);
    expect(backgroundIsRenderable({ ...sunset, source: { kind: "none" } })).toBe(false);
  });

  it("draws the photo without a filter when shaders cannot run", () => {
    expect(
      backgroundDrawMode({
        filter: sunset.filter,
        hasImage: true,
        filtersAvailable: false,
      }),
    ).toBe("image");
    expect(
      backgroundDrawMode({
        filter: mesh.filter,
        hasImage: false,
        filtersAvailable: false,
      }),
    ).toBe("none");
    expect(backgroundIsRenderable(sunset, false)).toBe(true);
    expect(backgroundIsRenderable(mesh, false)).toBe(false);
  });
});

describe("filtersEqual", () => {
  it("compares kind and parameters", () => {
    const a = defaultCustomBackgroundFilter("image-dithering");
    expect(filtersEqual(a, defaultCustomBackgroundFilter("image-dithering"))).toBe(true);
    if (a.kind !== "image-dithering") throw new Error("unexpected kind");
    expect(filtersEqual(a, { ...a, size: a.size + 0.2 })).toBe(false);
    expect(filtersEqual(a, { kind: "none" })).toBe(false);
  });
});

describe("live app background", () => {
  const options = {
    selected: sunset,
    preview: null,
    enabled: true,
    editing: false,
    routeKind: "other" as const,
  };

  it("previews slider changes only on routes where backgrounds are enabled", () => {
    const preview = { ...sunset, fade: 25 };
    expect(resolveDisplayedBackground(options)).toBeNull();
    expect(resolveDisplayedBackground({ ...options, editing: true, preview })).toBeNull();
    expect(
      resolveDisplayedBackground({ ...options, editing: true, preview, routeKind: "draft" }),
    ).toBe(preview);
    expect(
      resolveDisplayedBackground({ ...options, editing: true, preview, routeKind: "conversation" }),
    ).toBe(preview);
    const saved = { ...options, selected: preview, preview, editing: false };
    expect(resolveDisplayedBackground(saved)).toBeNull();
    expect(resolveDisplayedBackground({ ...saved, routeKind: "draft" })).toBe(preview);
    expect(resolveDisplayedBackground({ ...saved, routeKind: "conversation" })).toBe(preview);
  });

  it("hides drafts and editor previews when disabled", () => {
    const state = {
      ...options,
      routeKind: "draft" as const,
      editing: true,
      preview: { ...sunset, fade: 25 },
    };
    expect(resolveDisplayedBackground({ ...state, enabled: false })).toBeNull();
    expect(resolveDisplayedBackground(state)).toBe(state.preview);
  });

  it("does not paint another background's pending changes after changing selection", () => {
    expect(
      resolveDisplayedBackground({
        ...options,
        routeKind: "draft",
        editing: true,
        selected: mesh,
        preview: sunset,
      }),
    ).toBe(mesh);
    expect(
      resolveDisplayedBackground({
        ...options,
        routeKind: "draft",
        editing: true,
        selected: null,
        preview: sunset,
      }),
    ).toBeNull();
  });
});

describe("background visibility during first submission", () => {
  it.each([
    { hasTimelineEntries: false, isWorking: false, draftHeroDockRequested: false },
    { hasTimelineEntries: false, isWorking: false, draftHeroDockRequested: true },
    { hasTimelineEntries: true, isWorking: false, draftHeroDockRequested: false },
    { hasTimelineEntries: true, isWorking: true, draftHeroDockRequested: false },
  ])("paints through the whole draft-to-conversation handoff: %j", (state) => {
    const isDraftHeroState = resolveDraftHeroState({
      ...state,
      isLocalDraftThread: true,
      backgroundSubmissionPending: false,
    });
    expect(
      resolveDisplayedBackground({
        selected: sunset,
        preview: null,
        enabled: true,
        editing: false,
        routeKind: isDraftHeroState ? "draft" : "conversation",
      }),
    ).toBe(sunset);
  });
});

describe("playlist images", () => {
  const first = "1".repeat(64);
  const second = "2".repeat(64);
  const third = "3".repeat(64);
  const rotating = {
    kind: "image",
    imageIds: [first, second, third],
    rotationMinutes: 10,
    order: "sequential",
    transition: "fade",
  } as const;

  it("toggles images in and out and drops the source when empty", () => {
    expect(toggleBackgroundImage({ kind: "none" }, first)).toEqual({
      kind: "image",
      imageIds: [first],
      rotationMinutes: 15,
      order: "sequential",
      transition: "fade",
    });
    expect(toggleBackgroundImage(rotating, second)).toEqual({
      ...rotating,
      imageIds: [first, third],
    });
    expect(toggleBackgroundImage({ ...rotating, imageIds: [first] }, first)).toEqual({
      kind: "none",
    });
    expect(appendBackgroundImage(rotating, second)).toBe(rotating);
    expect(appendBackgroundImage({ ...rotating, imageIds: [first] }, second).imageIds).toEqual([
      first,
      second,
    ]);
  });
});

describe("syncBackgroundFolder", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map((char) => char.repeat(64)) as [
    string,
    string,
    string,
    string,
  ];
  const path = "/Users/me/Wallpapers";
  const empty = createEmptyBackground({
    id: "bg-2",
    name: "Folder",
    filter: defaultCustomBackgroundFilter("none"),
    createdAt,
  });
  const imageIds = (record: CustomBackgroundRecord) =>
    record.source.kind === "image" ? record.source.imageIds : [];

  it("selects every picture of a newly linked folder", () => {
    const linked = syncBackgroundFolder(
      { ...empty, folders: [{ path, imageIds: [] }] },
      { path, imageIds: [a, b] },
    );
    expect(imageIds(linked)).toEqual([a, b]);
    expect(linked.folders).toEqual([{ path, imageIds: [a, b] }]);
  });

  it("adds new files, drops deleted ones, and keeps deselections and manual picks", () => {
    const record: CustomBackgroundRecord = {
      ...sunset,
      source: {
        kind: "image",
        imageIds: [d, a],
        rotationMinutes: 10,
        order: "sequential",
        transition: "fade",
      },
      folders: [{ path, imageIds: [a, b, c] }],
    };
    const synced = syncBackgroundFolder(record, { path, imageIds: [b, c] });
    // `a` left the folder, `b` stays deselected, `d` was picked by hand.
    expect(imageIds(synced)).toEqual([d]);

    const grown = syncBackgroundFolder(synced, { path, imageIds: [b, c, a] });
    expect(imageIds(grown)).toEqual([d, a]);
    expect(grown.source.kind === "image" && grown.source.rotationMinutes).toBe(10);
  });

  it("empties the playlist when the folder's last picture goes", () => {
    const record = syncBackgroundFolder(
      { ...empty, folders: [{ path, imageIds: [] }] },
      { path, imageIds: [a] },
    );
    expect(syncBackgroundFolder(record, { path, imageIds: [] }).source).toEqual({ kind: "none" });
  });
});

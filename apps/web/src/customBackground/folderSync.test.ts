import {
  type CustomBackgroundRecord,
  DEFAULT_CLIENT_SETTINGS,
  type DesktopBackgroundFolderImage,
  defaultCustomBackgroundFilter,
} from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  known: new Set<string>(),
  listed: null as ReadonlyArray<DesktopBackgroundFolderImage> | null,
  read: vi.fn<(path: string) => Promise<Uint8Array>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getClientSettings: async () => null,
      setClientSettings: async () => undefined,
    },
  }),
}));
vi.mock("./imageStore", () => ({
  listBackgroundImageIds: async () => state.known,
  storeBackgroundImages: (loads: ReadonlyArray<() => Promise<File>>, onSettled: () => void) =>
    Promise.all(
      loads.map(async (load) => {
        const file = await load();
        onSettled();
        return { ok: true, image: { id: file.name.replace(".png", "").repeat(64) } };
      }),
    ),
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  getClientSettings,
} from "~/hooks/useSettings";
import { linkBackgroundFolder, syncBackgroundFolderNow } from "./folderSync";
import { createEmptyBackground, unlinkBackgroundFolder } from "./records";

const path = "/Users/me/Wallpapers";
const [a, b] = ["a", "b"].map((char) => char.repeat(64)) as [string, string];
const image = (id: string, name: string) => ({ path: `${path}/${name}`, id, type: "image/png" });
const playlist = createEmptyBackground({
  id: "bg",
  name: "Folder",
  filter: defaultCustomBackgroundFilter("none"),
  createdAt: "2026-09-29",
});
const savedPlaylist = (): CustomBackgroundRecord => getClientSettings().customBackgrounds[0]!;

beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, customBackgrounds: [playlist] });
  state.known = new Set([a]);
  state.listed = [image(a, "a.png"), image(b, "b.png")];
  state.read.mockReset().mockResolvedValue(new Uint8Array([1]));
  vi.stubGlobal("window", {
    desktopBridge: {
      pickBackgroundFolder: async () => path,
      listBackgroundFolder: async () => state.listed,
      readBackgroundFolderImage: state.read,
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("selects every picture of a linked folder, reading only ones not yet imported", async () => {
  const result = await linkBackgroundFolder({ backgroundId: playlist.id, path });

  expect(result).toEqual({ status: "synced", pictures: 2, imported: 1, failed: 0 });
  expect(state.read.mock.calls).toEqual([[`${path}/b.png`]]);
  expect(savedPlaylist().source).toMatchObject({ kind: "image", imageIds: [a, b] });
  expect(savedPlaylist().folders).toEqual([{ path, imageIds: [a, b] }]);
});

it("leaves the playlist alone when the folder cannot be read", async () => {
  await linkBackgroundFolder({ backgroundId: playlist.id, path });
  state.listed = null;

  expect(await syncBackgroundFolderNow({ backgroundId: playlist.id, path })).toEqual({
    status: "missing",
  });
  expect(savedPlaylist().source).toMatchObject({ imageIds: [a, b] });
});

it("does not relink a folder unlinked while it synced", async () => {
  await linkBackgroundFolder({ backgroundId: playlist.id, path });
  const sync = syncBackgroundFolderNow({ backgroundId: playlist.id, path });
  __setClientSettingsForTests({
    ...getClientSettings(),
    customBackgrounds: [unlinkBackgroundFolder(savedPlaylist(), path)],
  });
  state.listed = [image(a, "a.png")];
  await sync;

  expect(savedPlaylist().folders).toEqual([]);
  expect(savedPlaylist().source).toMatchObject({ imageIds: [a, b] });
});

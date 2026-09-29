import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type ClientSettingsPatch,
  type CustomBackgroundRecord,
  defaultCustomBackgroundFilter,
} from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: null as ClientSettings | null,
  listeners: new Set<() => void>(),
  upload: vi.fn(),
  filtersAvailable: true,
}));
vi.mock("~/hooks/useSettings", async () => {
  const { useSyncExternalStore } = await import("react");
  const getClientSettings = () => {
    if (!state.settings) throw new Error("Settings not initialized");
    return state.settings;
  };
  const update = (patch: ClientSettingsPatch) => {
    state.settings = { ...getClientSettings(), ...patch };
    state.listeners.forEach((listener) => listener());
  };
  return {
    getClientSettings,
    useUpdateClientSettings: () => update,
    useClientSettings: (select: (settings: ClientSettings) => unknown) =>
      select(
        useSyncExternalStore((listener) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        }, getClientSettings),
      ),
  };
});
vi.mock("~/customBackground/imageStore", () => ({
  storeBackgroundImages: (loads: ReadonlyArray<() => Promise<File>>, onSettled: () => void) =>
    Promise.all(
      loads.map(async (load) => {
        const result: unknown = await state.upload(await load());
        onSettled();
        return result;
      }),
    ),
  useBackgroundImageTone: () => null,
}));
vi.mock("~/customBackground/folderSync", () => ({
  backgroundFolderName: (path: string) => path,
  linkBackgroundFolder: vi.fn(),
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/customBackground/webgl", () => ({
  isWebGlAvailable: () => state.filtersAvailable,
}));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: async () => true } }),
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/input", () => ({ Input: "input" }));
vi.mock("../ui/switch", () => ({ Switch: "switch" }));
vi.mock("../ui/menu", () => ({ Menu: "menu", MenuPopup: "popup", MenuTrigger: "trigger" }));
vi.mock("../ui/tooltip", () => ({
  Tooltip: "tooltip",
  TooltipPopup: "popup",
  TooltipTrigger: "trigger",
}));
vi.mock("../ui/select", () => ({
  Select: "select",
  SelectItem: "option",
  SelectPopup: "popup",
  SelectTrigger: "trigger",
  SelectValue: "value",
  SelectButton: "button",
}));
vi.mock("./BackgroundControls", () => ({
  BackgroundControls: () => null,
  RangeControl: () => null,
  StudioField: ({ children }: { children: unknown }) => children,
}));
vi.mock("./BackgroundImagePicker", () => ({
  BackgroundImagePicker: () => null,
  BackgroundThumbnail: () => null,
  backgroundPickerDeleteRevealClass: "",
  backgroundPickerMenuGridClass: "",
  backgroundPickerTileClass: () => "",
  backgroundStudioFieldClass: () => "",
}));

import { useBackgroundStudioStore } from "~/customBackground/backgroundStudioStore";
import { BackgroundStudioPanel } from "./BackgroundStudioPanel";
import { BackgroundImagePicker } from "./BackgroundImagePicker";
import { RangeControl } from "./BackgroundControls";

const original: CustomBackgroundRecord = {
  id: "first",
  name: "First",
  createdAt: "2026-09-11",
  fade: 100,
  fadeHeight: 60,
  fadeSoftness: 30,
  opacity: 100,
  blur: 0,
  brightnessAdapt: 0,
  folders: [],
  source: { kind: "none" },
  filter: defaultCustomBackgroundFilter("none"),
};
const other = { ...original, id: "second", name: "Second" };
const uploadedId = "b".repeat(64);
let renderer: ReactTestRenderer;
let finishUpload: () => void;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", new EventTarget());
  vi.useFakeTimers();
  state.filtersAvailable = true;
  state.settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    customBackgrounds: [original, other],
    activeCustomBackgroundId: original.id,
  };
  useBackgroundStudioStore.setState({ preview: null });
  const upload = new Promise<{ ok: true; image: { id: string } }>((resolve) => {
    finishUpload = () => resolve({ ok: true, image: { id: uploadedId } });
  });
  state.upload.mockReset().mockReturnValue(upload);
  await act(async () => {
    renderer = create(<BackgroundStudioPanel />);
  });
  act(() =>
    renderer.root
      .findByType(BackgroundImagePicker)
      .props.onUpload([new File(["photo"], "photo.png")]),
  );
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("preserves both persisted and pending edits when encoding finishes", async () => {
  act(() => renderer.root.findByProps({ "aria-label": "Rename playlist" }).props.onClick());
  act(() => {
    renderer.root
      .findByProps({ "aria-label": "Playlist name" })
      .props.onChange({ currentTarget: { value: "Renamed" } });
  });
  act(() => renderer.root.findByProps({ "aria-label": "Playlist name" }).props.onBlur());
  act(() => vi.advanceTimersByTime(150));
  act(() => renderer.root.findAllByType(RangeControl)[0]!.props.onChange(35));
  await act(async () => finishUpload());
  expect(state.settings?.customBackgrounds[0]).toEqual({
    ...original,
    name: "Renamed",
    fade: 35,
    fadeHeight: 60,
    fadeSoftness: 30,
    opacity: 100,
    blur: 0,
    brightnessAdapt: 0,
    source: {
      kind: "image",
      imageIds: [uploadedId],
      rotationMinutes: 15,
      order: "sequential",
      transition: "fade",
    },
  });
});

it("does not resurrect a background deleted during encoding", async () => {
  await act(async () =>
    renderer.root.findByProps({ "aria-label": "Delete background First" }).props.onClick(),
  );
  await act(async () => finishUpload());
  expect(state.settings?.customBackgrounds).toEqual([other]);
  expect(state.settings?.activeCustomBackgroundId).toBeNull();
});

it("keeps pending changes and selection on another background", async () => {
  act(() => renderer.root.findByProps({ "aria-label": "Second, No filter" }).props.onClick());
  act(() => renderer.root.findAllByType(RangeControl)[0]!.props.onChange(20));
  await act(async () => finishUpload());
  expect(state.settings?.activeCustomBackgroundId).toBe(other.id);
  expect(state.settings?.customBackgrounds).toEqual([
    {
      ...original,
      source: {
        kind: "image",
        imageIds: [uploadedId],
        rotationMinutes: 15,
        order: "sequential",
        transition: "fade",
      },
    },
    { ...other, fade: 20 },
  ]);
});

it("adds the import after an image chosen while encoding", async () => {
  const chosenId = "c".repeat(64);
  act(() => renderer.root.findByType(BackgroundImagePicker).props.onToggle(chosenId));
  await act(async () => finishUpload());
  expect(state.settings?.customBackgrounds[0]?.source).toEqual({
    kind: "image",
    imageIds: [chosenId, uploadedId],
    rotationMinutes: 15,
    order: "sequential",
    transition: "fade",
  });
});

it("still selects the import when the studio closes during encoding", async () => {
  await act(async () => renderer.unmount());
  await act(async () => finishUpload());
  expect(state.settings?.customBackgrounds[0]?.source).toMatchObject({
    kind: "image",
    imageIds: [uploadedId],
  });
});

it("imports only the new images when a folder is added again", async () => {
  await act(async () => finishUpload());
  const newId = "d".repeat(64);
  state.upload
    .mockResolvedValueOnce({ ok: true, image: { id: uploadedId }, existed: true })
    .mockResolvedValueOnce({ ok: true, image: { id: newId }, existed: false });
  await act(async () =>
    renderer.root
      .findByType(BackgroundImagePicker)
      .props.onUpload([new File(["photo"], "photo.png"), new File(["new"], "new.png")]),
  );
  expect(state.settings?.customBackgrounds[0]?.source).toMatchObject({
    imageIds: [uploadedId, newId],
  });
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toBe(
    "1 new, 1 already imported.",
  );
});

it("disables the filter selector and explains when WebGL is missing", async () => {
  state.filtersAvailable = false;
  await act(async () => {
    renderer.update(<BackgroundStudioPanel />);
  });
  expect(renderer.root.findByType("select").props.disabled).toBe(true);
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
    "Filters need WebGL",
  );
});

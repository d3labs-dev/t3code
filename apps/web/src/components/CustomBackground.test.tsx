import {
  DEFAULT_CLIENT_SETTINGS,
  defaultCustomBackgroundFilter,
  type CustomBackgroundRecord,
} from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ selected: null as CustomBackgroundRecord | null }));
vi.mock("~/customBackground/useActiveBackground", () => ({
  useActiveBackground: () => state.selected,
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("~/customBackground/backgroundStudioStore", () => ({
  useBackgroundStudioOpen: () => false,
  useBackgroundStudioStore: (select: (store: { preview: null }) => unknown) =>
    select({ preview: null }),
}));
vi.mock("~/customBackground/imageStore", () => ({
  useBackgroundImageUrl: () => false,
  useBackgroundImageSourceColor: () => false,
  useBackgroundImageTone: () => false,
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/customBackground/webgl", () => ({ isWebGlAvailable: () => true }));
vi.mock("./background/BackgroundRenderer", () => ({
  BackgroundRenderer: () => <div>Rendered background</div>,
}));
import { CustomBackground } from "./CustomBackground";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("draws nothing while the photo is missing, whatever the filter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const record: CustomBackgroundRecord = {
    id: "background",
    name: "Photo",
    createdAt: "2026-09-11",
    fade: 100,
    fadeHeight: 60,
    fadeSoftness: 30,
    opacity: 100,
    blur: 0,
    brightnessAdapt: 0,
    folders: [],
    source: {
      kind: "image",
      imageIds: ["a".repeat(64)],
      rotationMinutes: 10,
      order: "sequential",
      transition: "fade",
    },
    filter: defaultCustomBackgroundFilter("image-dithering"),
  };
  state.selected = record;
  await act(async () => {
    renderer = create(<CustomBackground routeKind="draft" />);
  });
  expect(renderer?.toJSON()).toBeNull();
  for (const kind of ["image-dithering", "none"] as const) {
    state.selected = { ...record, filter: defaultCustomBackgroundFilter(kind) };
    // Remount to read the selected record from the mocked settings boundary.
    await act(async () => {
      renderer?.update(<CustomBackground key={kind} routeKind="draft" />);
    });
    expect(renderer?.toJSON()).toBeNull();
  }
});

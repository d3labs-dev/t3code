import { DEFAULT_CLIENT_SETTINGS, defaultCustomBackgroundFilter } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createEmptyBackground } from "./customBackground/records";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clientPersistenceStorage", () => {
  it.each(["not-json", '{"wordWrap":"invalid"}'])(
    "does not treat invalid saved settings as absent: %s",
    async (value) => {
      const testWindow = getTestWindow();
      testWindow.localStorage.setItem("t3code:client-settings:v1", value);
      const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

      expect(() => readBrowserClientSettings()).toThrow(
        expect.objectContaining({
          _tag: "LocalStorageOperationError",
          operation: "decode",
          storageKey: "t3code:client-settings:v1",
        }),
      );
      expect(testWindow.localStorage.getItem("t3code:client-settings:v1")).toBe(value);
    },
  );

  it.each([{ enabled: false }, { enabled: true }])(
    "keeps background visibility after reload: %j",
    async ({ enabled }) => {
      getTestWindow();
      const { writeBrowserClientSettings } = await import("./clientPersistenceStorage");
      const record = createEmptyBackground({
        id: "saved-background",
        name: "Mesh",
        filter: defaultCustomBackgroundFilter("image-dithering"),
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      const settings = {
        ...DEFAULT_CLIENT_SETTINGS,
        customBackgrounds: [record],
        activeCustomBackgroundId: record.id,
        customBackgroundEnabled: enabled,
      };
      writeBrowserClientSettings(settings);

      // Reload modules while keeping the browser's persisted storage.
      vi.resetModules();
      const { readBrowserClientSettings } = await import("./clientPersistenceStorage");
      const reloaded = readBrowserClientSettings();
      expect(reloaded).toEqual(settings);
    },
  );

  it("reports structured decode failures while preserving the fallback", async () => {
    const testWindow = getTestWindow();
    const settings = { ...DEFAULT_CLIENT_SETTINGS, timestampFormat: "12-hour" as const };
    testWindow.localStorage.setItem("t3code:client-settings:v1", JSON.stringify(settings));
    const write = vi.spyOn(testWindow.localStorage, "setItem");
    const failure = new Error("storage unavailable");
    vi.spyOn(testWindow.localStorage, "getItem").mockImplementationOnce(() => {
      throw failure;
    });
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(() => readBrowserClientSettings()).toThrow(
      expect.objectContaining({
        _tag: "LocalStorageOperationError",
        operation: "read",
        storageKey: "t3code:client-settings:v1",
        cause: failure,
      }),
    );
    expect(readBrowserClientSettings()).toEqual(settings);
    expect(write).not.toHaveBeenCalled();
  });
});

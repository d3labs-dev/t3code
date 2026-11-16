import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CUSTOM_BACKGROUND_FILTERS,
  IMAGE_DITHERING_PRESETS,
  CustomBackgroundFilter,
  CustomBackgroundRecord,
  defaultCustomBackgroundFilter,
} from "./customBackground.ts";

const decodeFilter = Schema.decodeUnknownSync(CustomBackgroundFilter);
const decodeRecord = Schema.decodeUnknownSync(CustomBackgroundRecord);
const encodeRecord = Schema.encodeSync(CustomBackgroundRecord);

describe("CustomBackgroundFilter", () => {
  it.each(CUSTOM_BACKGROUND_FILTERS.map((filter) => filter.kind))(
    "accepts the defaults of %s",
    (kind) => {
      expect(decodeFilter(defaultCustomBackgroundFilter(kind))).toEqual(
        defaultCustomBackgroundFilter(kind),
      );
    },
  );

  it.each(IMAGE_DITHERING_PRESETS.map((preset) => preset.id))(
    "accepts the %s dithering preset",
    (id) => {
      const preset = IMAGE_DITHERING_PRESETS.find((candidate) => candidate.id === id);
      expect(preset).toBeDefined();
      expect(decodeFilter(preset!.filter)).toEqual(preset!.filter);
    },
  );

  it("gives every dithering preset a distinct id", () => {
    expect(new Set(IMAGE_DITHERING_PRESETS.map((preset) => preset.id)).size).toBe(
      IMAGE_DITHERING_PRESETS.length,
    );
  });

  it("rejects values outside the playground range", () => {
    expect(() =>
      decodeFilter({ ...defaultCustomBackgroundFilter("image-dithering"), size: 21 }),
    ).toThrow();
    expect(() =>
      decodeFilter({ ...defaultCustomBackgroundFilter("image-dithering"), colorSteps: 2.5 }),
    ).toThrow();
    expect(() =>
      decodeFilter({ ...defaultCustomBackgroundFilter("image-dithering"), colorBack: "red" }),
    ).toThrow();
  });

  it("rejects unknown and retired filters outside saved records", () => {
    expect(() => decodeFilter({ kind: "mesh-gradient" })).toThrow();
    expect(() => decodeFilter({ kind: "water" })).toThrow();
  });

  it("loads the removed gradient and lens filters as no filter in saved records", () => {
    for (const kind of [
      "fluted-glass",
      "lens-distortion",
      "static-mesh-gradient",
      "grain-gradient",
    ]) {
      expect(() => decodeFilter({ kind })).toThrow();
      const record = decodeRecord({
        id: "bg-1",
        name: "Old",
        source: { kind: "none" },
        filter: { kind, scale: 1 },
        fade: 50,
        createdAt: "2026-09-08T00:00:00.000Z",
      });
      expect(record.filter).toEqual({ kind: "none" });
    }
  });

  it("loads removed transitions as a fade", () => {
    const record = decodeRecord({
      id: "bg-1",
      name: "Old",
      source: { kind: "image", imageIds: ["a".repeat(64)], transition: "zoom" },
      filter: { kind: "none" },
      fade: 50,
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    expect(record.source).toMatchObject({ transition: "fade" });
  });
});

describe("CustomBackgroundRecord", () => {
  it("accepts a record that has no image yet", () => {
    const record = decodeRecord({
      id: "bg-1",
      name: "Empty",
      source: { kind: "none" },
      filter: defaultCustomBackgroundFilter("image-dithering"),
      fade: 50,
      fadeHeight: 60,
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    expect(record.source.kind).toBe("none");
  });

  it("rejects blank names and fades outside 0-100", () => {
    const base = {
      id: "bg-1",
      name: "Sunset",
      source: { kind: "none" },
      filter: { kind: "none" },
      fade: 50,
      fadeHeight: 60,
      createdAt: "2026-09-08T00:00:00.000Z",
    };
    expect(() => decodeRecord({ ...base, name: "   " })).toThrow();
    expect(() => decodeRecord({ ...base, fade: 101 })).toThrow();
    expect(() => decodeRecord({ ...base, fade: 12.5 })).toThrow();
  });

  it("loads a record whose filter was retired as no filter", () => {
    const record = decodeRecord({
      id: "bg-1",
      name: "Sunset",
      source: {
        kind: "image",
        imageIds: ["a".repeat(64)],
        rotationMinutes: 10,
        order: "sequential",
        transition: "fade",
      },
      filter: { kind: "water", size: 1 },
      fade: 50,
      fadeHeight: 60,
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    expect(record.filter).toEqual({ kind: "none" });
    expect(record.source).toEqual({
      kind: "image",
      imageIds: ["a".repeat(64)],
      rotationMinutes: 10,
      order: "sequential",
      transition: "fade",
    });
    expect(encodeRecord(record).filter).toEqual({ kind: "none" });
  });
});

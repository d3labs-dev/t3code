import { describe, expect, it } from "vite-plus/test";

import {
  ADAPT_MAX_REDUCTION,
  adaptToBrightness,
  type PictureTone,
  readableSurfaceOpacity,
  summarizePictureTone,
} from "./customBackgroundBrightness.js";

const chosen = { opacity: 90, fade: 0 };
const nightSky = { lightness: 0.2, colorfulness: 0.1 };
const vividRed = { lightness: 0.38, colorfulness: 0.45 };
const whitePicture = { lightness: 0.85, colorfulness: 0.1 };

const adapt = (
  tone: typeof nightSky,
  appearance: "dark" | "light" = "dark",
  brightnessAdapt = 100,
) =>
  adaptToBrightness({
    ...chosen,
    brightnessAdapt,
    tone,
    appearance,
    maxReduction: ADAPT_MAX_REDUCTION.behindBubbles,
  });

describe("adaptToBrightness", () => {
  it("keeps the chosen look when adapt is off", () => {
    expect(adapt(whitePicture, "dark", 0)).toEqual(chosen);
  });

  it("barely touches a dark, muted picture under a dark theme", () => {
    expect(adapt(nightSky)).toEqual({ opacity: 89, fade: 1 });
  });

  it("calms a saturated picture even though it measures only mid lightness", () => {
    expect(adapt(vividRed)).toEqual({ opacity: 59, fade: 34 });
  });

  it("keeps at least half of a white picture at full strength", () => {
    expect(adapt(whitePicture)).toEqual({ opacity: 49, fade: 45 });
    expect(adapt({ lightness: 1, colorfulness: 1 })).toEqual({ opacity: 45, fade: 50 });
  });

  it("keeps more of the picture when panels carry readability themselves", () => {
    expect(
      adaptToBrightness({
        ...chosen,
        brightnessAdapt: 100,
        tone: whitePicture,
        appearance: "dark",
        maxReduction: ADAPT_MAX_REDUCTION.behindReadablePanels,
      }),
    ).toEqual({ opacity: 70, fade: 23 });
  });

  it("dims dark pictures under a light theme instead of bright ones", () => {
    expect(adapt(nightSky, "light").opacity).toBeLessThan(adapt(whitePicture, "light").opacity);
  });
});

describe("summarizePictureTone", () => {
  it("reads the lightest and darkest tenths and how hard the edges are", () => {
    const samples = Array.from({ length: 11 }, (_, index) => ({
      tone: index % 2 === 0 ? 10 : 90,
      chroma: 0,
    }));
    expect(summarizePictureTone(samples)).toEqual({
      lightness: expect.closeTo(0.464, 3),
      colorfulness: 0,
      highlights: 0.9,
      shadows: 0.1,
      detail: 0.8,
    });
    expect(summarizePictureTone([])).toBeNull();
  });
});

describe("readableSurfaceOpacity", () => {
  const tone = (overrides: Partial<PictureTone>): PictureTone => ({
    lightness: 0.5,
    colorfulness: 0.2,
    highlights: 0.3,
    shadows: 0.1,
    detail: 0.01,
    ...overrides,
  });
  const floor = (
    measures: Partial<PictureTone>,
    {
      pictureOpacity = 100,
      appearance = "dark",
    }: { pictureOpacity?: number; appearance?: "dark" | "light" } = {},
  ) => readableSurfaceOpacity({ tone: tone(measures), pictureOpacity, appearance });

  it("leaves panels at the user's opacity over a dark, calm picture", () => {
    expect(floor({ highlights: 0.4 })).toBe(0);
  });

  it("covers bright patches under light text, less so once the picture is dimmed", () => {
    expect(floor({ highlights: 0.97 })).toBe(61);
    expect(floor({ highlights: 0.97 }, { pictureOpacity: 50 })).toBe(17);
  });

  it("covers busy detail even when the picture is dark", () => {
    expect(floor({ highlights: 0.3, detail: 0.065 })).toBe(38);
  });

  it("covers dark patches under a light theme's dark text", () => {
    expect(floor({ shadows: 0.05 }, { appearance: "light" })).toBe(58);
    expect(floor({ shadows: 0.9 }, { appearance: "light" })).toBe(0);
  });

  it("keeps panels glass rather than solid", () => {
    expect(floor({ highlights: 1, detail: 1 })).toBe(85);
  });
});

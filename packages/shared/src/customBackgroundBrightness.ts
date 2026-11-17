import type { CustomBackgroundRecord } from "@t3tools/contracts";

import type { ThemeAppearance } from "./themePalettes.js";

/** How loud a picture is behind text, each measure 0 to 1. */
export interface PictureTone {
  /** Mean lightness. */
  readonly lightness: number;
  readonly colorfulness: number;
  /** Lightness of the lightest tenth: the patches light text lands on. */
  readonly highlights: number;
  /** Lightness of the darkest tenth: the patches dark text lands on. */
  readonly shadows: number;
  /**
   * Lightness step between neighboring samples that only a tenth exceed: how
   * hard the picture's edges are. A mean would call flat cel art with bold
   * outlines calm.
   */
  readonly detail: number;
}

// Material's chroma tops out near 120 for the most saturated sRGB colors.
const FULL_CHROMA = 100;

/** Samples in reading order, so neighbors in the list are neighbors in the picture. */
export function summarizePictureTone(
  samples: ReadonlyArray<{ readonly tone: number; readonly chroma: number }>,
): PictureTone | null {
  if (samples.length === 0) return null;
  let tone = 0;
  let chroma = 0;
  const steps: number[] = [];
  samples.forEach((sample, index) => {
    tone += sample.tone;
    chroma += Math.min(FULL_CHROMA, sample.chroma);
    if (index > 0) steps.push(Math.abs(sample.tone - samples[index - 1]!.tone));
  });
  const tones = samples.map((sample) => sample.tone).sort((a, b) => a - b);
  steps.sort((a, b) => a - b);
  const at = (sorted: ReadonlyArray<number>, fraction: number) =>
    (sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0) / 100;
  return {
    lightness: tone / samples.length / 100,
    colorfulness: chroma / samples.length / FULL_CHROMA,
    highlights: at(tones, 0.9),
    shadows: at(tones, 0.1),
    detail: at(steps, 0.9),
  };
}

/**
 * How far a picture may lean toward the text color before it gets adjusted:
 * a night sky under a dark theme already reads well at the chosen values.
 */
const NEUTRAL_LOUDNESS = 0.25;
/**
 * Saturated reds and oranges compete with text as much as white does while
 * measuring only mid lightness, so colorfulness counts toward loudness too.
 */
const COLORFULNESS_WEIGHT = 1;
/**
 * How much of the picture full adapt may take away. On the phone, bubbles
 * carry the rest of readability. In the desktop window the panels raise their
 * own opacity to the readable floor, so the picture itself keeps more.
 */
export const ADAPT_MAX_REDUCTION = { behindBubbles: 0.5, behindReadablePanels: 0.25 } as const;
/** Barely loud pictures barely change; the adjustment builds as they get louder. */
const CURVE = 1.5;

export type BackgroundLook = Pick<CustomBackgroundRecord, "opacity" | "fade">;

/** How much a picture competes with text under the theme, 0 to 1. */
function pictureLoudness(
  tone: Pick<PictureTone, "lightness" | "colorfulness">,
  appearance: ThemeAppearance,
): number {
  const towardText = appearance === "dark" ? tone.lightness : 1 - tone.lightness;
  return Math.min(1, towardText + COLORFULNESS_WEIGHT * tone.colorfulness);
}

/**
 * Lowers the picture's opacity and raises its fade by how loud it is behind
 * text, scaled by `brightnessAdapt`. Under a light theme the dark pictures are
 * the ones that compete with the text.
 */
export function adaptToBrightness({
  opacity,
  fade,
  brightnessAdapt,
  tone,
  appearance,
  maxReduction,
}: Pick<CustomBackgroundRecord, "opacity" | "fade" | "brightnessAdapt"> & {
  tone: Pick<PictureTone, "lightness" | "colorfulness">;
  appearance: ThemeAppearance;
  maxReduction: (typeof ADAPT_MAX_REDUCTION)[keyof typeof ADAPT_MAX_REDUCTION];
}): BackgroundLook {
  const loudness = pictureLoudness(tone, appearance);
  const excess = Math.min(1, Math.max(0, (loudness - NEUTRAL_LOUDNESS) / (1 - NEUTRAL_LOUDNESS)));
  const reduction = (brightnessAdapt / 100) * maxReduction * excess ** CURVE;
  return {
    opacity: Math.round(opacity * (1 - reduction)),
    fade: Math.round(fade + (100 - fade) * reduction),
  };
}

/**
 * Lightness, 0 to 1, of the theme's page, its panels, and the furthest a
 * panel's backdrop may lean toward the text before body text drops under a
 * 4.5:1 contrast. Dynamic themes drift around these, so they are typical
 * values rather than measured ones.
 */
const SURFACE_LIGHTNESS = {
  dark: { page: 0.15, panel: 0.2, textLimit: 0.5 },
  light: { page: 0.98, panel: 0.96, textLimit: 0.58 },
} as const;
/** Busier than this and the picture's edges start to read as strokes through the text. */
const MAX_VISIBLE_DETAIL = 0.04;
/** A panel stays glass, never a solid sheet: text shadow covers the last stretch. */
const MAX_READABLE_OPACITY = 0.85;

/**
 * The least panel opacity, 0 to 100, that keeps text readable over the picture
 * as shown: bright patches under light text (or dark under dark text) must be
 * covered enough to keep contrast, and busy detail enough to stop competing.
 * `pictureOpacity` is the picture's own opacity after brightness adapt.
 */
export function readableSurfaceOpacity({
  tone,
  pictureOpacity,
  appearance,
}: {
  tone: PictureTone;
  pictureOpacity: number;
  appearance: ThemeAppearance;
}): number {
  const shown = pictureOpacity / 100;
  const surface = SURFACE_LIGHTNESS[appearance];
  const towardText = appearance === "dark" ? tone.highlights : tone.shadows;
  const backdrop = shown * towardText + (1 - shown) * surface.page;
  const contrastNeed =
    appearance === "dark"
      ? (backdrop - surface.textLimit) / (backdrop - surface.panel)
      : (surface.textLimit - backdrop) / (surface.panel - backdrop);
  const detail = shown * tone.detail;
  const detailNeed = detail > MAX_VISIBLE_DETAIL ? 1 - MAX_VISIBLE_DETAIL / detail : 0;
  const need = Math.min(MAX_READABLE_OPACITY, Math.max(0, contrastNeed, detailNeed));
  return Math.round(need * 100);
}

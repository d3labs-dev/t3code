import { Hct, QuantizerCelebi, Score } from "@material/material-color-utilities";

import type { PictureTone } from "@t3tools/shared/customBackgroundBrightness";

import { createCanvas } from "~/lib/imageCompression";

/**
 * Android quantizes a downscaled wallpaper rather than the real one, and the
 * ranking only needs a representative pixel population. 112px keeps a whole
 * playlist's extraction well inside a frame.
 */
const SAMPLE_DIMENSION = 112;
/** Material's own bucket count for wallpaper extraction. */
const QUANTIZE_BUCKETS = 128;

function opaquePixels(data: Uint8ClampedArray): number[] {
  const pixels: number[] = [];
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] !== 255) continue;
    pixels.push(
      ((255 << 24) | (data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!) >>> 0,
    );
  }
  return pixels;
}

/** The picture's opaque pixels as ARGB, downscaled; null when it cannot be decoded. */
async function samplePixels(blob: Blob): Promise<number[] | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, SAMPLE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const target = createCanvas(width, height);
    if (!target) return null;
    target.context.drawImage(bitmap, 0, 0, width, height);
    const pixels = opaquePixels(target.context.getImageData(0, 0, width, height).data);
    return pixels.length === 0 ? null : pixels;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * The ARGB seed Material builds a scheme from, seen through the same quantize
 * and score pass Android runs on a wallpaper. Returns null when the picture
 * cannot be decoded or scores nothing, which leaves the selected theme alone.
 */
export async function sourceColorFromImage(blob: Blob): Promise<number | null> {
  const pixels = await samplePixels(blob);
  if (!pixels) return null;
  return seedFromPixels(pixels);
}

/**
 * Score substitutes Google blue when no color clears its chroma cutoff, which
 * would paint a black-and-white picture's interface blue. Quantized colors are
 * always opaque, so a transparent fallback marks that case.
 */
const UNSCORED = 0;

export function seedFromPixels(pixels: number[]): number | null {
  const [seed] = Score.score(QuantizerCelebi.quantize(pixels, QUANTIZE_BUCKETS), {
    fallbackColorARGB: UNSCORED,
  });
  return seed === undefined || seed === UNSCORED ? null : seed;
}

// Material's chroma tops out near 120 for the most saturated sRGB colors.
const FULL_CHROMA = 100;

/** Mean HCT tone and chroma of the picture; null when it cannot be decoded. */
export async function toneFromImage(blob: Blob): Promise<PictureTone | null> {
  const pixels = await samplePixels(blob);
  if (!pixels) return null;
  let tone = 0;
  let chroma = 0;
  for (const pixel of pixels) {
    const hct = Hct.fromInt(pixel);
    tone += hct.tone;
    chroma += Math.min(FULL_CHROMA, hct.chroma);
  }
  return {
    lightness: tone / pixels.length / 100,
    colorfulness: chroma / pixels.length / FULL_CHROMA,
  };
}

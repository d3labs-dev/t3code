import type { CustomBackgroundImageId } from "@t3tools/contracts";
import type { PictureTone } from "@t3tools/shared/customBackgroundBrightness";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import type { ImageRef } from "expo-image-manipulator";
import { Directory, File, Paths } from "expo-file-system";

import { beginForegroundHandoff } from "../../lib/foreground-handoff";
import { type AddedPicture, sourceColorFromPixels, toneFromPixels } from "./phoneBackground.logic";
import { decodePngPixels } from "./pngPixels";

// Enough to cover a phone screen without keeping the camera original.
const PICTURE_MAX_EDGE = 1920;
const PICTURE_QUALITY = 0.85;
// Material scores a downscaled wallpaper; this is the desktop's sample size.
const COLOR_SAMPLE_EDGE = 112;
const PICTURE_DIRECTORY = "phone-background";

/** Where a picture lives in the phone's own storage, named by its content hash. */
export function phonePictureFile(imageId: CustomBackgroundImageId): File {
  return new File(Paths.document, PICTURE_DIRECTORY, `${imageId}.webp`);
}

type ImageManipulatorModule = typeof import("expo-image-manipulator");
const fitWithin = (image: ImageRef, edge: number) =>
  image.width >= image.height
    ? { width: Math.min(edge, image.width) }
    : { height: Math.min(edge, image.height) };

/** The picture's pixels at the desktop's color sample size, as RGBA. */
async function samplePixels(
  { ImageManipulator, SaveFormat }: ImageManipulatorModule,
  source: ImageRef,
): Promise<Uint8Array | null> {
  const sample = await ImageManipulator.manipulate(source)
    .resize(fitWithin(source, COLOR_SAMPLE_EDGE))
    .renderAsync();
  const sampled = await sample.saveAsync({ format: SaveFormat.PNG, base64: true });
  sample.release();
  if (!sampled.base64) return null;
  return decodePngPixels(Uint8Array.from(atob(sampled.base64), (char) => char.charCodeAt(0))).rgba;
}

async function storePicture(uri: string): Promise<AddedPicture> {
  const manipulator = await import("expo-image-manipulator");
  const { ImageManipulator, SaveFormat } = manipulator;
  const source = await ImageManipulator.manipulate(uri).renderAsync();
  const fit = (edge: number) => fitWithin(source, edge);
  try {
    const full = await ImageManipulator.manipulate(source)
      .resize(fit(PICTURE_MAX_EDGE))
      .renderAsync();
    const saved = await full.saveAsync({ format: SaveFormat.WEBP, compress: PICTURE_QUALITY });
    full.release();
    const pixels = await samplePixels(manipulator, source);
    const rendered = new File(saved.uri);
    const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, await rendered.bytes()));
    const imageId = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const stored = phonePictureFile(imageId);
    if (stored.exists) {
      rendered.delete();
    } else {
      new Directory(Paths.document, PICTURE_DIRECTORY).create({
        idempotent: true,
        intermediates: true,
      });
      rendered.moveSync(stored);
    }
    return {
      imageId,
      sourceColor: pixels ? sourceColorFromPixels(pixels) : null,
    };
  } finally {
    source.release();
  }
}

/**
 * Picks photos from the phone's library and stores each as a 1920px WebP in
 * the app's own storage, with its colors scored for the image-colors theme.
 * Empty when the picker was cancelled.
 */
export async function pickPhonePictures(): Promise<ReadonlyArray<AddedPicture>> {
  const imagePicker = await import("expo-image-picker");
  // The picker covers the Android activity, which reports the app as backgrounded.
  const endHandoff = beginForegroundHandoff();
  let picked: Awaited<ReturnType<typeof imagePicker.launchImageLibraryAsync>>;
  try {
    picked = await imagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      base64: false,
      quality: 1,
      shouldDownloadFromNetwork: true,
    });
  } finally {
    endHandoff();
  }
  if (picked.canceled) return [];
  const pictures: AddedPicture[] = [];
  for (const asset of picked.assets) pictures.push(await storePicture(asset.uri));
  return pictures;
}

export interface PictureMeasure {
  readonly tone: PictureTone | null;
  readonly sourceColor: number | null;
}

/**
 * Measured on first use, like the desktop, so folder photos and pictures added
 * before brightness adapt existed get a tone and colors too. Null when unreadable.
 */
export async function measurePhonePicture(uri: string): Promise<PictureMeasure | null> {
  try {
    const manipulator = await import("expo-image-manipulator");
    const source = await manipulator.ImageManipulator.manipulate(uri).renderAsync();
    try {
      const pixels = await samplePixels(manipulator, source);
      return pixels
        ? { tone: toneFromPixels(pixels), sourceColor: sourceColorFromPixels(pixels) }
        : null;
    } finally {
      source.release();
    }
  } catch {
    return null;
  }
}

export function deletePhonePicture(imageId: CustomBackgroundImageId): void {
  const file = phonePictureFile(imageId);
  if (file.exists) file.delete();
}

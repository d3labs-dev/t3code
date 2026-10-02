import { Hct, argbFromHex } from "@material/material-color-utilities";
import { expect, it } from "vite-plus/test";

import { seedFromPixels } from "./sourceColor";

function picture(colors: Record<string, number>): number[] {
  return Object.entries(colors).flatMap(([hex, count]) =>
    Array.from({ length: count }, () => argbFromHex(hex)),
  );
}

it("seeds from a picture's dominant color", () => {
  const seed = seedFromPixels(picture({ "#000000": 600, "#2f8f93": 400 }));
  expect(seed).not.toBeNull();
  expect(Math.abs(Hct.fromInt(seed!).hue - Hct.fromInt(argbFromHex("#2f8f93")).hue)).toBeLessThan(
    10,
  );
});

it("leaves a black-and-white picture without a seed instead of Google blue", () => {
  expect(seedFromPixels(picture({ "#000000": 700, "#ffffff": 200, "#808080": 100 }))).toBeNull();
});

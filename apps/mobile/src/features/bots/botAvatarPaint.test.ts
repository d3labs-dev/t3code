import { BOT_THEME_COLOR } from "@t3tools/client-runtime/bot-avatar";
import { describe, expect, it } from "vite-plus/test";

import { botAvatarPaint } from "./botAvatarPaint";

const THEME = {
  primary: "#4c8de0",
  primaryForeground: "#fafafa",
  foreground: "#111111",
  surface: "#ffffff",
} as const;

describe("botAvatarPaint", () => {
  it("paints the theme color with the theme's own primary and foreground", () => {
    const paint = botAvatarPaint(BOT_THEME_COLOR, "flat", THEME);
    expect(paint.fill).toBe(THEME.primary);
    expect(paint.eyes).toBe(THEME.primaryForeground);
  });

  it("gives flat bodies contrasting eyes and a hairline at the extremes", () => {
    const ink = botAvatarPaint("#242429", "flat", THEME);
    expect(ink.eyes).toBe("#fafafa");
    expect(ink.stroke).toBe("rgba(255, 255, 255, 0.16)");

    const cream = botAvatarPaint("#ece8df", "flat", THEME);
    expect(cream.eyes).toBe("#18181b");
    expect(cream.stroke).toBe("rgba(0, 0, 0, 0.12)");
  });
});

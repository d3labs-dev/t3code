import { BOT_AVATAR_COLORS } from "@t3tools/client-runtime/bot-avatar";
import { BOT_DEFAULT_COLOR } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botAvatarPaint, resolveBotAccentColor } from "./botAvatarPaint";

describe("resolveBotAccentColor", () => {
  it("follows the wallpaper theme for the theme color", () => {
    expect(resolveBotAccentColor("theme")).toBe("var(--primary)");
    expect(resolveBotAccentColor(" Theme ")).toBe("var(--primary)");
  });

  it("keeps readable CSS colors, trimmed", () => {
    expect(resolveBotAccentColor(" #F472B6 ")).toBe("#f472b6");
    expect(resolveBotAccentColor("#abc")).toBe("#abc");
    expect(resolveBotAccentColor("oklch(0.7 0.15 250)")).toBe("oklch(0.7 0.15 250)");
  });

  it("falls back to the default for colors CSS can't read", () => {
    expect(resolveBotAccentColor("")).toBe(BOT_DEFAULT_COLOR);
    expect(resolveBotAccentColor("#12345")).toBe(BOT_DEFAULT_COLOR);
    expect(resolveBotAccentColor("banana")).toBe(BOT_DEFAULT_COLOR);
    expect(resolveBotAccentColor("red; background: url(x)")).toBe(BOT_DEFAULT_COLOR);
  });

  it("resolves every curated color", () => {
    for (const option of BOT_AVATAR_COLORS) {
      expect(resolveBotAccentColor(option.value)).not.toBe(BOT_DEFAULT_COLOR);
    }
  });
});

describe("botAvatarPaint", () => {
  it("gives flat bodies the eye ink that contrasts with them", () => {
    expect(botAvatarPaint("#242429", "flat").eyes).toBe("#fafafa");
    expect(botAvatarPaint("#ece8df", "flat").eyes).toBe("#18181b");
    expect(botAvatarPaint("#45b282", "flat").eyes).toBe("#18181b");
    expect(botAvatarPaint("theme", "flat").eyes).toBe("var(--primary-foreground)");
  });
});

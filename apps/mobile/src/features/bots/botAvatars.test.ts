import { describe, expect, it } from "vite-plus/test";

import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  BOT_THEME_COLOR,
  DEFAULT_BOT_AVATAR_SHAPE,
  botAvatarExpression,
  botAvatarPaint,
  findBotAvatarShape,
  isBotImageIcon,
  isCustomBotEmoji,
  resolveBotAccentColor,
  resolveBotAvatarGlyph,
} from "./botAvatars";

const THEME = {
  primary: "#4c8de0",
  primaryForeground: "#fafafa",
  foreground: "#111111",
  surface: "#ffffff",
} as const;

describe("mobile botAvatars", () => {
  it("exposes all 14 sculpted shapes", () => {
    expect(BOT_AVATAR_SHAPES).toHaveLength(14);
    expect(BOT_AVATAR_COLORS).toHaveLength(13);
    expect(findBotAvatarShape("unknown-shape")).toBeNull();
  });

  it("resolves shapes, custom emojis, safe raster data urls, and falls back on unsafe urls", () => {
    expect(resolveBotAvatarGlyph("cat")).toEqual({
      kind: "shape",
      shape: findBotAvatarShape("cat"),
    });
    expect(resolveBotAvatarGlyph("🦊")).toEqual({ kind: "emoji", emoji: "🦊" });
    expect(isCustomBotEmoji("AI")).toBe(true);
    expect(isCustomBotEmoji("cat")).toBe(false);
    expect(isCustomBotEmoji("toolong")).toBe(false);

    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(isBotImageIcon(png)).toBe(true);
    expect(resolveBotAvatarGlyph(png)).toEqual({ kind: "image", src: png });

    const svg = "data:image/svg+xml;base64,PHN2Zz4=";
    expect(isBotImageIcon(svg)).toBe(false);
    expect(resolveBotAvatarGlyph(svg)).toEqual({ kind: "shape", shape: DEFAULT_BOT_AVATAR_SHAPE });
  });

  it("maps Bot status and mute state to eye expressions", () => {
    expect(botAvatarExpression("idle", false)).toBe("calm");
    expect(botAvatarExpression("working", false)).toBe("focused");
    expect(botAvatarExpression("waiting", false)).toBe("attentive");
    expect(botAvatarExpression("error", false)).toBe("error");
    expect(botAvatarExpression("working", true)).toBe("asleep");
  });

  it("computes native flat, glass, and minimal avatar paint with contrast-safe eyes", () => {
    expect(resolveBotAccentColor(BOT_THEME_COLOR, THEME.primary)).toBe(THEME.primary);

    const themeFlat = botAvatarPaint(BOT_THEME_COLOR, "flat", THEME);
    expect(themeFlat.fill).toBe(THEME.primary);
    expect(themeFlat.eyes).toBe(THEME.primaryForeground);

    const inkFlat = botAvatarPaint("#242429", "flat", THEME);
    expect(inkFlat.eyes).toBe("#fafafa");
    expect(inkFlat.stroke).toBe("rgba(255, 255, 255, 0.16)");

    const creamFlat = botAvatarPaint("#ece8df", "flat", THEME);
    expect(creamFlat.eyes).toBe("#18181b");
    expect(creamFlat.stroke).toBe("rgba(0, 0, 0, 0.12)");

    const glass = botAvatarPaint("#4c8de0", "glass", THEME);
    expect(glass.fill).toContain("rgba(");
    expect(glass.strokeWidth).toBe(1);

    const minimal = botAvatarPaint("#4c8de0", "minimal", THEME);
    expect(minimal.strokeWidth).toBe(1.5);
  });
});

import { BOT_DEFAULT_COLOR, BOT_DEFAULT_ICON } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  findBotAvatarShape,
  isCustomBotEmoji,
  resolveBotAccentColor,
  resolveBotAvatarGlyph,
} from "./botAvatars";

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

describe("findBotAvatarShape", () => {
  it("finds shapes by id regardless of case and padding", () => {
    expect(findBotAvatarShape("fox")?.id).toBe("fox");
    expect(findBotAvatarShape(" Ghost ")?.id).toBe("ghost");
  });

  it("returns null for unknown icons", () => {
    expect(findBotAvatarShape("rocket")).toBeNull();
    expect(findBotAvatarShape("🦊")).toBeNull();
  });

  it("includes the contract's default icon", () => {
    expect(findBotAvatarShape(BOT_DEFAULT_ICON)).not.toBeNull();
    expect(new Set(BOT_AVATAR_SHAPES.map((shape) => shape.id)).size).toBe(14);
  });
});

describe("isCustomBotEmoji", () => {
  it("accepts one or two graphemes, including joined emoji and flags", () => {
    expect(isCustomBotEmoji("🦊")).toBe(true);
    expect(isCustomBotEmoji("👩‍💻")).toBe(true);
    expect(isCustomBotEmoji("🇯🇵")).toBe(true);
    expect(isCustomBotEmoji("猫")).toBe(true);
    expect(isCustomBotEmoji("AI")).toBe(true);
  });

  it("rejects shape ids, empty text, and longer strings", () => {
    expect(isCustomBotEmoji("bot")).toBe(false);
    expect(isCustomBotEmoji("  ")).toBe(false);
    expect(isCustomBotEmoji("rocket")).toBe(false);
    expect(isCustomBotEmoji("🦊🦊🦊")).toBe(false);
  });
});

describe("resolveBotAvatarGlyph", () => {
  it("renders custom emoji as text", () => {
    expect(resolveBotAvatarGlyph(" 🦊 ")).toEqual({ kind: "emoji", emoji: "🦊" });
  });

  it("falls back to the default shape for icons it can't draw", () => {
    const glyph = resolveBotAvatarGlyph("rocket-launch");
    expect(glyph.kind === "shape" && glyph.shape.id).toBe(BOT_DEFAULT_ICON);
  });
});

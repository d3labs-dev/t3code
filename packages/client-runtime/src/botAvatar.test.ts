import { BOT_DEFAULT_ICON } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BOT_AVATAR_SHAPES,
  DEFAULT_BOT_AVATAR_SHAPE,
  botAvatarExpression,
  findBotAvatarShape,
  isCustomBotEmoji,
  resolveBotAvatarGlyph,
} from "./botAvatar.ts";

const PNG_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("findBotAvatarShape", () => {
  it("finds shapes by id regardless of case and padding", () => {
    expect(findBotAvatarShape("cat")?.id).toBe("cat");
    expect(findBotAvatarShape(" Cloud ")?.id).toBe("cloud");
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
    for (const icon of ["🦊", "👩‍💻", "🇯🇵", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "1️⃣", "👍🏽👍🏽", "猫", "AI"]) {
      expect(isCustomBotEmoji(icon)).toBe(true);
    }
  });

  it("rejects shape ids, empty text, and longer strings", () => {
    for (const icon of ["cat", "  ", "rocket", "🦊🦊🦊", "🇯🇵🇺🇸🇫🇷"]) {
      expect(isCustomBotEmoji(icon)).toBe(false);
    }
  });

  it("counts graphemes the way Intl.Segmenter does", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const icon of [
      "🛰️",
      "🛰️🛰️",
      "❤️‍🔥❤️",
      "🧑🏿‍🚀",
      "👁️‍🗨️",
      "🏳️‍🌈A",
      "🇯🇵🇺",
      "éé",
      "x̃yz",
      "#️⃣1️⃣",
      "😀😀😀",
      "🏴󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    ]) {
      expect(isCustomBotEmoji(icon), icon).toBe([...segmenter.segment(icon)].length <= 2);
    }
  });
});

describe("resolveBotAvatarGlyph", () => {
  it("draws shape ids as shapes", () => {
    expect(resolveBotAvatarGlyph("cat")).toEqual({
      kind: "shape",
      shape: findBotAvatarShape("cat"),
    });
  });

  it("renders custom emoji as text", () => {
    expect(resolveBotAvatarGlyph(" 🦊 ")).toEqual({ kind: "emoji", emoji: "🦊" });
  });

  it("renders uploaded raster data URLs as images", () => {
    expect(resolveBotAvatarGlyph(` ${PNG_ICON} `)).toEqual({ kind: "image", src: PNG_ICON });
    expect(resolveBotAvatarGlyph("data:image/webp;base64,UklGRg==").kind).toBe("image");
  });

  it("never renders SVG, script or other URLs as images", () => {
    for (const icon of [
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "javascript:alert(1)",
      "https://example.com/avatar.png",
      'data:image/png;base64,abc"onerror=alert(1)',
    ]) {
      expect(resolveBotAvatarGlyph(icon)).toEqual({
        kind: "shape",
        shape: DEFAULT_BOT_AVATAR_SHAPE,
      });
    }
  });

  it("falls back to the default shape for icons it can't draw", () => {
    expect(resolveBotAvatarGlyph("rocket-launch")).toEqual({
      kind: "shape",
      shape: DEFAULT_BOT_AVATAR_SHAPE,
    });
    expect(DEFAULT_BOT_AVATAR_SHAPE.id).toBe(BOT_DEFAULT_ICON);
  });
});

describe("botAvatarExpression", () => {
  it("maps Bot status and mute state to eye expressions", () => {
    expect(botAvatarExpression("idle", false)).toBe("calm");
    expect(botAvatarExpression(null, false)).toBe("calm");
    expect(botAvatarExpression("working", false)).toBe("focused");
    expect(botAvatarExpression("waiting", false)).toBe("attentive");
    expect(botAvatarExpression("error", false)).toBe("error");
    expect(botAvatarExpression("working", true)).toBe("asleep");
  });
});

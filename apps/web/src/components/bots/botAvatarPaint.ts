import {
  BOT_THEME_COLOR,
  type BotVisualStyle,
  isBotHexColor,
} from "@t3tools/client-runtime/bot-avatar";
import { BOT_DEFAULT_COLOR } from "@t3tools/contracts";
import { msg } from "gt-react";
import type { CSSProperties } from "react";

export const BOT_VISUAL_STYLES = [
  { id: "flat", label: msg("Flat") },
  { id: "glass", label: msg("Wallpaper glass") },
  { id: "minimal", label: msg("Outline") },
] as const satisfies ReadonlyArray<{ id: BotVisualStyle; label: string }>;

const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\d\s.,%/+-]+\)$/i;
const THEME_ACCENT = "var(--primary)";

/** The CSS color a Bot paints with; unreadable stored colors fall back to the default. */
export function resolveBotAccentColor(color: string): string {
  const trimmed = color.trim();
  if (trimmed.toLowerCase() === BOT_THEME_COLOR) return THEME_ACCENT;
  if (isBotHexColor(trimmed) || FUNCTIONAL_COLOR.test(trimmed)) return trimmed.toLowerCase();
  return BOT_DEFAULT_COLOR;
}

function relativeLuminance(hex: string): number | null {
  if (!isBotHexColor(hex)) return null;
  const digits = hex.slice(1);
  const full =
    digits.length <= 4
      ? Array.from(digits.slice(0, 3), (digit) => digit + digit).join("")
      : digits.slice(0, 6);
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const EYE_INK = "#18181b";
const EYE_PAPER = "#fafafa";
const EYE_INK_LUMINANCE = 0.0093;
const EYE_PAPER_LUMINANCE = 0.955;

function contrastRatio(lighter: number, darker: number): number {
  return (lighter + 0.05) / (darker + 0.05);
}

/** Ink or paper, whichever reads better on a solid body of this luminance. */
function eyeColorOn(luminance: number | null): string {
  if (luminance === null) return EYE_INK;
  return contrastRatio(luminance, EYE_INK_LUMINANCE) >=
    contrastRatio(EYE_PAPER_LUMINANCE, luminance)
    ? EYE_INK
    : EYE_PAPER;
}

// Near-black and near-white bodies vanish into dark and light chrome without a hairline.
const DARK_BODY_LUMINANCE = 0.05;
const LIGHT_BODY_LUMINANCE = 0.65;

function flatEdge(luminance: number | null): string | null {
  if (luminance === null) return null;
  if (luminance < DARK_BODY_LUMINANCE) return "rgb(255 255 255 / 16%)";
  if (luminance > LIGHT_BODY_LUMINANCE) return "rgb(0 0 0 / 12%)";
  return null;
}

export interface BotAvatarPaint {
  /** Fill and edge for the sculpted body; edges are screen pixels, so pair with a non-scaling stroke. */
  readonly body: CSSProperties;
  readonly eyes: string;
  /** Backdrop for emoji avatars. */
  readonly disc: CSSProperties;
}

/** The accent is runtime data, so the paint can't be a class. */
export function botAvatarPaint(color: string, visualStyle: BotVisualStyle): BotAvatarPaint {
  const accent = resolveBotAccentColor(color);
  switch (visualStyle) {
    case "flat": {
      const luminance = relativeLuminance(accent);
      const edge = flatEdge(luminance);
      return {
        body: edge === null ? { fill: accent } : { fill: accent, stroke: edge, strokeWidth: 1 },
        eyes: accent === THEME_ACCENT ? "var(--primary-foreground)" : eyeColorOn(luminance),
        disc: { backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)` },
      };
    }
    case "glass": {
      const edge = `color-mix(in srgb, ${accent} 65%, var(--foreground))`;
      return {
        body: {
          fill: `color-mix(in srgb, color-mix(in srgb, ${accent} 52%, var(--glass-surface)) 82%, transparent)`,
          stroke: edge,
          strokeWidth: 1,
        },
        eyes: "var(--foreground)",
        disc: {
          backgroundColor: `color-mix(in srgb, color-mix(in srgb, ${accent} 30%, var(--glass-surface)) 72%, transparent)`,
          boxShadow: `inset 0 0 0 1px ${edge}`,
        },
      };
    }
    case "minimal": {
      const line = `color-mix(in srgb, ${accent} 65%, var(--foreground))`;
      return {
        body: {
          fill: `color-mix(in srgb, ${accent} 10%, transparent)`,
          stroke: line,
          strokeWidth: 1.5,
        },
        eyes: line,
        disc: {
          backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
          boxShadow: `inset 0 0 0 1.5px ${line}`,
        },
      };
    }
  }
}

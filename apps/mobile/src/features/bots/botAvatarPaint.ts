import {
  BOT_THEME_COLOR,
  type BotVisualStyle,
  isBotHexColor,
} from "@t3tools/client-runtime/bot-avatar";
import { BOT_DEFAULT_COLOR } from "@t3tools/contracts";
import { msg } from "gt-react-native";

export const BOT_VISUAL_STYLES = [
  { id: "flat", label: msg("Flat", { $context: "Bot avatar finish" }) },
  { id: "glass", label: msg("Glass", { $context: "Bot avatar finish" }) },
  { id: "minimal", label: msg("Outline", { $context: "Bot avatar finish" }) },
] as const satisfies ReadonlyArray<{ id: BotVisualStyle; label: string }>;

type Rgb = readonly [number, number, number];

function parseHexRgb(hex: string): Rgb | null {
  const trimmed = hex.trim();
  if (!isBotHexColor(trimmed)) return null;
  const digits = trimmed.slice(1);
  const full =
    digits.length <= 4
      ? Array.from(digits.slice(0, 3), (digit) => digit + digit).join("")
      : digits.slice(0, 6);
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function rgbaString(rgb: Rgb, alpha: number): string {
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`;
}

function mixHex(left: string, right: string, leftWeight: number, alpha = 1): string {
  const a = parseHexRgb(left);
  const b = parseHexRgb(right);
  if (a === null) return left;
  if (b === null) return rgbaString(a, alpha);
  const rightWeight = 1 - leftWeight;
  return rgbaString(
    [
      a[0] * leftWeight + b[0] * rightWeight,
      a[1] * leftWeight + b[1] * rightWeight,
      a[2] * leftWeight + b[2] * rightWeight,
    ],
    alpha,
  );
}

function withAlpha(color: string, alpha: number): string {
  const rgb = parseHexRgb(color);
  return rgb === null ? color : rgbaString(rgb, alpha);
}

function relativeLuminance(hex: string): number | null {
  const rgb = parseHexRgb(hex);
  if (rgb === null) return null;
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
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

function eyeColorOn(luminance: number | null): string {
  if (luminance === null) return EYE_INK;
  return contrastRatio(luminance, EYE_INK_LUMINANCE) >=
    contrastRatio(EYE_PAPER_LUMINANCE, luminance)
    ? EYE_INK
    : EYE_PAPER;
}

const DARK_BODY_LUMINANCE = 0.05;
const LIGHT_BODY_LUMINANCE = 0.65;

function flatEdge(luminance: number | null): string | null {
  if (luminance === null) return null;
  if (luminance < DARK_BODY_LUMINANCE) return "rgba(255, 255, 255, 0.16)";
  if (luminance > LIGHT_BODY_LUMINANCE) return "rgba(0, 0, 0, 0.12)";
  return null;
}

export interface BotAvatarThemeColors {
  readonly primary: string;
  readonly primaryForeground: string;
  readonly foreground: string;
  readonly surface: string;
}

export interface BotAvatarPaint {
  readonly fill: string;
  readonly stroke: string | undefined;
  readonly strokeWidth: number;
  readonly eyes: string;
  readonly discBackground: string;
  readonly discBorderColor: string | undefined;
  readonly discBorderWidth: number;
}

export function resolveBotAccentColor(color: string, themePrimary: string): string {
  const trimmed = color.trim();
  if (trimmed.toLowerCase() === BOT_THEME_COLOR) return themePrimary;
  if (isBotHexColor(trimmed)) return trimmed.toLowerCase();
  return BOT_DEFAULT_COLOR;
}

export function botAvatarPaint(
  color: string,
  visualStyle: BotVisualStyle,
  theme: BotAvatarThemeColors,
): BotAvatarPaint {
  const isThemeColor = color.trim().toLowerCase() === BOT_THEME_COLOR;
  const accent = resolveBotAccentColor(color, theme.primary);
  switch (visualStyle) {
    case "flat": {
      const luminance = relativeLuminance(accent);
      const edge = flatEdge(luminance);
      return {
        fill: accent,
        stroke: edge ?? undefined,
        strokeWidth: edge === null ? 0 : 1,
        eyes: isThemeColor ? theme.primaryForeground : eyeColorOn(luminance),
        discBackground: withAlpha(accent, 0.18),
        discBorderColor: undefined,
        discBorderWidth: 0,
      };
    }
    case "glass": {
      const edge = mixHex(accent, theme.foreground, 0.65, 0.9);
      return {
        fill: mixHex(accent, theme.surface, 0.52, 0.82),
        stroke: edge,
        strokeWidth: 1,
        eyes: theme.foreground,
        discBackground: mixHex(accent, theme.surface, 0.3, 0.72),
        discBorderColor: edge,
        discBorderWidth: 1,
      };
    }
    case "minimal": {
      const line = mixHex(accent, theme.foreground, 0.65, 1);
      return {
        fill: withAlpha(accent, 0.12),
        stroke: line,
        strokeWidth: 1.5,
        eyes: line,
        discBackground: withAlpha(accent, 0.12),
        discBorderColor: line,
        discBorderWidth: 1.5,
      };
    }
  }
}

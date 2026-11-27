import { BOT_DEFAULT_COLOR, BOT_DEFAULT_ICON, type BotStatus } from "@t3tools/contracts";

export type BotVisualStyle = "flat" | "glass" | "minimal";

export const BOT_VISUAL_STYLES = [
  { id: "flat", label: "Flat" },
  { id: "glass", label: "Glass" },
  { id: "minimal", label: "Outline" },
] as const satisfies ReadonlyArray<{ id: BotVisualStyle; label: string }>;

const DEFAULT_VISUAL_STYLE: BotVisualStyle = "flat";

/** Reads a stored finish; earlier builds saved "playful", which is now the flat finish. */
export function parseBotVisualStyle(value: unknown): BotVisualStyle {
  return BOT_VISUAL_STYLES.find((style) => style.id === value)?.id ?? DEFAULT_VISUAL_STYLE;
}

export interface BotAvatarEyes {
  readonly x: number;
  readonly y: number;
  /** Half the distance between the two eye centers. */
  readonly gap: number;
  readonly scale: number;
}

// Paths fill a 24-unit box; eyes sit on each body's optical center, not its bounding box.
export const BOT_AVATAR_SHAPES = [
  {
    id: "circle",
    label: "Circle",
    path: "M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z",
    eyes: { x: 12, y: 11.6, gap: 3.4, scale: 1 },
  },
  {
    id: "pebble",
    label: "Pebble",
    path: "M12 3.71C14.57 4.31 18.68 6.53 20.46 8.47C21.18 9.25 21.72 10.18 22.02 11.19C22.44 12.64 22.32 14.19 21.73 15.58C19.77 20.21 13.88 22.09 9.26 21.05C5.97 20.31 3.14 18 2.28 14.67C0.68 8.5 5.37 2.16 12 3.71Z",
    eyes: { x: 11.6, y: 12.2, gap: 3.4, scale: 1 },
  },
  {
    id: "squircle",
    label: "Squircle",
    path: "M12 2.7C18.9 2.7 21.3 5.1 21.3 12S18.9 21.3 12 21.3 2.7 18.9 2.7 12 5.1 2.7 12 2.7Z",
    eyes: { x: 12, y: 11.6, gap: 3.4, scale: 1 },
  },
  {
    id: "capsule",
    label: "Capsule",
    path: "M12 1.8a6.9 6.9 0 0 1 6.9 6.9v6.6a6.9 6.9 0 0 1-13.8 0V8.7A6.9 6.9 0 0 1 12 1.8Z",
    eyes: { x: 12, y: 10.6, gap: 2.8, scale: 0.95 },
  },
  {
    id: "cloud",
    label: "Cloud",
    path: "M12 3.71C14.93 2.92 18.09 4.47 19.24 7.28C19.66 8.29 19.66 10.1 19.86 10.46C20.28 11.22 21.52 11.31 22.18 12.73C22.74 13.95 22.38 15.09 22.06 16.31C21.51 18.46 21.4 20.35 18.77 21.06C17.5 21.4 16 21.2 14.69 21.2C12.07 21.2 9.44 21.2 6.82 21.2C5.47 21.2 4.25 20.91 3.3 19.89C2.2 18.71 1.9 16.95 2.54 15.47C2.74 15.01 3.05 14.6 3.17 14.11C3.33 13.43 3.08 12.75 3.1 12.07C3.14 10.78 3.75 9.54 4.75 8.72C5.77 7.88 7.22 7.88 7.87 7.2C8.17 6.88 8.34 6.48 8.58 6.13C9.4 4.95 10.62 4.09 12 3.71Z",
    eyes: { x: 12.6, y: 14, gap: 3.4, scale: 1 },
  },
  {
    id: "clover",
    label: "Clover",
    path: "M12 1.8C13.8 1.8 15.51 2.79 16.42 4.35C16.8 5.01 16.9 5.83 17.39 6.41C17.93 7.04 18.8 7.13 19.49 7.5C20.76 8.17 21.7 9.37 22.05 10.77C22.58 12.89 21.66 15.17 19.8 16.33C19.08 16.78 18.1 16.87 17.49 17.49C16.91 18.06 16.81 18.96 16.42 19.65C15.51 21.21 13.8 22.2 12 22.2C10.2 22.2 8.49 21.21 7.58 19.65C7.2 18.99 7.1 18.17 6.61 17.59C6.07 16.96 5.2 16.87 4.51 16.5C3.24 15.83 2.3 14.63 1.95 13.23C1.42 11.11 2.34 8.83 4.2 7.67C4.92 7.22 5.9 7.13 6.51 6.51C7.09 5.94 7.19 5.04 7.58 4.35C8.49 2.79 10.2 1.8 12 1.8Z",
    eyes: { x: 12, y: 12, gap: 3.1, scale: 1 },
  },
  {
    id: "droplet",
    label: "Droplet",
    path: "M12 2.3C12.67 2.3 13.34 2.54 13.86 2.97C14.67 3.65 16.09 6.11 16.79 7.15C18.01 8.97 19.45 10.73 19.8 12.95C20.56 17.68 16.79 22.1 12 22.1C7.21 22.1 3.44 17.68 4.2 12.95C4.55 10.73 5.99 8.97 7.21 7.15C7.91 6.11 9.33 3.65 10.14 2.97C10.66 2.54 11.33 2.3 12 2.3Z",
    eyes: { x: 12, y: 14.2, gap: 3.1, scale: 1 },
  },
  {
    id: "star",
    label: "Star",
    path: "M12 1.7C12.61 1.7 13.2 1.96 13.61 2.41C14.25 3.09 15.15 5.57 15.61 6.6C15.71 6.83 15.8 7.15 15.95 7.36C16.05 7.5 17.01 7.53 17.22 7.56C18.48 7.69 19.84 7.69 21.07 7.98C22.44 8.3 23.16 9.88 22.52 11.12C22.01 12.1 18.8 14.39 18.47 14.96C18.38 15.12 18.74 16.44 18.8 16.68C19.01 17.67 19.55 19.43 19.48 20.35C19.4 21.43 18.5 22.32 17.42 22.38C16.28 22.44 14.29 20.99 13.23 20.38C13.04 20.27 12.17 19.67 12 19.67C11.83 19.67 10.96 20.27 10.77 20.38C10.09 20.77 9.42 21.16 8.74 21.55C7.68 22.16 6.59 22.79 5.44 21.97C4.18 21.08 4.57 19.68 4.84 18.4C5.01 17.59 5.18 16.79 5.35 15.99C5.41 15.7 5.53 15.37 5.55 15.08C5.55 14.89 4.81 14.31 4.64 14.16C3.73 13.34 2.51 12.44 1.75 11.52C0.85 10.45 1.21 8.77 2.46 8.15C3.45 7.66 7.21 7.72 7.96 7.43C8.12 7.37 8.62 6.09 8.72 5.87C9.44 4.24 10.04 1.7 12 1.7Z",
    eyes: { x: 12, y: 12.8, gap: 2.6, scale: 0.9 },
  },
  {
    id: "cat",
    label: "Cat",
    path: "M12 4.62C13.3 4.5 16.01 2.84 17.21 2.22C17.93 1.84 18.82 1.13 19.64 1.63C20.3 2.02 20.27 2.8 20.33 3.47C20.47 4.96 20.57 6.45 20.76 7.93C20.82 8.36 20.95 8.78 20.97 9.22C21 9.7 20.89 10.18 20.96 10.66C21.02 10.99 21.15 11.29 21.25 11.6C21.56 12.56 21.67 13.57 21.56 14.57C21.09 18.81 17.05 21.57 13.05 21.95C8.55 22.37 3.39 19.85 2.52 15.07C2.31 13.97 2.38 12.83 2.7 11.76C2.81 11.39 2.98 11.04 3.04 10.66C3.11 10.18 3 9.7 3.03 9.22C3.05 8.78 3.18 8.36 3.24 7.93C3.42 6.55 3.51 5.16 3.64 3.78C3.7 3.12 3.62 2.26 4.16 1.78C4.9 1.1 5.74 1.68 6.46 2.05C7.7 2.69 8.93 3.33 10.17 3.97C10.7 4.25 11.37 4.68 12 4.62Z",
    eyes: { x: 12, y: 13, gap: 3.6, scale: 1 },
  },
  {
    id: "arch",
    label: "Arch",
    path: "M12 2C15.85 2 19.32 4.67 20.31 8.39C20.72 9.95 20.48 10.77 20.51 12.26C20.52 12.96 20.6 13.66 20.6 14.36C20.6 15.65 20.78 18.3 20.5 19.4C20.14 20.77 18.9 21.75 17.5 21.8C14.37 21.91 11.21 21.8 8.08 21.8C6.6 21.8 5.14 21.88 4.11 20.62C3.04 19.29 3.4 16.37 3.4 14.67C3.4 13.86 3.48 13.06 3.49 12.26C3.52 10.9 3.3 9.96 3.65 8.56C4.58 4.75 8.08 2 12 2Z",
    eyes: { x: 12, y: 11.8, gap: 3.3, scale: 1 },
  },
  {
    id: "hexagon",
    label: "Hexagon",
    path: "M12 2.23C13.27 2.23 16.34 2.14 17.35 2.72C18.34 3.3 19.42 5.36 20.02 6.38C20.7 7.52 22.61 10.65 22.7 11.81C22.78 12.76 22.2 13.63 21.79 14.44C20.94 16.09 20.01 17.7 19.01 19.25C18.55 19.97 18.11 20.84 17.35 21.28C16.34 21.86 13.27 21.77 12 21.77C10.73 21.77 7.66 21.86 6.65 21.28C5.66 20.7 4.58 18.64 3.98 17.62C3.3 16.48 1.39 13.35 1.3 12.19C1.22 11.24 1.8 10.37 2.21 9.56C3.06 7.91 3.99 6.3 4.99 4.75C5.45 4.03 5.89 3.16 6.65 2.72C7.66 2.14 10.73 2.23 12 2.23Z",
    eyes: { x: 12, y: 11.6, gap: 3.6, scale: 1 },
  },
  {
    id: "triangle",
    label: "Triangle",
    path: "M12 2.62C13.84 2.62 14.78 4.04 15.74 5.39C17.81 8.31 19.57 11.4 21.04 14.67C21.69 16.13 22.49 17.63 21.67 19.21C20.9 20.66 19.49 20.92 18 21.07C16 21.28 14 21.4 12 21.4C10 21.4 8 21.28 6 21.07C4.51 20.92 3.1 20.66 2.33 19.21C1.51 17.63 2.31 16.13 2.96 14.67C4.43 11.4 6.19 8.31 8.26 5.39C9.22 4.04 10.16 2.62 12 2.62Z",
    eyes: { x: 12, y: 14.6, gap: 3, scale: 0.95 },
  },
  {
    id: "diamond",
    label: "Diamond",
    path: "M12 1.26C13.35 1.26 14.28 2.45 15.16 3.32C16.94 5.07 18.61 6.91 20.16 8.87C21.03 9.97 21.81 11.02 21.6 12.5C21.54 12.95 21.39 13.39 21.17 13.78C20.31 15.27 18 17.74 16.76 19.06C15.89 19.97 14.28 21.8 13.28 22.39C12.89 22.62 12.45 22.74 12 22.74C11.55 22.74 11.11 22.62 10.72 22.39C9.72 21.8 8.11 19.97 7.24 19.06C6 17.74 3.69 15.27 2.83 13.78C2.61 13.39 2.46 12.95 2.4 12.5C2.19 11.02 2.97 9.97 3.84 8.87C5.39 6.91 7.06 5.07 8.84 3.32C9.72 2.45 10.65 1.26 12 1.26Z",
    eyes: { x: 12, y: 12, gap: 3, scale: 0.95 },
  },
  {
    id: "crown",
    label: "Crown",
    path: "M12 1.8C14.15 1.8 14.55 5.79 15.86 6.43C16.58 6.77 17.24 5.77 17.6 5.37C18.51 4.37 19.6 2.89 21.06 3.94C22.07 4.68 21.97 7.19 22.09 8.41C22.19 9.48 22.72 13.58 22.56 14.37C22.36 15.33 21.41 15.87 21.24 16.82C20.95 18.38 21.66 20 19.5 21.24C18.27 21.96 16.64 21.7 15.27 21.7C12.25 21.7 9.22 21.75 6.2 21.7C4.56 21.67 3.12 20.5 2.85 18.87C2.73 18.14 2.92 17.37 2.72 16.66C2.49 15.79 1.63 15.28 1.44 14.37C1.28 13.58 1.91 8.41 2.02 7.27C2.1 6.4 2 5.22 2.46 4.46C2.92 3.71 4.1 3.27 4.88 3.83C5.43 4.22 5.97 4.9 6.4 5.37C6.74 5.75 7.32 6.64 8 6.48C8.52 6.35 8.77 5.71 9 5.3C9.66 4.12 10.47 1.8 12 1.8Z",
    eyes: { x: 12, y: 14.8, gap: 3.6, scale: 1 },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  path: string;
  eyes: BotAvatarEyes;
}>;

export type BotAvatarShape = (typeof BOT_AVATAR_SHAPES)[number];
export type BotAvatarShapeId = BotAvatarShape["id"];

// Bots saved before the sculpted set keep their look through the closest shape.
const LEGACY_SHAPE_IDS: Record<string, BotAvatarShapeId> = {
  bot: "squircle",
  chief: "crown",
  mochi: "droplet",
  sprout: "clover",
  prism: "diamond",
  inbox: "capsule",
  fox: "cat",
  ghost: "arch",
  orb: "circle",
  bolt: "star",
  quill: "pebble",
  vault: "hexagon",
  terminal: "squircle",
};

export function findBotAvatarShape(icon: string): BotAvatarShape | null {
  const key = icon.trim().toLowerCase();
  const id = LEGACY_SHAPE_IDS[key] ?? key;
  return BOT_AVATAR_SHAPES.find((shape) => shape.id === id) ?? null;
}

export const DEFAULT_BOT_AVATAR_SHAPE =
  findBotAvatarShape(BOT_DEFAULT_ICON) ?? BOT_AVATAR_SHAPES[0];

const BOT_IMAGE_ICON = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/]+={0,2}$/i;

/** Uploaded portraits are inline raster data URLs; SVG and other schemes never render. */
export function isBotImageIcon(icon: string): boolean {
  return BOT_IMAGE_ICON.test(icon.trim());
}

const MAX_CUSTOM_ICON_GRAPHEMES = 2;

// Hermes lacks Intl.Segmenter; collapse ZWJ sequences, variation selectors, and skin-tone modifiers.
const GRAPHEME_APPROX_RE =
  /(?:\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|\P{M})(?:[\uFE0E\uFE0F\u200D\p{Emoji_Modifier}\p{M}]*(?:\p{Extended_Pictographic})?)*)/gu;

function countGraphemes(text: string): number {
  const matches = text.match(GRAPHEME_APPROX_RE);
  return matches ? matches.length : Array.from(text).length;
}

/** One or two graphemes that aren't a shape id, so "🦊", "猫" and "AI" render as text. */
export function isCustomBotEmoji(icon: string): boolean {
  const trimmed = icon.trim();
  if (trimmed === "" || findBotAvatarShape(trimmed) !== null) return false;
  return countGraphemes(trimmed) <= MAX_CUSTOM_ICON_GRAPHEMES;
}

export type BotAvatarGlyph =
  | { readonly kind: "shape"; readonly shape: BotAvatarShape }
  | { readonly kind: "emoji"; readonly emoji: string }
  | { readonly kind: "image"; readonly src: string };

/** Icons written by agents or older clients may name neither a shape, an emoji nor an image. */
export function resolveBotAvatarGlyph(icon: string): BotAvatarGlyph {
  if (isBotImageIcon(icon)) return { kind: "image", src: icon.trim() };
  const shape = findBotAvatarShape(icon);
  if (shape !== null) return { kind: "shape", shape };
  if (isCustomBotEmoji(icon)) return { kind: "emoji", emoji: icon.trim() };
  return { kind: "shape", shape: DEFAULT_BOT_AVATAR_SHAPE };
}

export type BotAvatarExpression = "calm" | "focused" | "attentive" | "error" | "asleep";

export function botAvatarExpression(status: BotStatus | null, muted: boolean): BotAvatarExpression {
  if (muted) return "asleep";
  switch (status) {
    case "working":
      return "focused";
    case "waiting":
      return "attentive";
    case "error":
      return "error";
    default:
      return "calm";
  }
}

export const BOT_THEME_COLOR = "theme";

export const BOT_AVATAR_COLORS = [
  { id: "theme", label: "Match theme", value: BOT_THEME_COLOR },
  { id: "ink", label: "Ink", value: "#242429" },
  { id: "cream", label: "Cream", value: "#ece8df" },
  { id: "stone", label: "Stone", value: "#8d8f98" },
  { id: "clay", label: "Clay", value: "#a57252" },
  { id: "coral", label: "Coral", value: "#de6056" },
  { id: "orange", label: "Orange", value: "#e68940" },
  { id: "amber", label: "Amber", value: "#e0b03b" },
  { id: "sage", label: "Sage", value: "#45b282" },
  { id: "teal", label: "Teal", value: "#35a398" },
  { id: "blue", label: "Blue", value: "#4c8de0" },
  { id: "violet", label: "Violet", value: "#8768e0" },
  { id: "rose", label: "Rose", value: "#d6629f" },
] as const;

const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

export function isBotHexColor(color: string): boolean {
  return HEX_COLOR.test(color.trim());
}

type Rgb = readonly [number, number, number];

function parseHexRgb(hex: string): Rgb | null {
  const trimmed = hex.trim();
  if (!HEX_COLOR.test(trimmed)) return null;
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
  if (HEX_COLOR.test(trimmed)) return trimmed.toLowerCase();
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

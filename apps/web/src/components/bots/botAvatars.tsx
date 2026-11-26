import { BOT_DEFAULT_COLOR, BOT_DEFAULT_ICON } from "@t3tools/contracts";
import type { CSSProperties, ReactNode } from "react";

export type BotVisualStyle = "playful" | "glass" | "minimal";

export const BOT_VISUAL_STYLES = [
  { id: "playful", label: "Playful Glossy", shortLabel: "Playful" },
  { id: "glass", label: "Adaptive Glass", shortLabel: "Glass" },
  { id: "minimal", label: "Minimal", shortLabel: "Minimal" },
] as const satisfies ReadonlyArray<{ id: BotVisualStyle; label: string; shortLabel: string }>;

function Glyph(props: { readonly className?: string; readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden
      className={props.className}
    >
      {props.children}
    </svg>
  );
}

type GlyphProps = { readonly className?: string };

// Each glyph is one silhouette; evenodd subpaths cut eyes and facets so the tile shows through.
export const BOT_AVATAR_SHAPES = [
  {
    id: "bot",
    label: "Bot",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M12 2.25a1.6 1.6 0 0 1 .8 2.99V7H17a3.5 3.5 0 0 1 3.5 3.5v6A3.5 3.5 0 0 1 17 20H7a3.5 3.5 0 0 1-3.5-3.5v-6A3.5 3.5 0 0 1 7 7h4.2V5.24A1.6 1.6 0 0 1 12 2.25ZM9 11.1a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3Zm6 0a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3Zm-4.6 4.9a.6.6 0 0 0 0 1.2h3.2a.6.6 0 0 0 0-1.2Z" />
        <rect x="1.25" y="11.5" width="1.5" height="4" rx=".75" />
        <rect x="21.25" y="11.5" width="1.5" height="4" rx=".75" />
      </Glyph>
    ),
  },
  {
    id: "chief",
    label: "Chief",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="m3.2 8.6 4.6 3.6L12 5.2l4.2 7 4.6-3.6-1.7 9.7a1.6 1.6 0 0 1-1.58 1.33H6.48A1.6 1.6 0 0 1 4.9 18.3Zm6.3 5.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
        <circle cx="3" cy="7.4" r="1.5" />
        <circle cx="12" cy="3.6" r="1.6" />
        <circle cx="21" cy="7.4" r="1.5" />
      </Glyph>
    ),
  },
  {
    id: "mochi",
    label: "Mochi",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M12 5c5.2 0 9 3.6 9 8.1 0 3.4-2.6 5.4-6 5.4H9c-3.4 0-6-2-6-5.4C3 8.6 6.8 5 12 5ZM7.9 12.6a1.6 1.6 0 0 1 3.2 0 .55.55 0 0 1-1.1 0 .5.5 0 0 0-1 0 .55.55 0 0 1-1.1 0Zm5 0a1.6 1.6 0 0 1 3.2 0 .55.55 0 0 1-1.1 0 .5.5 0 0 0-1 0 .55.55 0 0 1-1.1 0Zm-1.95 2.5h2.1a1.05 1.05 0 0 1-2.1 0Z" />
        <path d="M12.9 2.4c1.6-.3 2.9.2 3.6 1.3-1.5.4-2.8.1-3.6-1.3Z" />
      </Glyph>
    ),
  },
  {
    id: "sprout",
    label: "Sprout",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M11.4 9.6C11 6.4 8.6 4.4 5 4.5c.1 3.6 2.4 5.6 6.4 5.1Zm1.2 0c.2-3.9 2.8-6.4 6.9-6.6.1 4-2.6 6.3-6.9 6.6Z" />
        <rect x="11.25" y="8.5" width="1.5" height="3" rx=".75" />
        <path d="M12 10a5.75 5.75 0 1 1 0 11.5A5.75 5.75 0 0 1 12 10Zm-2 4.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2.9 3.1h1.8a.9.9 0 0 1-1.8 0Z" />
      </Glyph>
    ),
  },
  {
    id: "prism",
    label: "Prism",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M7 4h3.3L9 9H3Z" fillOpacity={0.8} />
        <path d="M10.3 4h3.4L15 9H9Z" fillOpacity={0.55} />
        <path d="M13.7 4H17l4 5h-6Z" fillOpacity={0.8} />
        <path d="M3 9h6l3 11Z" />
        <path d="M9 9h6l-3 11Z" fillOpacity={0.6} />
        <path d="M15 9h6l-9 11Z" fillOpacity={0.85} />
        <path d="m20.4 1 .5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z" />
      </Glyph>
    ),
  },
  {
    id: "inbox",
    label: "Inbox",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M4 6.5h14.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Zm-.4 1.4 7.65 4.9 7.65-4.9.85 1.3-8.5 5.45L2.75 9.2Zm4.6 6.7a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm6.1 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm-3.3 1.55h1.8a.9.9 0 0 1-1.8 0Z" />
        <path d="m20.6 1.2.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z" />
      </Glyph>
    ),
  },
  {
    id: "cat",
    label: "Cat",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M4 3.5 8.4 7a10.2 10.2 0 0 1 7.2 0L20 3.5v9.2c0 4.3-3.6 7.8-8 7.8s-8-3.5-8-7.8Zm5 7.6c-.6 0-1 .65-1 1.45S8.4 14 9 14s1-.65 1-1.45-.4-1.45-1-1.45Zm6 0c-.6 0-1 .65-1 1.45S14.4 14 15 14s1-.65 1-1.45-.4-1.45-1-1.45Zm-3.85 4.2h1.7l-.85 1.05Z" />
      </Glyph>
    ),
  },
  {
    id: "fox",
    label: "Fox",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="m2.75 3 5.75 3.6h7L21.25 3l-1.4 8.6L12 20.75 4.15 11.6Zm4.85 8.2 2.6.9-.3 1.3-2.5-.6Zm8.8 0-2.6.9.3 1.3 2.5-.6ZM11 16.9h2l-1 1.2Z" />
      </Glyph>
    ),
  },
  {
    id: "ghost",
    label: "Ghost",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M12 3a7 7 0 0 1 7 7v9.5q-1.167 1.6-2.333 0t-2.334 0-2.333 0-2.333 0-2.334 0-2.333 0V10a7 7 0 0 1 7-7ZM9.5 8.9c-.6 0-1.1.7-1.1 1.6s.5 1.6 1.1 1.6 1.1-.7 1.1-1.6-.5-1.6-1.1-1.6Zm5 0c-.6 0-1.1.7-1.1 1.6s.5 1.6 1.1 1.6 1.1-.7 1.1-1.6-.5-1.6-1.1-1.6ZM12 13.2a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z" />
      </Glyph>
    ),
  },
  {
    id: "orb",
    label: "Orb",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <ellipse
          cx="12"
          cy="12.5"
          rx="10.25"
          ry="3.4"
          transform="rotate(-18 12 12.5)"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M12 6.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm-1.7 5.15a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm3.4 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z" />
        <circle cx="19.5" cy="4.5" r="1" />
        <circle cx="4.25" cy="19.75" r=".8" />
      </Glyph>
    ),
  },
  {
    id: "bolt",
    label: "Bolt",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path
          d="M14 2 4.5 13.5H11L9.5 22 19.5 10H13Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <circle cx="5" cy="5" r="1" />
        <circle cx="19.5" cy="19" r="1" />
      </Glyph>
    ),
  },
  {
    id: "quill",
    label: "Quill",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M12 2.5 17.5 9.5l-1.8 7.7H8.3L6.5 9.5Zm0 7.4a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm-.4 2.6v4.7h.8v-4.7Z" />
        <path d="M8.3 18.5h7.4v1.8a1.2 1.2 0 0 1-1.2 1.2h-5a1.2 1.2 0 0 1-1.2-1.2Z" />
      </Glyph>
    ),
  },
  {
    id: "vault",
    label: "Vault",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M12 2.3 20.4 7.15v9.7L12 21.7l-8.4-4.85v-9.7ZM12 5 5.95 8.5v7L12 19l6.05-3.5v-7Z" />
        <path d="M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Zm0 1.6a1.1 1.1 0 0 0-.55 2.05v1.45h1.1v-1.45A1.1 1.1 0 0 0 12 10.2Z" />
      </Glyph>
    ),
  },
  {
    id: "terminal",
    label: "Terminal",
    Glyph: (props: GlyphProps) => (
      <Glyph {...props}>
        <path d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v12a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 18V6A2.5 2.5 0 0 1 5 3.5Zm1.6 5.8 1.1-1.1 3.9 3.8-3.9 3.8-1.1-1.1 2.7-2.7Zm5.9 5.5v1.6h5v-1.6Z" />
      </Glyph>
    ),
  },
] as const;

export type BotAvatarShape = (typeof BOT_AVATAR_SHAPES)[number];

export function findBotAvatarShape(icon: string): BotAvatarShape | null {
  const id = icon.trim().toLowerCase();
  return BOT_AVATAR_SHAPES.find((shape) => shape.id === id) ?? null;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const MAX_CUSTOM_ICON_GRAPHEMES = 2;

/** One or two graphemes that aren't a shape id, so "🦊", "猫" and "AI" render as text. */
export function isCustomBotEmoji(icon: string): boolean {
  const trimmed = icon.trim();
  if (trimmed === "" || findBotAvatarShape(trimmed) !== null) return false;
  let graphemes = 0;
  for (const _segment of graphemeSegmenter.segment(trimmed)) {
    graphemes++;
    if (graphemes > MAX_CUSTOM_ICON_GRAPHEMES) return false;
  }
  return true;
}

export type BotAvatarGlyph =
  | { readonly kind: "shape"; readonly shape: BotAvatarShape }
  | { readonly kind: "emoji"; readonly emoji: string };

const DEFAULT_SHAPE = findBotAvatarShape(BOT_DEFAULT_ICON) ?? BOT_AVATAR_SHAPES[0];

/** Icons written by agents or older clients may name neither a shape nor an emoji. */
export function resolveBotAvatarGlyph(icon: string): BotAvatarGlyph {
  const shape = findBotAvatarShape(icon);
  if (shape !== null) return { kind: "shape", shape };
  if (isCustomBotEmoji(icon)) return { kind: "emoji", emoji: icon.trim() };
  return { kind: "shape", shape: DEFAULT_SHAPE };
}

export const BOT_THEME_COLOR = "theme";

export const BOT_AVATAR_COLORS = [
  { id: "theme", label: "Match wallpaper", value: BOT_THEME_COLOR },
  { id: "indigo", label: "Indigo", value: "#818cf8" },
  { id: "sakura", label: "Sakura", value: "#f472b6" },
  { id: "matcha", label: "Matcha", value: "#34d399" },
  { id: "honey", label: "Honey", value: "#fbbf24" },
  { id: "coral", label: "Coral", value: "#fb7185" },
  { id: "sky", label: "Sky", value: "#38bdf8" },
  { id: "violet", label: "Violet", value: "#a78bfa" },
  { id: "tangerine", label: "Tangerine", value: "#fb923c" },
  { id: "mint", label: "Mint", value: "#2dd4bf" },
  { id: "orchid", label: "Orchid", value: "#e879f9" },
] as const;

const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\d\s.,%/+-]+\)$/i;

export function isBotHexColor(color: string): boolean {
  return HEX_COLOR.test(color.trim());
}

/** The CSS color a Bot paints with; unreadable stored colors fall back to the default. */
export function resolveBotAccentColor(color: string): string {
  const trimmed = color.trim();
  if (trimmed.toLowerCase() === BOT_THEME_COLOR) return "var(--primary)";
  if (HEX_COLOR.test(trimmed) || FUNCTIONAL_COLOR.test(trimmed)) return trimmed.toLowerCase();
  return BOT_DEFAULT_COLOR;
}

function hexLuminance(hex: string): number | null {
  if (!HEX_COLOR.test(hex)) return null;
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

// Above this luminance a white glyph on the glossy tile drops under 2:1, so it takes a deep ink.
const LIGHT_ACCENT_LUMINANCE = 0.4;

function playfulGlyphColor(accent: string): string {
  if (accent === "var(--primary)") return "var(--primary-foreground)";
  const luminance = hexLuminance(accent);
  return luminance !== null && luminance > LIGHT_ACCENT_LUMINANCE
    ? `color-mix(in srgb, ${accent} 28%, black)`
    : "white";
}

/** The tile paint for one finish; the accent is runtime data, so it can't be a class. */
export function botAvatarSurfaceStyle(accent: string, visualStyle: BotVisualStyle): CSSProperties {
  switch (visualStyle) {
    case "playful":
      return {
        color: playfulGlyphColor(accent),
        backgroundImage: [
          "linear-gradient(180deg, rgb(255 255 255 / 34%) 0%, rgb(255 255 255 / 8%) 46%, transparent 54%)",
          `linear-gradient(150deg, color-mix(in srgb, color-mix(in srgb, ${accent} 78%, white) 94%, transparent) 0%, color-mix(in srgb, ${accent} 88%, transparent) 55%, color-mix(in srgb, color-mix(in srgb, ${accent} 80%, black) 92%, transparent) 100%)`,
        ].join(", "),
        boxShadow: `0 2px 10px color-mix(in srgb, ${accent} 35%, transparent), inset 0 1px 0 rgb(255 255 255 / 32%), inset 0 0 0 1px color-mix(in srgb, ${accent} 55%, transparent)`,
      };
    case "glass":
      return {
        color: `color-mix(in srgb, ${accent} 78%, var(--foreground))`,
        backgroundColor: `color-mix(in srgb, color-mix(in srgb, ${accent} 22%, var(--glass-surface)) 72%, transparent)`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 16%), inset 0 0 0 1px color-mix(in srgb, ${accent} 36%, transparent)`,
      };
    case "minimal":
      return {
        color: `color-mix(in srgb, ${accent} 80%, var(--foreground))`,
        backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
      };
  }
}

/** A soft wash of the accent for cards that carry a Bot's identity. */
export function botAccentTintStyle(accent: string, visualStyle: BotVisualStyle): CSSProperties {
  return visualStyle === "playful"
    ? {
        backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${accent} 16%, transparent), color-mix(in srgb, ${accent} 4%, transparent) 70%)`,
        borderColor: `color-mix(in srgb, ${accent} 28%, transparent)`,
      }
    : visualStyle === "glass"
      ? { borderColor: `color-mix(in srgb, ${accent} 22%, transparent)` }
      : {};
}

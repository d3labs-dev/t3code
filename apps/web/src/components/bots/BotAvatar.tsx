import type { BotStatus } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import {
  type BotVisualStyle,
  botAvatarSurfaceStyle,
  resolveBotAccentColor,
  resolveBotAvatarGlyph,
} from "./botAvatars";
import { useBotsUiStore } from "./botsUiStore";

export type BotAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const TILE_CLASS: Record<BotAvatarSize, string> = {
  xs: "size-4 rounded-sm",
  sm: "size-5 rounded-md",
  md: "size-7 rounded-lg",
  lg: "size-9 rounded-xl",
  xl: "size-12 rounded-2xl",
};

const GLYPH_CLASS: Record<BotAvatarSize, string> = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4.5",
  lg: "size-5.5",
  xl: "size-7.5",
};

const EMOJI_CLASS: Record<BotAvatarSize, string> = {
  xs: "text-2xs",
  sm: "text-xs",
  md: "text-base",
  lg: "text-xl",
  xl: "text-3xl",
};

const STATUS_DOT_SIZE_CLASS: Record<BotAvatarSize, string> = {
  xs: "size-1.5",
  sm: "size-2",
  md: "size-2.5",
  lg: "size-3",
  xl: "size-3.5",
};

const BOT_STATUS_DOT_CLASS: Record<Exclude<BotStatus, "idle">, string> = {
  working: "bg-info",
  waiting: "bg-warning",
  error: "bg-destructive",
};

export const BOT_STATUS_LABEL: Record<BotStatus, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting",
  error: "Error",
};

export function BotAvatar({
  icon,
  color,
  size = "md",
  visualStyle,
  status = null,
  muted = false,
  interactive = false,
  label,
}: {
  readonly icon: string;
  readonly color: string;
  readonly size?: BotAvatarSize;
  /** Defaults to the finish chosen in the Bots sidebar. */
  readonly visualStyle?: BotVisualStyle;
  readonly status?: BotStatus | null;
  readonly muted?: boolean;
  readonly interactive?: boolean;
  /** Names the avatar for screen readers; without it the avatar is decorative. */
  readonly label?: string;
}) {
  const preferredStyle = useBotsUiStore((state) => state.visualStyle);
  const glyph = resolveBotAvatarGlyph(icon);
  const surface = botAvatarSurfaceStyle(
    resolveBotAccentColor(color),
    visualStyle ?? preferredStyle,
  );
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        TILE_CLASS[size],
        muted && "opacity-60 grayscale",
        interactive &&
          "transition-transform duration-150 ease-out hover:-translate-y-px hover:scale-105 group-hover/bot-row:-translate-y-px group-hover/bot-row:scale-105 motion-reduce:transition-none motion-reduce:hover:transform-none motion-reduce:group-hover/bot-row:transform-none",
      )}
      style={surface}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-bot-avatar
    >
      {glyph.kind === "shape" ? (
        <glyph.shape.Glyph className={GLYPH_CLASS[size]} />
      ) : (
        <span className={cn("leading-none select-none", EMOJI_CLASS[size])}>{glyph.emoji}</span>
      )}
      {status !== null && status !== "idle" ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-background",
            STATUS_DOT_SIZE_CLASS[size],
            BOT_STATUS_DOT_CLASS[status],
          )}
        />
      ) : null}
    </span>
  );
}

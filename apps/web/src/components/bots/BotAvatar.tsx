import {
  type BotAvatarExpression,
  type BotAvatarEyes,
  type BotAvatarShape,
  type BotVisualStyle,
  botAvatarExpression,
  resolveBotAvatarGlyph,
} from "@t3tools/client-runtime/bot-avatar";
import type { BotStatus } from "@t3tools/contracts";
import { msg } from "gt-react";

import { cn } from "../../lib/utils";
import { botAvatarPaint } from "./botAvatarPaint";
import { useBotsUiStore } from "./botsUiStore";

export type BotAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<BotAvatarSize, string> = {
  xs: "size-4",
  sm: "size-5",
  md: "size-7",
  lg: "size-9",
  xl: "size-18",
};

const EMOJI_CLASS: Record<BotAvatarSize, string> = {
  xs: "text-2xs",
  sm: "text-xs",
  md: "text-base",
  lg: "text-xl",
  xl: "text-4xl",
};

const STATUS_DOT_SIZE_CLASS: Record<BotAvatarSize, string> = {
  xs: "size-1.5",
  sm: "size-2",
  md: "size-2.5",
  lg: "size-3",
  xl: "size-4",
};

const BOT_STATUS_DOT_CLASS: Record<Exclude<BotStatus, "idle">, string> = {
  working: "bg-info",
  waiting: "bg-warning",
  error: "bg-destructive",
};

export const BOT_STATUS_LABEL: Record<BotStatus, string> = {
  idle: msg("Idle", { $context: "Bot status" }),
  working: msg("Working", { $context: "Bot status" }),
  waiting: msg("Waiting", { $context: "Bot status" }),
  error: msg("Error", { $context: "Bot status" }),
};

function BotFace(props: {
  readonly eyes: BotAvatarEyes;
  readonly expression: BotAvatarExpression;
  readonly color: string;
}) {
  const { x, y, gap, scale } = props.eyes;
  const centers = [x - gap, x + gap];
  if (props.expression === "error" || props.expression === "asleep") {
    const reach = 1.45 * scale;
    const strokes = centers.map((cx) =>
      props.expression === "error"
        ? `M${cx - reach} ${y - reach}L${cx + reach} ${y + reach}M${cx + reach} ${y - reach}L${cx - reach} ${y + reach}`
        : `M${cx - 1.7 * scale} ${y - 0.3 * scale}q${1.7 * scale} ${1.9 * scale} ${3.4 * scale} 0`,
    );
    return (
      <path
        d={strokes.join("")}
        fill="none"
        stroke={props.color}
        strokeWidth={1.5 * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  const shift = props.expression === "focused" ? 0.7 * scale : 0;
  const width = (props.expression === "attentive" ? 3.3 : 2.7) * scale;
  const height =
    (props.expression === "attentive" ? 4.5 : props.expression === "focused" ? 3.7 : 4.2) * scale;
  return (
    <g fill={props.color}>
      {centers.map((cx) => (
        <rect
          key={cx}
          x={cx + shift - width / 2}
          y={y - shift - height / 2}
          width={width}
          height={height}
          rx={width / 2}
        />
      ))}
    </g>
  );
}

/** A bare silhouette in the current text color, for pickers. */
export function BotShapeSilhouette(props: {
  readonly shape: BotAvatarShape;
  readonly className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={props.className} fill="currentColor">
      <path d={props.shape.path} />
    </svg>
  );
}

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
  /** Defaults to the finish chosen in the Bot designer. */
  readonly visualStyle?: BotVisualStyle;
  readonly status?: BotStatus | null;
  readonly muted?: boolean;
  readonly interactive?: boolean;
  /** Names the avatar for screen readers; without it the avatar is decorative. */
  readonly label?: string;
}) {
  const preferredStyle = useBotsUiStore((state) => state.visualStyle);
  const glyph = resolveBotAvatarGlyph(icon);
  const paint = botAvatarPaint(color, visualStyle ?? preferredStyle);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        SIZE_CLASS[size],
        muted && "opacity-70",
        interactive &&
          "transition-transform duration-150 ease-out hover:-translate-y-px group-hover/bot-row:-translate-y-px motion-reduce:transition-none motion-reduce:hover:transform-none motion-reduce:group-hover/bot-row:transform-none",
      )}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-bot-avatar
    >
      {glyph.kind === "shape" ? (
        <svg viewBox="0 0 24 24" className="size-full overflow-visible">
          <path d={glyph.shape.path} style={paint.body} vectorEffect="non-scaling-stroke" />
          <BotFace
            eyes={glyph.shape.eyes}
            expression={botAvatarExpression(status, muted)}
            color={paint.eyes}
          />
        </svg>
      ) : glyph.kind === "emoji" ? (
        <span
          className="flex size-full items-center justify-center rounded-full"
          style={paint.disc}
        >
          <span className={cn("leading-none select-none", EMOJI_CLASS[size])}>{glyph.emoji}</span>
        </span>
      ) : (
        <img
          src={glyph.src}
          alt=""
          draggable={false}
          className="size-full rounded-full object-cover"
        />
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

import { useAtomValue } from "@effect/atom-react";
import {
  type BotAvatarExpression,
  type BotAvatarEyes,
  type BotAvatarOwner,
  type BotAvatarShape,
  type BotVisualStyle,
  botAvatarExpression,
  DEFAULT_BOT_AVATAR_SHAPE,
  resolveBotAvatarGlyph,
} from "@t3tools/client-runtime/bot-avatar";
import type { BotAvatarReference, BotStatus } from "@t3tools/contracts";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { botAvatarUrlAtom } from "../../state/assets";
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
  idle: "Idle",
  working: "Working",
  waiting: "Waiting",
  error: "Error",
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

const AVATAR_IMAGE_CLASS = "size-full rounded-full object-cover";

function StoredBotImage(props: {
  readonly owner: BotAvatarOwner;
  readonly reference: BotAvatarReference;
  readonly fallback: ReactNode;
}) {
  const src = useAtomValue(
    botAvatarUrlAtom({
      environmentId: props.owner.environmentId,
      botId: props.owner.bot.id,
      reference: props.reference,
    }),
  );
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  if (src === null || src === brokenSrc) return props.fallback;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={AVATAR_IMAGE_CLASS}
      onError={() => setBrokenSrc(src)}
    />
  );
}

export function BotAvatar({
  icon,
  color,
  owner = null,
  size = "md",
  visualStyle,
  status = null,
  muted = false,
  interactive = false,
  label,
}: {
  readonly icon: string;
  readonly color: string;
  /** Without it, an icon naming a stored image shows the default shape. */
  readonly owner?: BotAvatarOwner | null;
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
  const shapeBody = (shape: BotAvatarShape) => (
    <svg viewBox="0 0 24 24" className="size-full overflow-visible">
      <path d={shape.path} style={paint.body} vectorEffect="non-scaling-stroke" />
      <BotFace
        eyes={shape.eyes}
        expression={botAvatarExpression(status, muted)}
        color={paint.eyes}
      />
    </svg>
  );
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
        shapeBody(glyph.shape)
      ) : glyph.kind === "emoji" ? (
        <span
          className="flex size-full items-center justify-center rounded-full"
          style={paint.disc}
        >
          <span className={cn("leading-none select-none", EMOJI_CLASS[size])}>{glyph.emoji}</span>
        </span>
      ) : glyph.kind === "image" ? (
        <img src={glyph.src} alt="" draggable={false} className={AVATAR_IMAGE_CLASS} />
      ) : owner === null ? (
        shapeBody(DEFAULT_BOT_AVATAR_SHAPE)
      ) : (
        <StoredBotImage
          owner={owner}
          reference={glyph.reference}
          fallback={shapeBody(DEFAULT_BOT_AVATAR_SHAPE)}
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

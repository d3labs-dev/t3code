import type { BotStatus } from "@t3tools/contracts";
import { Image } from "expo-image";
import { View } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { useControlTheme } from "../../components/ui/useControlTheme";
import {
  type BotAvatarExpression,
  type BotAvatarEyes,
  type BotAvatarShape,
  type BotVisualStyle,
  botAvatarExpression,
  botAvatarPaint,
  resolveBotAvatarGlyph,
} from "./botAvatars";
import { useBotVisualStyle } from "./botFormHelpers";

export type BotAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<BotAvatarSize, number> = {
  xs: 16,
  sm: 22,
  md: 32,
  lg: 44,
  xl: 76,
};

const EMOJI_FONT_SIZE: Record<BotAvatarSize, number> = {
  xs: 10,
  sm: 12,
  md: 17,
  lg: 22,
  xl: 38,
};

const STATUS_DOT_PX: Record<BotAvatarSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
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
      <Path
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
    <G fill={props.color}>
      {centers.map((cx) => (
        <Rect
          key={cx}
          x={cx + shift - width / 2}
          y={y - shift - height / 2}
          width={width}
          height={height}
          rx={width / 2}
        />
      ))}
    </G>
  );
}

/** A bare silhouette for shape pickers. */
export function BotShapeSilhouette(props: {
  readonly shape: BotAvatarShape;
  readonly size?: number;
  readonly color: string;
}) {
  const dimension = props.size ?? 24;
  return (
    <Svg width={dimension} height={dimension} viewBox="0 0 24 24">
      <Path d={props.shape.path} fill={props.color} />
    </Svg>
  );
}

export function BotAvatar({
  icon,
  color,
  size = "md",
  visualStyle,
  status = null,
  muted = false,
  label,
}: {
  readonly icon: string;
  readonly color: string;
  readonly size?: BotAvatarSize;
  readonly visualStyle?: BotVisualStyle;
  readonly status?: BotStatus | null;
  readonly muted?: boolean;
  readonly label?: string;
}) {
  const preferredStyle = useBotVisualStyle();
  const { colors } = useControlTheme();
  const dimension = SIZE_PX[size];
  const glyph = resolveBotAvatarGlyph(icon);
  const paint = botAvatarPaint(color, visualStyle ?? preferredStyle, {
    primary: colors["--color-primary"],
    primaryForeground: colors["--color-primary-foreground"],
    foreground: colors["--color-foreground"],
    surface: colors["--color-card"],
  });
  const dotSize = STATUS_DOT_PX[size];
  const dotColor =
    status === "working"
      ? colors["--color-primary"]
      : status === "waiting"
        ? colors["--color-warning-foreground"]
        : status === "error"
          ? colors["--color-danger"]
          : null;

  return (
    <View
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? "image" : undefined}
      accessibilityLabel={label}
      style={{
        width: dimension,
        height: dimension,
        opacity: muted ? 0.68 : 1,
      }}
      className="relative shrink-0 items-center justify-center"
    >
      {glyph.kind === "shape" ? (
        <Svg width={dimension} height={dimension} viewBox="0 0 24 24">
          <Path
            d={glyph.shape.path}
            fill={paint.fill}
            stroke={paint.stroke}
            strokeWidth={paint.strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
          <BotFace
            eyes={glyph.shape.eyes}
            expression={botAvatarExpression(status, muted)}
            color={paint.eyes}
          />
        </Svg>
      ) : glyph.kind === "emoji" ? (
        <View
          style={{
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            backgroundColor: paint.discBackground,
            borderColor: paint.discBorderColor,
            borderWidth: paint.discBorderWidth,
          }}
          className="items-center justify-center"
        >
          <Text
            style={{ fontSize: EMOJI_FONT_SIZE[size], lineHeight: EMOJI_FONT_SIZE[size] * 1.15 }}
          >
            {glyph.emoji}
          </Text>
        </View>
      ) : (
        <Image
          source={{ uri: glyph.src }}
          contentFit="cover"
          style={{ width: dimension, height: dimension, borderRadius: dimension / 2 }}
        />
      )}
      {dotColor !== null ? (
        <View
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: dotColor,
            borderWidth: size === "xs" ? 1.5 : 2,
            borderColor: colors["--color-card"],
          }}
        />
      ) : null}
    </View>
  );
}

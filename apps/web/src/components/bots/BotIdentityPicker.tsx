import { BOT_DEFAULT_ICON } from "@t3tools/contracts";
import { PlusIcon, WallpaperIcon } from "lucide-react";
import { useState } from "react";

import { hexToHsv, hsvToHex } from "../../lib/color";
import { cn } from "../../lib/utils";
import { ColorHueSlider, ColorSaturationValuePlane } from "../ui/color-picker";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar } from "./BotAvatar";
import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  BOT_THEME_COLOR,
  BOT_VISUAL_STYLES,
  type BotVisualStyle,
  findBotAvatarShape,
  isBotHexColor,
  isCustomBotEmoji,
} from "./botAvatars";

const CUSTOM_COLOR_FALLBACK = "#818cf8";

const PICKER_CELL_CLASS =
  "flex items-center justify-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-border disabled:pointer-events-none disabled:opacity-64 motion-reduce:transition-none";

const SWATCH_CLASS =
  "relative flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64";

function CustomColorPanel(props: {
  readonly initialColor: string;
  readonly onChange: (color: string) => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(props.initialColor));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const currentColor = hsvToHex(hsv.h, hsv.s, hsv.v);
  const changeHsv = (next: typeof hsv) => {
    setHsv(next);
    props.onChange(hsvToHex(next.h, next.s, next.v));
  };
  return (
    <div className="w-56">
      <ColorSaturationValuePlane
        label="Bot color"
        value={hsv}
        onChange={changeHsv}
        variant="edge"
      />
      <div className="grid gap-3 p-3">
        <ColorHueSlider
          label="Bot color hue"
          value={hsv.h}
          onChange={(h) => changeHsv({ ...hsv, h })}
        />
        <Input
          nativeInput
          size="compact"
          font="mono"
          spellCheck={false}
          aria-label="Custom hex color"
          value={hexDraft ?? currentColor}
          onChange={(event) => {
            const next = event.currentTarget.value.trim();
            setHexDraft(next);
            if (!/^#[\da-f]{6}$/i.test(next)) return;
            setHsv(hexToHsv(next));
            props.onChange(next.toLowerCase());
          }}
          onBlur={() => setHexDraft(null)}
        />
      </div>
    </div>
  );
}

function EmojiInput(props: {
  readonly icon: string;
  readonly disabled: boolean;
  readonly onIconChange: (icon: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const iconIsEmoji = isCustomBotEmoji(props.icon);
  return (
    <Input
      size="sm"
      disabled={props.disabled}
      aria-label="Custom emoji"
      placeholder="Or type an emoji, like 🦊"
      value={draft ?? (iconIsEmoji ? props.icon : "")}
      onChange={(event) => {
        const value = event.currentTarget.value;
        if (isCustomBotEmoji(value)) {
          setDraft(null);
          props.onIconChange(value.trim());
          return;
        }
        setDraft(value);
        if (value.trim() === "" && iconIsEmoji) props.onIconChange(BOT_DEFAULT_ICON);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function BotIdentityPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
  visualStyle,
  onVisualStyleChange,
  disabled = false,
}: {
  readonly icon: string;
  readonly color: string;
  readonly onIconChange: (icon: string) => void;
  readonly onColorChange: (color: string) => void;
  readonly visualStyle?: BotVisualStyle;
  /** Shows the finish toggle when set. */
  readonly onVisualStyleChange?: (style: BotVisualStyle) => void;
  readonly disabled?: boolean;
}) {
  const selectedShapeId = findBotAvatarShape(icon)?.id ?? null;
  const normalizedColor = color.trim().toLowerCase();
  const curated = BOT_AVATAR_COLORS.some((option) => option.value === normalizedColor);
  const customColor = !curated && isBotHexColor(normalizedColor) ? normalizedColor : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-medium text-muted-foreground">Shape</span>
        <div className="grid grid-cols-7 gap-0.5" role="group" aria-label="Bot shape">
          {BOT_AVATAR_SHAPES.map((shape) => (
            <Tooltip key={shape.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(PICKER_CELL_CLASS, "h-9 w-full")}
                    aria-label={shape.label}
                    aria-pressed={selectedShapeId === shape.id}
                    disabled={disabled}
                    onClick={() => onIconChange(shape.id)}
                  />
                }
              >
                <BotAvatar
                  icon={shape.id}
                  color={color}
                  size="sm"
                  {...(visualStyle ? { visualStyle } : {})}
                />
              </TooltipTrigger>
              <TooltipPopup>{shape.label}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
        <EmojiInput icon={icon} disabled={disabled} onIconChange={onIconChange} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-medium text-muted-foreground">Color</span>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Bot color">
          {BOT_AVATAR_COLORS.map((option) => {
            const selected = normalizedColor === option.value;
            const theme = option.value === BOT_THEME_COLOR;
            return (
              <Tooltip key={option.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className={cn(
                        SWATCH_CLASS,
                        theme && "bg-primary text-primary-foreground",
                        selected && "ring-2 ring-inset ring-foreground/70",
                      )}
                      style={theme ? undefined : { backgroundColor: option.value }}
                      aria-label={option.label}
                      aria-pressed={selected}
                      disabled={disabled}
                      onClick={() => onColorChange(option.value)}
                    />
                  }
                >
                  {theme ? <WallpaperIcon className="size-3" aria-hidden /> : null}
                </TooltipTrigger>
                <TooltipPopup>
                  {theme ? "Match wallpaper: follows your theme color" : option.label}
                </TooltipPopup>
              </Tooltip>
            );
          })}
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    SWATCH_CLASS,
                    customColor === null
                      ? "border border-dashed border-border text-muted-foreground hover:text-foreground"
                      : "ring-2 ring-inset ring-foreground/70",
                  )}
                  style={customColor === null ? undefined : { backgroundColor: customColor }}
                  aria-label="Custom color"
                  aria-pressed={customColor !== null}
                  disabled={disabled}
                />
              }
            >
              {customColor === null ? <PlusIcon className="size-3" aria-hidden /> : null}
            </PopoverTrigger>
            <PopoverPopup side="bottom" align="start" sideOffset={6} padding="none">
              <CustomColorPanel
                initialColor={customColor ?? CUSTOM_COLOR_FALLBACK}
                onChange={onColorChange}
              />
            </PopoverPopup>
          </Popover>
        </div>
      </div>
      {onVisualStyleChange ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-2xs font-medium text-muted-foreground">Finish</span>
          <ToggleGroup
            aria-label="Bot finish"
            className="w-full"
            value={visualStyle ? [visualStyle] : []}
            onValueChange={(values) => {
              const next = BOT_VISUAL_STYLES.find((style) => style.id === values[0]);
              if (next) onVisualStyleChange(next.id);
            }}
          >
            {BOT_VISUAL_STYLES.map((style) => (
              <Toggle key={style.id} value={style.id} className="flex-1">
                <BotAvatar icon={icon} color={color} size="xs" visualStyle={style.id} />
                {style.shortLabel}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
    </div>
  );
}

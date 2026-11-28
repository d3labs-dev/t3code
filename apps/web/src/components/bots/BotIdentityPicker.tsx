import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  BOT_THEME_COLOR,
  type BotAvatarOwner,
  type BotVisualStyle,
  DEFAULT_BOT_AVATAR_SHAPE,
  findBotAvatarShape,
  isBotHexColor,
  isBotImageIcon,
  isCustomBotEmoji,
} from "@t3tools/client-runtime/bot-avatar";
import { ImageUpIcon, PlusIcon, WallpaperIcon } from "lucide-react";
import { useRef, useState } from "react";

import { hexToHsv, hsvToHex } from "../../lib/color";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ColorHueSlider, ColorSaturationValuePlane } from "../ui/color-picker";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar, BotShapeSilhouette } from "./BotAvatar";
import { BOT_VISUAL_STYLES } from "./botAvatarPaint";

const SOURCES = [
  { id: "shape", label: "Shape" },
  { id: "emoji", label: "Emoji" },
  { id: "upload", label: "Upload" },
] as const;
type AvatarSource = (typeof SOURCES)[number]["id"];

const QUICK_EMOJI = ["🦊", "🐙", "🦉", "🐝", "🌱", "🍙", "🛰️", "🧠"] as const;
const CUSTOM_COLOR_FALLBACK = "#4c8de0";
const AVATAR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const AVATAR_IMAGE_SIZE = 128;
const AVATAR_IMAGE_QUALITY = 0.85;

const SWATCH_CLASS =
  "relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-foreground/70 disabled:pointer-events-none disabled:opacity-64";

function sourceOf(icon: string): AvatarSource {
  if (isBotImageIcon(icon)) return "upload";
  return isCustomBotEmoji(icon) ? "emoji" : "shape";
}

/** Center-crops to a small square so a portrait costs a few kilobytes on the wire. */
async function readAvatarImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_IMAGE_SIZE;
    canvas.height = AVATAR_IMAGE_SIZE;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("This browser can't resize images.");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_IMAGE_SIZE,
      AVATAR_IMAGE_SIZE,
    );
    const webp = canvas.toDataURL("image/webp", AVATAR_IMAGE_QUALITY);
    // Browsers without a WebP encoder silently return PNG data instead.
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

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

function ColorRow(props: {
  readonly color: string;
  readonly disabled: boolean;
  readonly onColorChange: (color: string) => void;
}) {
  const normalized = props.color.trim().toLowerCase();
  const curated = BOT_AVATAR_COLORS.some((option) => option.value === normalized);
  const customColor = !curated && isBotHexColor(normalized) ? normalized : null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Bot color">
      {BOT_AVATAR_COLORS.map((option) => {
        const theme = option.value === BOT_THEME_COLOR;
        const label = theme ? "Match wallpaper" : option.label;
        return (
          <Tooltip key={option.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={cn(SWATCH_CLASS, theme && "bg-primary text-primary-foreground")}
                  style={theme ? undefined : { backgroundColor: option.value }}
                  aria-label={label}
                  aria-pressed={normalized === option.value}
                  disabled={props.disabled}
                  onClick={() => props.onColorChange(option.value)}
                />
              }
            >
              {theme ? <WallpaperIcon className="size-3" aria-hidden /> : null}
            </TooltipTrigger>
            <TooltipPopup>{label}</TooltipPopup>
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
                customColor === null &&
                  "border border-dashed border-border text-muted-foreground hover:text-foreground",
              )}
              style={customColor === null ? undefined : { backgroundColor: customColor }}
              aria-label="Custom color"
              aria-pressed={customColor !== null}
              disabled={props.disabled}
            />
          }
        >
          {customColor === null ? <PlusIcon className="size-3" aria-hidden /> : null}
        </PopoverTrigger>
        <PopoverPopup side="bottom" align="start" sideOffset={6} padding="none">
          <CustomColorPanel
            initialColor={customColor ?? CUSTOM_COLOR_FALLBACK}
            onChange={props.onColorChange}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

function ShapeGrid(props: {
  readonly icon: string;
  readonly color: string;
  readonly visualStyle: BotVisualStyle | undefined;
  readonly disabled: boolean;
  readonly onIconChange: (icon: string) => void;
}) {
  const selectedId = findBotAvatarShape(props.icon)?.id ?? null;
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Bot shape">
      {BOT_AVATAR_SHAPES.map((shape) => {
        const selected = selectedId === shape.id;
        return (
          <Tooltip key={shape.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="flex h-11 cursor-pointer items-center justify-center rounded-xl text-muted-foreground/55 outline-none transition-colors hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-accent disabled:pointer-events-none disabled:opacity-64 motion-reduce:transition-none"
                  aria-label={shape.label}
                  aria-pressed={selected}
                  disabled={props.disabled}
                  onClick={() => props.onIconChange(shape.id)}
                />
              }
            >
              {selected ? (
                <BotAvatar
                  icon={shape.id}
                  color={props.color}
                  size="md"
                  {...(props.visualStyle ? { visualStyle: props.visualStyle } : {})}
                />
              ) : (
                <BotShapeSilhouette shape={shape} className="size-6" />
              )}
            </TooltipTrigger>
            <TooltipPopup>{shape.label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

function EmojiChooser(props: {
  readonly icon: string;
  readonly disabled: boolean;
  readonly onIconChange: (icon: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const iconIsEmoji = isCustomBotEmoji(props.icon);
  return (
    <div className="flex flex-col gap-2">
      <Input
        disabled={props.disabled}
        aria-label="Custom emoji"
        placeholder="Type or paste an emoji"
        value={draft ?? (iconIsEmoji ? props.icon : "")}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (isCustomBotEmoji(value)) {
            setDraft(null);
            props.onIconChange(value.trim());
            return;
          }
          setDraft(value);
        }}
        onBlur={() => setDraft(null)}
      />
      <div className="grid grid-cols-8 gap-1" role="group" aria-label="Suggested emoji">
        {QUICK_EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            aria-pressed={props.icon.trim() === emoji}
            disabled={props.disabled}
            onClick={() => props.onIconChange(emoji)}
            className="flex h-10 cursor-pointer items-center justify-center rounded-xl text-xl outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-accent disabled:pointer-events-none disabled:opacity-64 motion-reduce:transition-none"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

function ImageUploader(props: {
  readonly icon: string;
  readonly color: string;
  readonly owner: BotAvatarOwner | null;
  readonly disabled: boolean;
  readonly onIconChange: (icon: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hasImage = isBotImageIcon(props.icon);
  const accept = async (file: File | undefined) => {
    if (file === undefined) return;
    if (!AVATAR_IMAGE_TYPES.includes(file.type)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unsupported image",
          description: "Choose a PNG, JPEG, WebP or GIF.",
        }),
      );
      return;
    }
    setReading(true);
    try {
      props.onIconChange(await readAvatarImage(file));
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not read image",
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    setReading(false);
  };
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void accept(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        disabled={props.disabled || reading}
        data-dragging={dragging || undefined}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void accept(event.dataTransfer.files[0]);
        }}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 data-dragging:border-ring data-dragging:bg-accent/40 motion-reduce:transition-none"
      >
        {hasImage ? (
          <BotAvatar icon={props.icon} color={props.color} owner={props.owner} size="lg" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
            <ImageUpIcon className="size-4" aria-hidden />
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {reading ? "Reading image…" : hasImage ? "Replace image" : "Choose an image"}
          </span>
          <span className="text-xs text-muted-foreground">
            Or drop one here. PNG, JPEG, WebP or GIF, cropped to a circle.
          </span>
        </span>
      </button>
      {hasImage ? (
        <div>
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            disabled={props.disabled}
            onClick={() => props.onIconChange(DEFAULT_BOT_AVATAR_SHAPE.id)}
          >
            Remove image
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function BotIdentityPicker({
  icon,
  color,
  owner = null,
  onIconChange,
  onColorChange,
  visualStyle,
  onVisualStyleChange,
  disabled = false,
}: {
  readonly icon: string;
  readonly color: string;
  readonly owner?: BotAvatarOwner | null;
  readonly onIconChange: (icon: string) => void;
  readonly onColorChange: (color: string) => void;
  readonly visualStyle?: BotVisualStyle;
  /** Shows the finish toggle when set. */
  readonly onVisualStyleChange?: (style: BotVisualStyle) => void;
  readonly disabled?: boolean;
}) {
  const [source, setSource] = useState<AvatarSource>(() => sourceOf(icon));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ToggleGroup
        aria-label="Avatar source"
        className="w-full"
        value={[source]}
        onValueChange={(values) => {
          const next = SOURCES.find((option) => option.id === values[0]);
          if (next) setSource(next.id);
        }}
      >
        {SOURCES.map((option) => (
          <Toggle key={option.id} value={option.id} className="flex-1">
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
      {source === "shape" ? (
        <ShapeGrid
          icon={icon}
          color={color}
          visualStyle={visualStyle}
          disabled={disabled}
          onIconChange={onIconChange}
        />
      ) : source === "emoji" ? (
        <EmojiChooser icon={icon} disabled={disabled} onIconChange={onIconChange} />
      ) : (
        <ImageUploader
          icon={icon}
          color={color}
          owner={owner}
          disabled={disabled}
          onIconChange={onIconChange}
        />
      )}
      {source === "upload" ? null : (
        <ColorRow color={color} disabled={disabled} onColorChange={onColorChange} />
      )}
      {onVisualStyleChange && source !== "upload" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Avatar finish</span>
          <ToggleGroup
            aria-label="Avatar finish"
            className="w-full"
            value={visualStyle ? [visualStyle] : []}
            onValueChange={(values) => {
              const next = BOT_VISUAL_STYLES.find((style) => style.id === values[0]);
              if (next) onVisualStyleChange(next.id);
            }}
          >
            {BOT_VISUAL_STYLES.map((style) => (
              <Toggle key={style.id} value={style.id} className="flex-1">
                <BotAvatar
                  icon={icon}
                  color={color}
                  owner={owner}
                  size="xs"
                  visualStyle={style.id}
                />
                {style.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <p className="text-2xs text-muted-foreground">Applies to every Bot on this device.</p>
        </div>
      ) : null}
    </div>
  );
}

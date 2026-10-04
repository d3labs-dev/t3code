import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CUSTOM_BACKGROUND_NAME_MAX_LENGTH = 80;

export const CustomBackgroundId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type CustomBackgroundId = typeof CustomBackgroundId.Type;

/** SHA-256 of the original upload, hex encoded. */
export const CustomBackgroundImageId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export type CustomBackgroundImageId = typeof CustomBackgroundImageId.Type;

export const CustomBackgroundName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CUSTOM_BACKGROUND_NAME_MAX_LENGTH),
);

/** `#rrggbb` or `#rrggbbaa`; shaders accept either. */
export const CustomBackgroundColor = Schema.String.check(
  Schema.isPattern(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i),
);
export type CustomBackgroundColor = typeof CustomBackgroundColor.Type;

export interface NumberControlSpec {
  readonly kind: "number";
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly integer?: boolean;
}

export interface SelectControlSpec<Option extends string = string> {
  readonly kind: "select";
  readonly label: string;
  readonly options: ReadonlyArray<Option>;
  readonly default: Option;
}

export interface BooleanControlSpec {
  readonly kind: "boolean";
  readonly label: string;
  readonly default: boolean;
}

export interface ColorControlSpec {
  readonly kind: "color";
  readonly label: string;
  readonly default: CustomBackgroundColor;
}

export type CustomBackgroundControlSpec =
  | NumberControlSpec
  | SelectControlSpec
  | BooleanControlSpec
  | ColorControlSpec;

function number(
  label: string,
  range: { min: number; max: number; step: number },
  defaultValue: number,
): NumberControlSpec {
  return { kind: "number", label, ...range, default: defaultValue };
}

function integer(
  label: string,
  range: { min: number; max: number },
  defaultValue: number,
): NumberControlSpec {
  return { kind: "number", label, ...range, step: 1, default: defaultValue, integer: true };
}

function select<const Option extends string>(
  label: string,
  options: ReadonlyArray<Option>,
  defaultValue: Option,
): SelectControlSpec<Option> {
  return { kind: "select", label, options, default: defaultValue };
}

function boolean(label: string, defaultValue: boolean): BooleanControlSpec {
  return { kind: "boolean", label, default: defaultValue };
}

function color(label: string, defaultValue: string): ColorControlSpec {
  return { kind: "color", label, default: defaultValue };
}

const IMAGE_SCALE = { min: 0.1, max: 4, step: 0.04 } as const;

const fit = select("Fit", ["contain", "cover"], "cover");
const imageScale = number("Scale", IMAGE_SCALE, 1);

type ControlSchema<Spec> =
  Spec extends SelectControlSpec<infer Option>
    ? Schema.Literals<ReadonlyArray<Option>>
    : Spec extends NumberControlSpec
      ? Schema.Number
      : Spec extends BooleanControlSpec
        ? Schema.Boolean
        : Spec extends ColorControlSpec
          ? typeof CustomBackgroundColor
          : never;

type ControlFields<Controls extends Record<string, CustomBackgroundControlSpec>> = {
  readonly [Key in keyof Controls]: ControlSchema<Controls[Key]>;
};

function controlSchema(spec: CustomBackgroundControlSpec): Schema.Top {
  switch (spec.kind) {
    case "number": {
      const bounded = Schema.Finite.check(
        Schema.isBetween({ minimum: spec.min, maximum: spec.max }),
      );
      return spec.integer ? bounded.check(Schema.isInt()) : bounded;
    }
    case "select":
      return Schema.Literals(spec.options);
    case "boolean":
      return Schema.Boolean;
    case "color":
      return CustomBackgroundColor;
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

function controlFields<const Controls extends Record<string, CustomBackgroundControlSpec>>(
  controls: Controls,
): ControlFields<Controls> {
  const fields: Record<string, Schema.Top> = {};
  for (const [key, spec] of Object.entries(controls)) {
    fields[key] = controlSchema(spec);
  }
  // The loop above builds exactly one schema per spec kind, so the
  // record matches the mapped type; TypeScript cannot follow that
  // through `Object.entries`.
  return fields as ControlFields<Controls>;
}

type ControlDefaults<Controls extends Record<string, CustomBackgroundControlSpec>> = {
  readonly [Key in keyof Controls]: Controls[Key]["default"];
};

function controlDefaults<const Controls extends Record<string, CustomBackgroundControlSpec>>(
  controls: Controls,
): ControlDefaults<Controls> {
  const defaults: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(controls)) {
    defaults[key] = spec.default;
  }
  // Each spec's `default` is typed against its own value kind above.
  return defaults as ControlDefaults<Controls>;
}

// Control specs own the schema ranges, form controls, and starting values.
function defineFilter<
  const Kind extends string,
  const Controls extends Record<string, CustomBackgroundControlSpec>,
>(kind: Kind, controls: Controls) {
  const schema = Schema.Struct({
    kind: Schema.Literal(kind),
    ...controlFields(controls),
  });
  const defaults = { kind, ...controlDefaults(controls) };
  return { kind, controls, schema, defaults };
}

const IMAGE_DITHERING_FILTER = defineFilter("image-dithering", {
  type: select("Type", ["random", "2x2", "4x4", "8x8"], "4x4"),
  size: number("Size", { min: 0.5, max: 20, step: 0.2 }, 3.4),
  colorSteps: integer("Color steps", { min: 1, max: 7 }, 5),
  originalColors: boolean("Original colors", true),
  inverted: boolean("Inverted", false),
  colorBack: color("Background", "#000c38"),
  colorFront: color("Foreground", "#94ffaf"),
  colorHighlight: color("Highlight", "#eaff94"),
  fit,
  scale: imageScale,
});

export const MIN_CUSTOM_BACKGROUND_FADE = 0;
export const MAX_CUSTOM_BACKGROUND_FADE = 100;
/**
 * Intensity of the theme-colored overlay at the bottom edge, 0 to 100. Clients
 * map it onto an ease-out opacity curve, so the slider darkens evenly.
 */
export const DEFAULT_CUSTOM_BACKGROUND_FADE = 0;
/**
 * How far up the pane, in percent, the fade reaches before it has eased away
 * completely; at 100 it reaches the top, where the chat text fades out.
 */
export const DEFAULT_CUSTOM_BACKGROUND_FADE_HEIGHT = 69;
/**
 * How long, in percent of the pane, the ease below the fade height is. The
 * curve lives in `@t3tools/shared/customBackgroundFade` so every client draws
 * the same shape.
 */
export const DEFAULT_CUSTOM_BACKGROUND_FADE_SOFTNESS = 100;
/** Opacity of the picture itself over the theme background, 0 to 100. Lower it for more text contrast. */
export const DEFAULT_CUSTOM_BACKGROUND_OPACITY = 90;
export const CustomBackgroundFade = Schema.Int.check(
  Schema.isBetween({ minimum: MIN_CUSTOM_BACKGROUND_FADE, maximum: MAX_CUSTOM_BACKGROUND_FADE }),
);

/**
 * How strongly each picture's own lightness pulls its opacity down and its
 * fade up, 0 to 100. At 0 every picture shows at the chosen values.
 */
export const CustomBackgroundBrightnessAdapt = CustomBackgroundFade;
export const DEFAULT_CUSTOM_BACKGROUND_BRIGHTNESS_ADAPT = 100;

export const MAX_CUSTOM_BACKGROUND_BLUR = 40;
/** Blur of the picture itself, in pixels. */
export const CustomBackgroundBlur = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_CUSTOM_BACKGROUND_BLUR }),
);

/** Fill of the bubble behind agent replies, in percent of the message surface color. */
export const AgentBubbleOpacity = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
export type AgentBubbleOpacity = typeof AgentBubbleOpacity.Type;
export const DEFAULT_AGENT_BUBBLE_OPACITY: AgentBubbleOpacity = 25;

export const MAX_AGENT_BUBBLE_BLUR = 20;
/** Backdrop blur behind agent reply bubbles, in pixels. 0 applies no backdrop filter. */
export const AgentBubbleBlur = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_AGENT_BUBBLE_BLUR }),
);
export type AgentBubbleBlur = typeof AgentBubbleBlur.Type;
export const DEFAULT_AGENT_BUBBLE_BLUR: AgentBubbleBlur = 0;

export const MAX_AGENT_BUBBLE_PADDING = 24;
export const AgentBubblePadding = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_AGENT_BUBBLE_PADDING }),
);
export type AgentBubblePadding = typeof AgentBubblePadding.Type;
export const DEFAULT_AGENT_BUBBLE_PADDING: AgentBubblePadding = 12;

export const ReplyTextShadow = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
export type ReplyTextShadow = typeof ReplyTextShadow.Type;
export const DEFAULT_REPLY_TEXT_SHADOW: ReplyTextShadow = 40;

export type ImageDitheringFilter = typeof IMAGE_DITHERING_FILTER.schema.Type;

export interface ImageDitheringPreset {
  readonly id: string;
  readonly name: string;
  readonly filter: ImageDitheringFilter;
  /** Only presets that define a look for the overlay set the fade sliders. */
  readonly fade?: Pick<CustomBackgroundRecord, "fade" | "fadeHeight" | "fadeSoftness">;
}

/**
 * Starting points for the dithering filter. "Original" keeps the picture's
 * colors; the others quantize it to a tinted palette, the look popularized by
 * dot-matrix wallpapers, and every slider stays editable afterwards.
 */
export const IMAGE_DITHERING_PRESETS: ReadonlyArray<ImageDitheringPreset> = [
  {
    id: "original",
    name: "Original",
    filter: IMAGE_DITHERING_FILTER.defaults,
  },
  {
    id: "faded",
    name: "Faded",
    filter: IMAGE_DITHERING_FILTER.defaults,
    fade: { fade: 100, fadeHeight: 85, fadeSoftness: 47 },
  },
  {
    id: "violet",
    name: "Violet",
    filter: {
      ...IMAGE_DITHERING_FILTER.defaults,
      type: "8x8",
      size: 3.4,
      colorSteps: 3,
      originalColors: false,
      colorBack: "#0a0914",
      colorFront: "#6d5ce0",
      colorHighlight: "#b8a9ff",
    },
  },
  {
    id: "terminal",
    name: "Terminal",
    filter: {
      ...IMAGE_DITHERING_FILTER.defaults,
      type: "4x4",
      size: 2.6,
      colorSteps: 3,
      originalColors: false,
    },
  },
  {
    id: "mono",
    name: "Mono",
    filter: {
      ...IMAGE_DITHERING_FILTER.defaults,
      type: "8x8",
      size: 3,
      colorSteps: 3,
      originalColors: false,
      colorBack: "#0a0a0a",
      colorFront: "#8a8a8a",
      colorHighlight: "#f2f2f2",
    },
  },
];

/** Every filter repaints the picture; a background is always an image. */
export const CUSTOM_BACKGROUND_FILTERS = [IMAGE_DITHERING_FILTER] as const;

export const NoCustomBackgroundFilter = Schema.Struct({ kind: Schema.Literal("none") });

export const CustomBackgroundFilter = Schema.Union([
  NoCustomBackgroundFilter,
  ...CUSTOM_BACKGROUND_FILTERS.map((filter) => filter.schema),
]);
export type CustomBackgroundFilter = typeof CustomBackgroundFilter.Type;
export type CustomBackgroundFilterKind = CustomBackgroundFilter["kind"];

const DEFAULT_CUSTOM_BACKGROUND_FILTER: CustomBackgroundFilter = IMAGE_DITHERING_FILTER.defaults;

export function customBackgroundFilterControls(
  kind: Exclude<CustomBackgroundFilterKind, "none">,
): Readonly<Record<string, CustomBackgroundControlSpec>> {
  const filter = CUSTOM_BACKGROUND_FILTERS.find((candidate) => candidate.kind === kind);
  return filter ? filter.controls : {};
}

export function defaultCustomBackgroundFilter(
  kind: CustomBackgroundFilterKind,
): CustomBackgroundFilter {
  if (kind === "none") return { kind: "none" };
  const filter = CUSTOM_BACKGROUND_FILTERS.find((candidate) => candidate.kind === kind);
  return filter ? filter.defaults : DEFAULT_CUSTOM_BACKGROUND_FILTER;
}

const MIN_CUSTOM_BACKGROUND_ROTATION_MINUTES = 1;
const MAX_CUSTOM_BACKGROUND_ROTATION_MINUTES = 1440;
export const DEFAULT_CUSTOM_BACKGROUND_ROTATION_MINUTES = 15;
export const CUSTOM_BACKGROUND_ROTATION_MINUTE_OPTIONS = [
  1, 2, 5, 10, 15, 30, 60, 120, 360, 1440,
] as const;
export const CustomBackgroundRotationMinutes = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_CUSTOM_BACKGROUND_ROTATION_MINUTES,
    maximum: MAX_CUSTOM_BACKGROUND_ROTATION_MINUTES,
  }),
);

/**
 * One image is a rotation of one. With several, the client advances through
 * them in order every `rotationMinutes`, keyed off wall-clock time so every
 * pane and reload agrees on which image is up.
 */
export const CUSTOM_BACKGROUND_ROTATION_ORDERS = ["sequential", "shuffle"] as const;
export const CustomBackgroundRotationOrder = Schema.Literals(CUSTOM_BACKGROUND_ROTATION_ORDERS);
export type CustomBackgroundRotationOrder = typeof CustomBackgroundRotationOrder.Type;

export const CUSTOM_BACKGROUND_TRANSITIONS = ["cut", "fade"] as const;
const CustomBackgroundTransitionLiteral = Schema.Literals(CUSTOM_BACKGROUND_TRANSITIONS);
export type CustomBackgroundTransition = typeof CustomBackgroundTransitionLiteral.Type;
/** Stored values from transitions that no longer exist load as a fade. */
export const CustomBackgroundTransition = Schema.String.pipe(
  Schema.decodeTo(
    CustomBackgroundTransitionLiteral,
    SchemaTransformation.transform<CustomBackgroundTransition, string>({
      decode: (value) => (value === "cut" ? "cut" : "fade"),
      encode: (value) => value,
    }),
  ),
);

export const CustomBackgroundImageSource = Schema.Struct({
  kind: Schema.Literal("image"),
  /** Empty only on the phone, while every picture comes from its linked folders. */
  imageIds: Schema.Array(CustomBackgroundImageId),
  rotationMinutes: CustomBackgroundRotationMinutes.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CUSTOM_BACKGROUND_ROTATION_MINUTES)),
  ),
  /** Shuffle plays every image once per round in a seeded order that never repeats across a round boundary. */
  order: CustomBackgroundRotationOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed("sequential" as const)),
  ),
  transition: CustomBackgroundTransition.pipe(
    Schema.withDecodingDefault(Effect.succeed("fade" as const)),
  ),
});
export type CustomBackgroundImageSource = typeof CustomBackgroundImageSource.Type;

export const CustomBackgroundSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  CustomBackgroundImageSource,
]);
export type CustomBackgroundSource = typeof CustomBackgroundSource.Type;

const RetiredCustomBackgroundFilterKind = Schema.Literals([
  "fluted-glass",
  "lens-distortion",
  "static-mesh-gradient",
  "grain-gradient",
  "paper-texture",
  "water",
  "halftone-dots",
  "halftone-cmyk",
]);

const RetiredCustomBackgroundFilter = Schema.Struct({
  kind: RetiredCustomBackgroundFilterKind,
}).pipe(
  Schema.decodeTo(
    NoCustomBackgroundFilter,
    SchemaTransformation.transform<
      { readonly kind: "none" },
      { readonly kind: typeof RetiredCustomBackgroundFilterKind.Type }
    >({
      decode: () => ({ kind: "none" }),
      // Encoding never takes this branch: `none` is a live filter kind.
      encode: () => ({ kind: "paper-texture" }),
    }),
  ),
);

/**
 * A folder whose pictures the playlist follows. On the desktop, `path` is the
 * folder's path and `imageIds` is what it held at its last sync, so a picture
 * the user deselected is told apart from one newly added to the folder. On the
 * phone, `path` is a media library album ID and `imageIds` stays empty: the
 * phone reads the album each time it rotates instead of copying its photos.
 */
export const CustomBackgroundFolder = Schema.Struct({
  path: TrimmedNonEmptyString,
  imageIds: Schema.Array(CustomBackgroundImageId),
});
export type CustomBackgroundFolder = typeof CustomBackgroundFolder.Type;

const CustomBackgroundRecordFilter = Schema.Union([
  CustomBackgroundFilter,
  RetiredCustomBackgroundFilter,
]);

export const CustomBackgroundRecord = Schema.Struct({
  id: CustomBackgroundId,
  name: CustomBackgroundName,
  source: CustomBackgroundSource,
  folders: Schema.Array(CustomBackgroundFolder).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  filter: CustomBackgroundRecordFilter,
  fade: CustomBackgroundFade.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CUSTOM_BACKGROUND_FADE)),
  ),
  fadeHeight: CustomBackgroundFade.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CUSTOM_BACKGROUND_FADE_HEIGHT)),
  ),
  fadeSoftness: CustomBackgroundFade.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CUSTOM_BACKGROUND_FADE_SOFTNESS)),
  ),
  opacity: CustomBackgroundFade.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CUSTOM_BACKGROUND_OPACITY)),
  ),
  blur: CustomBackgroundBlur.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  brightnessAdapt: CustomBackgroundBrightnessAdapt.pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  createdAt: Schema.String,
});
export type CustomBackgroundRecord = typeof CustomBackgroundRecord.Type;

export const CustomBackgroundRecords = Schema.Array(CustomBackgroundRecord);
export type CustomBackgroundRecords = typeof CustomBackgroundRecords.Type;

const decodeRecordOption = Schema.decodeUnknownOption(CustomBackgroundRecord);
const encodeRecord = Schema.encodeSync(CustomBackgroundRecord);

/**
 * The library is user content stored on the client. One entry that no longer
 * decodes, say after its shape changed, must not block every other setting
 * from loading, so decoding drops it instead of failing.
 */
export const StoredCustomBackgroundRecords = Schema.Array(Schema.Unknown).pipe(
  Schema.decodeTo(
    CustomBackgroundRecords,
    SchemaTransformation.transform<typeof CustomBackgroundRecords.Encoded, ReadonlyArray<unknown>>({
      decode: (items) =>
        items.flatMap((item) => {
          const record = decodeRecordOption(item);
          return record._tag === "Some" ? [encodeRecord(record.value)] : [];
        }),
      encode: (records) => records,
    }),
  ),
);

/**
 * The phone's own backgrounds, kept in the phone's preferences: a library of
 * playlists like the desktop's, one of them showing. Their pictures live in
 * the phone's app storage and may be shared between playlists;
 * `sourceColors` holds each picture's Material seed, scored when it was added.
 */
export const PhoneBackground = Schema.Struct({
  playlists: Schema.Array(CustomBackgroundRecord).check(Schema.isMinLength(1)),
  activePlaylistId: CustomBackgroundId,
  dynamicTheme: Schema.Boolean,
  sourceColors: Schema.Record(CustomBackgroundImageId, Schema.Int),
}).check(
  Schema.makeFilter((background) =>
    background.playlists.some((playlist) => playlist.id === background.activePlaylistId),
  ),
);
export type PhoneBackground = typeof PhoneBackground.Type;

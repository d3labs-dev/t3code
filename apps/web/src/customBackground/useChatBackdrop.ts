import {
  ADAPT_MAX_REDUCTION,
  adaptToBrightness,
  readableSurfaceOpacity,
} from "@t3tools/shared/customBackgroundBrightness";
import { useState } from "react";

import type { BackgroundRendererProps } from "~/components/background/BackgroundRenderer";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";

import { useBackgroundStudioOpen, useBackgroundStudioStore } from "./backgroundStudioStore";
import { useBackgroundImageTone, useBackgroundImageUrl } from "./imageStore";
import {
  type CustomBackgroundRouteKind,
  backgroundDrawMode,
  backgroundIsRenderable,
  resolveDisplayedBackground,
} from "./records";
import { useRotatingBackgroundImage } from "./rotation";
import { useActiveBackground } from "./useActiveBackground";
import { isWebGlAvailable } from "./webgl";

const NO_SOURCE = { kind: "none" } as const;

export interface ChatBackdrop {
  readonly renderer: BackgroundRendererProps;
  /** Least panel opacity, 0 to 100, that keeps text readable over the picture shown. */
  readonly readableOpacity: number;
}

/** What the window's background draws right now, or null when it draws nothing. */
export function useChatBackdrop(routeKind: CustomBackgroundRouteKind): ChatBackdrop | null {
  const selected = useActiveBackground();
  const enabled = useClientSettings((settings) => settings.customBackgroundEnabled);
  const editing = useBackgroundStudioOpen();
  const preview = useBackgroundStudioStore((store) => store.preview);
  const { resolvedTheme } = useTheme();
  const record = resolveDisplayedBackground({
    selected,
    preview,
    enabled,
    editing,
    routeKind,
  });
  const filtersAvailable = isWebGlAvailable();
  const source = record?.source ?? NO_SOURCE;
  const { current: imageId, upcoming } = useRotatingBackgroundImage(source);
  // Only the plain <img> path can show 4K pixels; the shader draws a fraction
  // of them and uploads whatever it is given as a full-size GPU texture.
  const variant =
    record !== null &&
    backgroundDrawMode({ filter: record.filter, hasImage: true, filtersAvailable }) === "shader"
      ? "shader"
      : "full";
  const image = useBackgroundImageUrl(imageId, variant);
  useBackgroundImageUrl(upcoming, variant);
  const tone = useBackgroundImageTone(imageId);
  // Measured ahead so the next picture arrives with its own look already known.
  useBackgroundImageTone(upcoming);
  // Hold the previous picture while the next one decodes so a rotation never
  // flashes the bare theme between images.
  const [lastImage, setLastImage] = useState<string | null>(null);
  if (typeof image === "string" && image !== lastImage) setLastImage(image);
  const shownImage = typeof image === "string" ? image : image === null ? lastImage : null;
  if (!record || !backgroundIsRenderable(record, filtersAvailable)) return null;
  if (imageId !== null && shownImage === null) return null;
  const look = tone
    ? adaptToBrightness({
        ...record,
        tone,
        appearance: resolvedTheme,
        maxReduction: ADAPT_MAX_REDUCTION.behindReadablePanels,
      })
    : record;
  return {
    renderer: {
      filter: record.filter,
      image: shownImage,
      transition: source.kind === "image" ? source.transition : "cut",
      opacity: look.opacity,
      blur: record.blur,
      filtersAvailable,
    },
    readableOpacity: tone
      ? readableSurfaceOpacity({ tone, pictureOpacity: look.opacity, appearance: resolvedTheme })
      : 0,
  };
}

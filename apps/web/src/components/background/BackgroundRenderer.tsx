import { ImageDithering } from "@paper-design/shaders-react";
import type { CustomBackgroundFilter, CustomBackgroundTransition } from "@t3tools/contracts";
import { memo, useEffect, useState } from "react";

import { BACKGROUND_WEBGL_CONTEXT_ATTRIBUTES } from "~/customBackground/webgl";
import { backgroundDrawMode } from "~/customBackground/records";

// Cap GPU work on high-resolution displays; the background sits under glass and bubbles.
const MAX_PIXEL_COUNT = 1920 * 1200;

const SHADER_PROPS = {
  webGlContextAttributes: BACKGROUND_WEBGL_CONTEXT_ATTRIBUTES,
  width: "100%",
  height: "100%",
  speed: 0,
  minPixelRatio: 1,
  maxPixelCount: MAX_PIXEL_COUNT,
  className: "absolute inset-0",
} as const;

function ShaderLayer({ filter, image }: { filter: CustomBackgroundFilter; image: string | null }) {
  switch (filter.kind) {
    case "none":
      return null;
    case "image-dithering": {
      if (!image) return null;
      const { kind: _kind, ...params } = filter;
      return <ImageDithering image={image} {...params} {...SHADER_PROPS} />;
    }
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

const TRANSITION_MS = 1400;

interface Slide {
  key: number;
  image: string | null;
  leaving: boolean;
  /** Picture opacity, 0 to 100; the theme background shows through the rest. */
  opacity: number;
}

/**
 * The outgoing picture stays on top and animates out over the incoming one,
 * so a shader canvas that is still decoding its texture never shows through.
 * Each slide keeps the look it had, so a picture that brightness adapt dims
 * differently from the next one crossfades instead of jumping.
 */
function useSlides(
  image: string | null,
  opacity: number,
  transition: CustomBackgroundTransition,
): Slide[] {
  const [slides, setSlides] = useState<Slide[]>(() => [{ key: 0, image, leaving: false, opacity }]);
  const current = slides.find((slide) => !slide.leaving);
  if (current && current.image !== image) {
    const key = current.key + 1;
    setSlides(
      transition === "cut"
        ? [{ key, image, leaving: false, opacity }]
        : [
            ...slides.map((slide) => ({ ...slide, leaving: true })),
            { key, image, leaving: false, opacity },
          ],
    );
  } else if (current && current.opacity !== opacity) {
    setSlides(slides.map((slide) => (slide === current ? { ...slide, opacity } : slide)));
  }
  const leavingCount = slides.length - 1;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer drops the outgoing slides once their animation ends
  useEffect(() => {
    if (leavingCount === 0) return;
    const timer = setTimeout(
      () => setSlides((previous) => previous.filter((slide) => !slide.leaving)),
      TRANSITION_MS,
    );
    return () => clearTimeout(timer);
  }, [leavingCount]);
  return slides;
}

export interface BackgroundRendererProps {
  filter: CustomBackgroundFilter;
  /** Object URL of the source image; null while it loads. */
  image: string | null;
  transition: CustomBackgroundTransition;
  /** Picture opacity, 0 to 100; the theme background shows through the rest. */
  opacity: number;
  /** Picture blur in pixels; 0 applies no filter. */
  blur: number;
  /** When false, skip Paper entirely and draw the photo if one is loaded. */
  filtersAvailable: boolean;
}

export const BackgroundRenderer = memo(function BackgroundRenderer({
  filter,
  image,
  transition,
  opacity,
  blur,
  filtersAvailable,
}: BackgroundRendererProps) {
  const mode = backgroundDrawMode({
    filter,
    hasImage: typeof image === "string",
    filtersAvailable,
  });
  const slides = useSlides(image, opacity, transition);
  if (mode === "none") return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* A blurred layer fades out at its edges, so it overhangs the clipped pane by the radius. */}
      <div
        className="absolute inset-0"
        style={blur === 0 ? undefined : { filter: `blur(${blur}px)`, inset: -blur }}
      >
        {/* Each slide paints the theme background under its picture, so two
            slides crossfade cleanly instead of stacking their dimming. */}
        {slides.map((slide) => (
          <div
            key={slide.key}
            className="custom-background-slide absolute inset-0 bg-background surface-grain"
            data-transition={transition}
            data-leaving={slide.leaving || undefined}
          >
            <div className="absolute inset-0" style={{ opacity: slide.opacity / 100 }}>
              {mode === "image" && typeof slide.image === "string" ? (
                <img src={slide.image} alt="" className="absolute size-full object-cover" />
              ) : (
                <ShaderLayer filter={filter} image={slide.image} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

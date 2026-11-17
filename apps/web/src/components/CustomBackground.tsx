import { lazy, memo, Suspense, useEffect, useLayoutEffect, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { useClientSettings } from "~/hooks/useSettings";
import type { CustomBackgroundRouteKind } from "~/customBackground/records";
import { useChatBackdrop } from "~/customBackground/useChatBackdrop";

// The shader library only loads once a client actually has a background
// selected, so clients on the plain theme never pay for it at startup.
const BackgroundRenderer = lazy(() =>
  import("./background/BackgroundRenderer").then((module) => ({
    default: module.BackgroundRenderer,
  })),
);

/**
 * One picture behind the whole window, sidebar included. custom.css reads the
 * flags on this layer to clear the surfaces above it and give them glass.
 */
export const CustomBackground = memo(function CustomBackground({
  routeKind,
}: {
  routeKind: CustomBackgroundRouteKind;
}) {
  const backdrop = useChatBackdrop(routeKind);
  const replyTextEmphasis = useClientSettings(
    (settings) => settings.customBackgroundReplyTextEmphasis,
  );
  const readableOpacity = backdrop?.readableOpacity ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the picture's readable floor to the panels' CSS on the document root
  useEffect(() => {
    if (readableOpacity === null) return;
    const { style } = document.documentElement;
    style.setProperty("--wallpaper-readable-opacity", `${readableOpacity}%`);
    return () => {
      style.removeProperty("--wallpaper-readable-opacity");
    };
  }, [readableOpacity]);
  if (!backdrop) return null;
  return (
    <div
      data-chat-backdrop="source"
      data-reply-text-emphasis={replyTextEmphasis || undefined}
      className="pointer-events-none fixed inset-0"
    >
      <Suspense fallback={null}>
        <BackgroundRenderer {...backdrop.renderer} />
      </Suspense>
    </div>
  );
});

interface WindowFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Chromium's `backdrop-filter` stops at the nearest masked ancestor, so over a
 * background the timeline drops its fade mask (custom.css). This strip
 * repaints the window's picture over the top edge so text still dissolves.
 */
export const ChatBackdropTopFade = memo(function ChatBackdropTopFade() {
  const backdrop = useChatBackdrop("conversation");
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<WindowFrame | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the strip's place in the window through resize observers and window resizes
  useLayoutEffect(() => {
    if (!strip) return;
    const measure = () => {
      const stripRect = strip.getBoundingClientRect();
      setFrame({
        top: -stripRect.top,
        left: -stripRect.left,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener("resize", measure);
    const stopObserving = observeResize(strip, measure);
    return () => {
      window.removeEventListener("resize", measure);
      stopObserving();
    };
  }, [strip]);
  if (!backdrop) return null;
  return (
    <div ref={setStrip} aria-hidden="true" className="chat-backdrop-top-fade">
      {frame ? (
        <div className="absolute" style={frame}>
          <Suspense fallback={null}>
            <BackgroundRenderer {...backdrop.renderer} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
});

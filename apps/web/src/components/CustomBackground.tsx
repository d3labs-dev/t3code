import { lazy, memo, Suspense, useLayoutEffect, useState } from "react";

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

export const CustomBackground = memo(function CustomBackground({
  routeKind,
}: {
  routeKind: CustomBackgroundRouteKind;
}) {
  const backdrop = useChatBackdrop(routeKind);
  const replyTextEmphasis = useClientSettings(
    (settings) => settings.customBackgroundReplyTextEmphasis,
  );
  if (!backdrop) return null;
  return (
    <div
      data-chat-backdrop="source"
      data-reply-text-emphasis={replyTextEmphasis || undefined}
      className="pointer-events-none absolute inset-0 -z-10"
    >
      <Suspense fallback={null}>
        <BackgroundRenderer {...backdrop} />
      </Suspense>
    </div>
  );
});

interface PaneFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Chromium's `backdrop-filter` stops at the nearest masked ancestor, so over a
 * picture the timeline drops its mask (custom.css) and this strip repaints the
 * pane's picture over its top edge instead.
 */
export const ChatBackdropTopFade = memo(function ChatBackdropTopFade() {
  const backdrop = useChatBackdrop("conversation");
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<PaneFrame | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the strip's offset from the pane through a ResizeObserver
  useLayoutEffect(() => {
    const pane = strip?.closest("[data-chat-background-pane]");
    if (!strip || !pane) return;
    const measure = () => {
      const stripRect = strip.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      setFrame({
        top: paneRect.top - stripRect.top,
        left: paneRect.left - stripRect.left,
        width: paneRect.width,
        height: paneRect.height,
      });
    };
    return observeResize([strip, pane], measure);
  }, [strip]);
  if (!backdrop) return null;
  return (
    <div ref={setStrip} aria-hidden="true" className="chat-backdrop-top-fade">
      {frame ? (
        <div className="absolute" style={frame}>
          <Suspense fallback={null}>
            <BackgroundRenderer {...backdrop} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
});

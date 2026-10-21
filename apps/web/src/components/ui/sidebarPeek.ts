import { useEffect, useState, type PointerEvent, type RefObject } from "react";

const HIDE_DELAY_MS = 200;
// Matches the data-peek slide duration on the sidebar container.
const SLIDE_MS = 200;

export type SidebarPeek = "hidden" | "shown" | "leaving";

/**
 * Peeks a collapsed offcanvas sidebar as a floating card while the mouse
 * rests on the window's left edge, and slides it back once the mouse moves
 * past it. The container draws the card from its data-peek attribute.
 */
export function useSidebarPeek({
  enabled,
  containerRef,
}: {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const [peek, setPeek] = useState<SidebarPeek>("hidden");
  if (peek !== "hidden" && !enabled) setPeek("hidden");

  useEffect(() => {
    if (peek !== "leaving") return;
    const timer = window.setTimeout(() => setPeek("hidden"), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [peek]);

  useEffect(() => {
    const container = containerRef.current;
    if (peek !== "shown" || !container) return;
    let hideTimer: number | undefined;
    // The collapsed container rests one sidebar width offscreen, so its
    // width is the card's extent from the window edge. Menus opened from the
    // sidebar render in portals outside it, so an open menu or a hovered
    // popup also holds the card.
    const holdsPeekOpen = (event: globalThis.PointerEvent) =>
      event.clientX < container.offsetWidth ||
      (event.target instanceof Node && container.contains(event.target)) ||
      container.querySelector("[data-popup-open]") !== null ||
      (event.target instanceof Element && event.target.closest('[data-slot$="popup"]') !== null);
    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (holdsPeekOpen(event)) {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
        return;
      }
      hideTimer ??= window.setTimeout(() => setPeek("leaving"), HIDE_DELAY_MS);
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.clearTimeout(hideTimer);
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, [containerRef, peek]);

  const onEdgePointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const container = containerRef.current;
    if (peek === "hidden" && container) {
      // Commit the offscreen start position so the card slides in from it.
      container.dataset.peek = "entering";
      container.getBoundingClientRect();
    }
    setPeek("shown");
  };

  return { peek, onEdgePointerEnter };
}

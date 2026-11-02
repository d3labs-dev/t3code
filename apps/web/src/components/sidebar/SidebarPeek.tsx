import { useEffect, useLayoutEffect, useState } from "react";

import { useSidebar } from "../ui/sidebar";

// Matches the slide transition on [data-app-sidebar][data-peek] in custom.css.
const SLIDE_MS = 200;
// The card closes once the pointer is this far past its edge, the same
// distance from the window edge that opens it.
const PEEK_EDGE_PX = 8;

type Peek = "hidden" | "shown" | "leaving";

function findAppSidebar(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-app-sidebar]");
}

/**
 * Slides the collapsed sidebar out as a floating card while the mouse rests
 * on the window's left edge, and back once the mouse moves past it. custom.css
 * draws the card from the data-peek attribute this sets on the sidebar.
 */
export function SidebarPeek() {
  const { isMobile, state } = useSidebar();
  const canPeek = !isMobile && state === "collapsed";
  const [peek, setPeek] = useState<Peek>("hidden");
  if (peek !== "hidden" && !canPeek) setPeek("hidden");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- data-peek and inert on the sidebar DOM node, which ui/sidebar owns
  useLayoutEffect(() => {
    const sidebar = findAppSidebar();
    if (!sidebar) return;
    if (peek === "hidden") delete sidebar.dataset.peek;
    else sidebar.dataset.peek = peek;
    // ui/sidebar makes the collapsed sidebar inert, which also lets the pointer
    // pass through it to the pane behind. Expanding never goes through
    // "leaving", so this cannot leave an expanded sidebar inert.
    const root = sidebar.closest<HTMLElement>('[data-slot="sidebar"]');
    if (!root) return;
    if (peek === "shown") root.inert = false;
    else if (peek === "leaving") root.inert = true;
  }, [peek]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that drops data-peek once the slide-out transition has run
  useEffect(() => {
    if (peek !== "leaving") return;
    const timer = window.setTimeout(() => setPeek("hidden"), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [peek]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document pointermove listener that hides the card once the pointer leaves it
  useEffect(() => {
    if (peek !== "shown") return;
    const sidebar = findAppSidebar();
    if (!sidebar) return;
    // The offset box ignores the slide transform, so the card counts from its
    // first frame. Menus opened from the sidebar render in portals outside
    // it, so an open menu or a hovered popup also holds it.
    const holdsPeekOpen = (event: PointerEvent) =>
      event.clientX < sidebar.offsetLeft + sidebar.offsetWidth + PEEK_EDGE_PX ||
      sidebar.querySelector("[data-popup-open]") !== null ||
      (event.target instanceof Element && event.target.closest('[data-slot$="popup"]') !== null);
    const onPointerMove = (event: PointerEvent) => {
      if (!holdsPeekOpen(event)) setPeek("leaving");
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => document.removeEventListener("pointermove", onPointerMove);
  }, [peek]);

  if (!canPeek || peek === "shown") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-y-0 left-0 z-10"
      style={{ width: PEEK_EDGE_PX }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        const sidebar = findAppSidebar();
        if (peek === "hidden" && sidebar) {
          // Commit the offscreen start position so the card slides in from it.
          sidebar.dataset.peek = "entering";
          sidebar.getBoundingClientRect();
        }
        setPeek("shown");
      }}
    />
  );
}

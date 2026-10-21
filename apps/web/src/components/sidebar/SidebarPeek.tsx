import { useEffect, useLayoutEffect, useState } from "react";

import { useSidebar } from "../ui/sidebar";

const HIDE_DELAY_MS = 200;
// Matches the slide transition on [data-app-sidebar][data-peek] in custom.css.
const SLIDE_MS = 200;

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

  useLayoutEffect(() => {
    const sidebar = findAppSidebar();
    if (!sidebar) return;
    if (peek === "hidden") delete sidebar.dataset.peek;
    else sidebar.dataset.peek = peek;
  }, [peek]);

  useEffect(() => {
    if (peek !== "leaving") return;
    const timer = window.setTimeout(() => setPeek("hidden"), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [peek]);

  useEffect(() => {
    if (peek !== "shown") return;
    const sidebar = findAppSidebar();
    if (!sidebar) return;
    let hideTimer: number | undefined;
    // Decided by where the pointer is rather than which element it hits:
    // Electron on macOS reports leave events and hit targets that a browser
    // would not. The offset box ignores the slide transform, so the card
    // counts from its first frame. Menus opened from the sidebar render in
    // portals outside it, so an open menu or a hovered popup also holds it.
    const holdsPeekOpen = (event: PointerEvent) =>
      event.clientX < sidebar.offsetLeft + sidebar.offsetWidth ||
      sidebar.querySelector("[data-popup-open]") !== null ||
      (event.target instanceof Element && event.target.closest('[data-slot$="popup"]') !== null);
    const onPointerMove = (event: PointerEvent) => {
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
  }, [peek]);

  if (!canPeek || peek === "shown") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-y-0 left-0 z-10 w-2"
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

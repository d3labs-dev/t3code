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
 * on the window's left edge, and back once the mouse leaves it. custom.css
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
    // Menus opened from the sidebar render in portals outside it, so an open
    // menu or the pointer over a popup keeps the sidebar out.
    const holdsPeekOpen = (target: EventTarget | null) =>
      sidebar.querySelector("[data-popup-open]") !== null ||
      (target instanceof Element &&
        (sidebar.contains(target) || target.closest('[data-slot$="popup"]') !== null));
    const scheduleHide = () => {
      hideTimer ??= window.setTimeout(() => setPeek("leaving"), HIDE_DELAY_MS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!holdsPeekOpen(event.target)) {
        scheduleHide();
        return;
      }
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    };
    const onPointerLeaveWindow = () => {
      if (!holdsPeekOpen(null)) scheduleHide();
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeaveWindow);
    return () => {
      window.clearTimeout(hideTimer);
      document.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeaveWindow);
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

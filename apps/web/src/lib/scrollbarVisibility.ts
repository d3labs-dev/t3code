const SCROLLING_ATTRIBUTE = "data-native-scrolling";
const HIDE_AFTER_IDLE_MS = 800;

/**
 * Flags any native scroller while it scrolls so index.css can show its
 * scrollbar thumb only then. Scroll events do not bubble, so one capture
 * listener on the window sees every scroller.
 */
export function revealScrollbarsWhileScrolling(target: EventTarget): () => void {
  const hideTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

  const onScroll = (event: Event) => {
    const scroller = event.target;
    if (!(scroller instanceof Element)) return;

    clearTimeout(hideTimers.get(scroller));
    if (!scroller.hasAttribute(SCROLLING_ATTRIBUTE)) {
      scroller.setAttribute(SCROLLING_ATTRIBUTE, "");
    }
    hideTimers.set(
      scroller,
      setTimeout(() => scroller.removeAttribute(SCROLLING_ATTRIBUTE), HIDE_AFTER_IDLE_MS),
    );
  };

  target.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => target.removeEventListener("scroll", onScroll, { capture: true });
}

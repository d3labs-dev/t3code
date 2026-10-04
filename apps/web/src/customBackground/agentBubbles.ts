import type { AgentBubbleBlur, AgentBubbleOpacity, AgentBubblePadding } from "@t3tools/contracts";

export function applyAgentBubbleSurface(
  root: HTMLElement,
  {
    opacity,
    blur,
    padding,
  }: { opacity: AgentBubbleOpacity; blur: AgentBubbleBlur; padding: AgentBubblePadding },
): void {
  root.style.setProperty("--agent-bubble-padding", `${padding}px`);
  root.style.setProperty("--agent-bubble-opacity", `${opacity}%`);
  root.style.setProperty("--agent-bubble-backdrop", blur === 0 ? "none" : `blur(${blur}px)`);
}

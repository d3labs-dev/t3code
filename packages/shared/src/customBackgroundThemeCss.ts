const SHOWING = '[data-chat-background-pane]:has(> [data-chat-backdrop="source"])';

/** Selectors for the custom background. themeCssHooks.test.ts in apps/web checks them like THEME_CSS_HOOKS. */
export const CUSTOM_BACKGROUND_THEME_CSS_HOOKS = [
  { selector: "[data-chat-background-pane]", styles: "chat pane that can show a picture" },
  {
    selector: '[data-chat-backdrop="source"]',
    styles:
      "present in the pane while a picture shows; carries data-agent-bubbles, data-user-bubbles, and data-reply-text-emphasis when those are on",
  },
  { selector: ".custom-background-slide", styles: "the picture itself" },
] as const;

/**
 * Each slider in Customize background writes one of these on the document root.
 * Theme CSS that sets one on the pane wins, since the pane is closer to what reads it.
 */
const LOOK_VARIABLES = [
  ["--agent-bubble-opacity", "fill of reply and message bubbles, a percentage"],
  ["--agent-bubble-backdrop", "`none` or a filter such as `blur(8px)` behind bubbles"],
  ["--agent-bubble-padding", "bubble padding, a length"],
  ["--reply-text-shadow-opacity", "shadow behind reply text, a percentage"],
  ["--composer-glass-opacity", "composer fill in a thread with messages, a percentage"],
  ["--composer-glass-blur", "composer blur in a thread with messages, a length"],
  ["--hero-composer-glass-opacity", "composer fill on a new thread, a percentage"],
  ["--hero-composer-glass-blur", "composer blur on a new thread, a length"],
] as const;

export const CUSTOM_BACKGROUND_THEME_GUIDE = [
  "Custom background: the user can show their own pictures behind the chat. Pictures, filters, fade, and rotation are set in Customize background, not by themes.",
  `Scope rules to a showing picture with \`${SHOWING}\`.`,
  "Its look reads these variables. Set them on `[data-chat-background-pane]` so they win over the user's sliders:",
  ...LOOK_VARIABLES.map(([name, meaning]) => `- ${name}: ${meaning}`),
  ...CUSTOM_BACKGROUND_THEME_CSS_HOOKS.map((hook) => `- ${hook.selector}: ${hook.styles}`),
].join("\n");

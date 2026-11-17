const SHOWING = '[data-slot="sidebar-wrapper"]:has(> [data-chat-backdrop="source"])';

/** Selectors for the custom background. themeCssHooks.test.ts in apps/web checks them like THEME_CSS_HOOKS. */
export const CUSTOM_BACKGROUND_THEME_CSS_HOOKS = [
  { selector: "[data-chat-background-pane]", styles: "chat pane, clear over the picture" },
  {
    selector: '[data-chat-backdrop="source"]',
    styles:
      "the picture layer behind the whole window, sidebar included, present while a picture shows",
  },
  { selector: ".custom-background-slide", styles: "the picture itself" },
] as const;

/** Theme CSS that sets one of these on the scope below changes every surface that reads it. */
const LOOK_VARIABLES = [
  [
    "--wallpaper-panel-opacity",
    "fill of the sidebar, details card, input box, and bubbles, a percentage; defaults to max(55%, var(--wallpaper-readable-opacity))",
  ],
  ["--wallpaper-glass", "the fill color those surfaces share, built from that opacity"],
  ["--wallpaper-bubble-padding", "bubble padding, a length"],
] as const;

export const CUSTOM_BACKGROUND_THEME_GUIDE = [
  "Custom background: the user can show their own pictures behind the chat. Pictures, filters, fade, and rotation are set in Customize background, not by themes.",
  `Scope rules to a showing picture with \`${SHOWING}\`.`,
  "Its look reads these variables, set in that scope:",
  ...LOOK_VARIABLES.map(([name, meaning]) => `- ${name}: ${meaning}`),
  "The app sets --wallpaper-readable-opacity from the picture showing, the least fill that keeps text readable on it.",
  ...CUSTOM_BACKGROUND_THEME_CSS_HOOKS.map((hook) => `- ${hook.selector}: ${hook.styles}`),
].join("\n");

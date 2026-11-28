import { describe, expect, it } from "vite-plus/test";

import { isBotNoReplyMessage } from "./botProactive.ts";

describe("isBotNoReplyMessage", () => {
  it.each([
    "",
    "NO_REPLY",
    "  no_reply\n",
    "`NO_REPLY`",
    "**NO_REPLY**",
    "NO_REPLY.",
    '"NO_REPLY"',
    "```\nNO_REPLY\n```",
  ])("treats %j as staying quiet", (text) => {
    expect(isBotNoReplyMessage(text)).toBe(true);
  });

  it.each(["NO_REPLY needed? CI is red.", "- CI is red on main.", "NO REPLY"])(
    "treats %j as a message",
    (text) => {
      expect(isBotNoReplyMessage(text)).toBe(false);
    },
  );
});

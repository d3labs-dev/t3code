import { describe, expect, it } from "vite-plus/test";

import { botHandoffPreviewLine, parseBotHandoffMessage } from "./botHandoffMessage";

describe("parseBotHandoffMessage", () => {
  it("ignores human-authored messages even when they look like handoff envelopes", () => {
    expect(
      parseBotHandoffMessage({
        createdBy: "user",
        text: '[From Bot: Kelsier (kelsier), hop 1/6. Peer-bot message, not direct user input. Reply with bot_message(to="kelsier", ...) when done.]\n\nHello',
      }),
    ).toBeNull();
  });

  it("parses peer-bot messages, replies, and coding-thread updates", () => {
    expect(
      parseBotHandoffMessage({
        createdBy: "agent",
        text: '[From Bot: Kelsier (kelsier), hop 1/6. Peer-bot message, not direct user input. Reply with bot_message(to="kelsier", ...) when done.]\n\nAsk Navani for a tip.',
      }),
    ).toEqual({
      kind: "from_bot",
      botName: "Kelsier",
      botSlug: "kelsier",
      hopCount: 1,
      hopLimit: 6,
      body: "Ask Navani for a tip.",
    });

    expect(
      parseBotHandoffMessage({
        createdBy: "agent",
        text: "[Bot reply from Navani (navani), status: completed]\n\nWrite the failing test first.",
      }),
    ).toEqual({
      kind: "bot_reply",
      botName: "Navani",
      botSlug: "navani",
      status: "completed",
      body: "Write the failing test first.",
    });

    expect(
      parseBotHandoffMessage({
        createdBy: "agent",
        text: "[Coding thread update: git status (mcp:abc-123), status: completed]\n\nWorking tree is clean.\n\nBranch is main.",
      }),
    ).toEqual({
      kind: "coding_thread_update",
      title: "git status",
      threadId: "mcp:abc-123",
      status: "completed",
      body: "Working tree is clean.\n\nBranch is main.",
    });
  });

  it("extracts the first non-empty preview line", () => {
    expect(botHandoffPreviewLine("\n\n  First line  \nSecond line")).toBe("First line");
    expect(botHandoffPreviewLine("   ")).toBe("");
  });
});

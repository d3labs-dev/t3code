import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { BotError, BotMcpServerConfig, BotRecord, BotSlug, slugifyBotName } from "./bot.ts";

const decodeSlug = Schema.decodeUnknownSync(BotSlug);
const decodeMcpServer = Schema.decodeUnknownSync(BotMcpServerConfig);
const decodeRecord = Schema.decodeUnknownSync(BotRecord);
const encodeRecord = Schema.encodeSync(BotRecord);
const decodeError = Schema.decodeSync(BotError);
const decodeUnknownError = Schema.decodeUnknownSync(BotError);

describe("slugifyBotName", () => {
  it.each([
    ["Chief of Staff", "chief-of-staff"],
    ["  Matcha!! ", "matcha"],
    ["Café Crème", "cafe-creme"],
    ["Eng Lead #2", "eng-lead-2"],
    ["--already-slugged--", "already-slugged"],
    ["🤖", "bot"],
    ["抹茶", "bot"],
    ["", "bot"],
  ])("slugifies %j as %j", (name, slug) => {
    expect(slugifyBotName(name)).toBe(slug);
  });

  it("keeps long names within the slug limit without a trailing hyphen", () => {
    const slug = slugifyBotName(`${"a".repeat(39)} tail`);
    expect(slug).toBe("a".repeat(39));
    expect(decodeSlug(slugifyBotName("word ".repeat(20)))).toHaveLength(39);
  });
});

describe("BotSlug", () => {
  it.each(["a", "matcha", "eng-lead-2", "0", "a".repeat(40)])("accepts %j", (slug) => {
    expect(decodeSlug(slug)).toBe(slug);
  });

  it.each(["", "-a", "a-", "Matcha", "a_b", " matcha", "a".repeat(41)])("rejects %j", (slug) => {
    expect(() => decodeSlug(slug)).toThrow();
  });
});

describe("BotMcpServerConfig", () => {
  it("decodes each transport by its type", () => {
    expect(
      decodeMcpServer({
        type: "stdio",
        command: " npx ",
        args: ["-y", "server"],
        env: { TOKEN: "x" },
      }),
    ).toEqual({ type: "stdio", command: "npx", args: ["-y", "server"], env: { TOKEN: "x" } });
    expect(decodeMcpServer({ type: "http", url: "https://mcp.test", headers: { a: "b" } })).toEqual(
      { type: "http", url: "https://mcp.test", headers: { a: "b" } },
    );
    expect(decodeMcpServer({ type: "sse", url: "https://mcp.test/sse" })).toEqual({
      type: "sse",
      url: "https://mcp.test/sse",
    });
  });

  it.each([
    { type: "stdio", command: "  " },
    { type: "stdio", url: "https://mcp.test" },
    { type: "http" },
    { type: "ws", url: "wss://mcp.test" },
  ])("rejects %j", (config) => {
    expect(() => decodeMcpServer(config)).toThrow();
  });
});

describe("BotRecord", () => {
  it("survives a persistence round trip", () => {
    const encoded = {
      id: "bot-1",
      slug: "matcha",
      name: "Matcha",
      role: "",
      groupName: null,
      icon: "bot",
      color: "#6366f1",
      isPrimary: true,
      muted: false,
      threadId: "thread-1",
      folderPath: "/home/me/.t3/bots/matcha",
      modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
      runtimeMode: "full-access",
      tools: ["Read", "Bash"],
      mcpServerNames: ["figma"],
      customMcpServers: { d3labs: { type: "http", url: "https://mcp.d3labs.test" } },
      skills: [],
      systemPromptMode: "custom",
      hopCount: 2,
      archivedAt: null,
      createdAt: "2026-11-26T00:00:00.000Z",
      updatedAt: "2026-11-26T00:00:00.000Z",
    };
    const record = decodeRecord(encoded);
    expect(encodeRecord(record)).toEqual(encoded);
  });
});

describe("BotError", () => {
  it("decodes from the wire as a tagged BotError", () => {
    const error = decodeError({
      _tag: "BotError",
      code: "hop_limit_reached",
      message: "Hop limit reached.",
    });
    expect(error).toBeInstanceOf(BotError);
    expect(error._tag).toBe("BotError");
    expect(error.code).toBe("hop_limit_reached");
    expect(() => decodeUnknownError({ _tag: "BotError", code: "nope", message: "x" })).toThrow();
  });
});

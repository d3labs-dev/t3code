import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { BotListResult, BotMcpServerConfig, BotSlug, slugifyBotName } from "./bot.ts";

const decodeSlug = Schema.decodeUnknownSync(BotSlug);
const decodeMcpServer = Schema.decodeUnknownSync(BotMcpServerConfig);
const decodeListResult = Schema.decodeUnknownSync(BotListResult);

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

describe("BotListResult", () => {
  const link = {
    botId: "bot-1",
    threadId: "thread-2",
    status: "pending",
    createdAt: "2026-11-26T00:00:00.000Z",
    resolvedAt: null,
  };

  it("drops coding-thread links a newer server sends with an unknown status", () => {
    const decoded = decodeListResult({
      bots: [],
      availableMcpServers: [],
      backingProjectId: null,
      codingThreads: [link, { ...link, threadId: "thread-3", status: "paused" }],
    });
    expect(decoded.codingThreads.map(({ threadId }) => threadId)).toEqual(["thread-2"]);
  });
});

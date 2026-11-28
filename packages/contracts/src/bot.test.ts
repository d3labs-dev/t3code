import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  BotCodingThreadLink,
  BotError,
  BotListResult,
  BotMcpServerConfig,
  BotRecord,
  BotSlug,
  BotUpdateInput,
  slugifyBotName,
} from "./bot.ts";

const decodeSlug = Schema.decodeUnknownSync(BotSlug);
const decodeMcpServer = Schema.decodeUnknownSync(BotMcpServerConfig);
const decodeRecord = Schema.decodeUnknownSync(BotRecord);
const encodeRecord = Schema.encodeSync(BotRecord);
const decodeLink = Schema.decodeUnknownSync(BotCodingThreadLink);
const encodeLink = Schema.encodeSync(BotCodingThreadLink);
const decodeListResult = Schema.decodeUnknownSync(BotListResult);
const encodeListResult = Schema.encodeSync(BotListResult);
const decodeUpdateInput = Schema.decodeUnknownSync(BotUpdateInput);
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

const encodedRecord = {
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
  proactive: {
    enabled: true,
    intervalMinutes: 60,
    activeHoursStart: "09:00",
    activeHoursEnd: "18:30",
    timezone: "Europe/Madrid",
  },
  hopCount: 2,
  archivedAt: null,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
};

describe("BotRecord", () => {
  it("survives a persistence round trip", () => {
    expect(encodeRecord(decodeRecord(encodedRecord))).toEqual(encodedRecord);
  });
});

describe("BotCodingThreadLink", () => {
  it("survives a wire round trip in each state", () => {
    const pending = {
      botId: "bot-1",
      threadId: "thread-2",
      status: "pending",
      createdAt: "2026-11-26T00:00:00.000Z",
      resolvedAt: null,
    };
    const woken = { ...pending, status: "woken", resolvedAt: "2026-11-26T00:05:00.000Z" };
    expect(encodeLink(decodeLink(pending))).toEqual(pending);
    expect(encodeLink(decodeLink(woken))).toEqual(woken);
    expect(() => decodeLink({ ...pending, threadId: " " })).toThrow();
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

  it("carries the backing project and coding-thread links over the wire", () => {
    const encoded = {
      bots: [{ bot: encodedRecord, status: "working" }],
      availableMcpServers: [{ name: "figma", transport: "http" }],
      backingProjectId: "project-bots",
      codingThreads: [link],
    };
    expect(encodeListResult(decodeListResult(encoded))).toEqual(encoded);
    const empty = { bots: [], availableMcpServers: [], backingProjectId: null, codingThreads: [] };
    expect(encodeListResult(decodeListResult(empty))).toEqual(empty);
  });

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

describe("BotDocuments", () => {
  it("leaves unpatched documents and proactive settings out of an update", () => {
    const update = decodeUpdateInput({ botId: "bot-1", documents: { soul: "a" } });
    expect(update.documents).toEqual({ soul: "a" });
    expect(update.documents?.now).toBeUndefined();
    expect(update.documents?.heartbeat).toBeUndefined();
    expect(update.proactive).toBeUndefined();
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

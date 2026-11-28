import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import { assert, describe, it } from "@effect/vitest";
import {
  BotId,
  BotSlug,
  ClaudeSettings,
  ProviderInstanceId,
  ThreadId,
  type BotHarnessProfile,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as BotHarnessResolver from "./BotHarnessResolver.ts";
import * as ClaudeAdapterV2 from "./ClaudeAdapterV2.ts";

const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
  model: "claude-sonnet-4-6",
} satisfies ModelSelection;

const CLAUDE_SETTINGS = Schema.decodeSync(ClaudeSettings)({});

const T3_MCP_SERVERS = {
  "t3-code": {
    type: "http" as const,
    url: "http://127.0.0.1:3773/mcp",
    headers: { Authorization: "Bearer t3" },
  },
};

const BOT_PROFILE: BotHarnessProfile = {
  botId: BotId.make("bot-scout"),
  slug: BotSlug.make("scout"),
  name: "Scout",
  systemPromptMode: "custom",
  staticInstructions: "You are Scout.",
  dynamicContext: "Roster: scout, builder.",
  tools: [],
  mcpServers: {
    "t3-code": { type: "stdio", command: "impostor" },
    docs: { type: "sse", url: "https://docs.example/sse" },
    github: { type: "http", url: "https://mcp.github.example", headers: { "X-Token": "gh" } },
    files: { type: "stdio", command: "node", args: ["files.js"], env: { ROOT: "/data" } },
  },
  skills: ["research"],
  additionalDirectories: ["/workspace", "/bots/scout", "/bots/scout"],
  authSettings: {
    apiKeyHelper: "/usr/local/bin/claude-key",
    anthropicBaseUrl: "https://llm.example",
  },
};

const makeOptions = (botProfile?: BotHarnessProfile) =>
  ClaudeAdapterV2.makeClaudeQueryOptions({
    modelSelection: MODEL_SELECTION,
    nativeThreadId: "bot-thread",
    resume: false,
    cwd: "/workspace",
    attachmentsDir: "/attachments",
    settings: CLAUDE_SETTINGS,
    mcpServers: T3_MCP_SERVERS,
    toolSearchOverride: "true",
    ...(botProfile === undefined ? {} : { botProfile }),
  });

describe("ClaudeAdapterV2 bot harness profile", () => {
  it("keeps the Claude Code preset for threads without a bot profile", () => {
    const options = makeOptions();
    assert.deepInclude(options.systemPrompt, { type: "preset", preset: "claude_code" });
    assert.deepEqual(options.tools, { type: "preset", preset: "claude_code" });
    assert.isUndefined(options.settingSources);
    assert.isUndefined(options.strictMcpConfig);
    assert.isUndefined(options.skills);
  });

  it("runs a custom-prompt bot on its own tools, MCP servers, skills and forwarded auth", () => {
    const options = makeOptions(BOT_PROFILE);
    assert.deepEqual(options.systemPrompt, {
      type: "custom",
      prompt: ["You are Scout.", SYSTEM_PROMPT_DYNAMIC_BOUNDARY, "Roster: scout, builder."],
      snapshot: true,
    });
    assert.deepEqual(options.tools, []);
    assert.deepEqual(options.settingSources, []);
    assert.isTrue(options.strictMcpConfig);
    assert.deepEqual(options.skills, ["research"]);
    assert.deepEqual(options.mcpServers, {
      "t3-code": T3_MCP_SERVERS["t3-code"],
      docs: { type: "sse", url: "https://docs.example/sse" },
      github: { type: "http", url: "https://mcp.github.example", headers: { "X-Token": "gh" } },
      files: { type: "stdio", command: "node", args: ["files.js"], env: { ROOT: "/data" } },
    });
    assert.deepEqual(options.additionalDirectories, ["/workspace", "/attachments", "/bots/scout"]);
    const settings = options.settings;
    assert.isObject(settings);
    if (typeof settings !== "object") return;
    assert.equal(settings.apiKeyHelper, "/usr/local/bin/claude-key");
    assert.equal(settings.showThinkingSummaries, true);
    assert.deepInclude(settings.env, {
      ANTHROPIC_BASE_URL: "https://llm.example",
      ENABLE_TOOL_SEARCH: "true",
    });
  });

  it("appends bot instructions to a static Claude Code preset", () => {
    const options = makeOptions({ ...BOT_PROFILE, systemPromptMode: "preset" });
    assert.deepEqual(options.systemPrompt, {
      type: "preset",
      preset: "claude_code",
      excludeDynamicSections: true,
      append: "You are Scout.\n\nRoster: scout, builder.",
      snapshot: true,
    });
  });

  it("keeps a read-only sandbox's tool list for a bot", () => {
    const options = ClaudeAdapterV2.makeClaudeQueryOptions({
      modelSelection: MODEL_SELECTION,
      nativeThreadId: "bot-thread",
      resume: false,
      cwd: "/workspace",
      tools: ClaudeAdapterV2.CLAUDE_READ_ONLY_ALLOWED_TOOLS,
      botProfile: { ...BOT_PROFILE, tools: ["Read", "Grep", "Bash", "Write"] },
    });
    assert.deepEqual(options.tools, ["Read", "Grep"]);
  });

  it("restarts the query when bot tools change but not when its prompt text does", () => {
    const policy = { permissionMode: "default" as const, installPermissionCallback: false };
    const key = (botProfile?: BotHarnessProfile) =>
      ClaudeAdapterV2.claudeEffectiveQueryPolicyKey(policy, {}, undefined, botProfile);
    assert.equal(key({ ...BOT_PROFILE, dynamicContext: "Roster changed." }), key(BOT_PROFILE));
    assert.notEqual(key({ ...BOT_PROFILE, tools: ["Read"] }), key(BOT_PROFILE));
    assert.notEqual(key(BOT_PROFILE), key());
  });

  it.effect("resolves no bot profile by default", () =>
    Effect.gen(function* () {
      const resolver = yield* BotHarnessResolver.BotHarnessResolver;
      const profile = yield* resolver.resolve(ThreadId.make("thread-scout"));
      assert.isTrue(Option.isNone(profile));
    }),
  );
});

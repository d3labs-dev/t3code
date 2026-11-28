import {
  BotId,
  type BotDocuments,
  type BotRecord,
  BotSlug,
  DEFAULT_BOT_PROACTIVE_CONFIG,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { BOT_THEME_COLOR } from "./botAvatar.ts";
import { botGroupSuggestions, botSettingsForm, shuffleBotIdentity } from "./botForm.ts";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");

const bot = (
  slug: string,
  overrides: Partial<Pick<BotRecord, "groupName" | "archivedAt">> = {},
): BotRecord => ({
  id: BotId.make(`bot-${slug}`),
  slug: BotSlug.make(slug),
  name: slug,
  role: "",
  groupName: null,
  icon: "squircle",
  color: "#6366f1",
  isPrimary: false,
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-haiku" },
  runtimeMode: "full-access",
  tools: ["Read"],
  mcpServerNames: [],
  customMcpServers: {},
  skills: [],
  systemPromptMode: "custom",
  proactive: DEFAULT_BOT_PROACTIVE_CONFIG,
  muted: false,
  threadId: ThreadId.make(`thread-${slug}`),
  folderPath: `/bots/${slug}`,
  hopCount: 0,
  archivedAt: null,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
  ...overrides,
});

const saved: BotDocuments = { soul: "soul", now: "", memory: "memory", heartbeat: "" };

describe("botSettingsForm", () => {
  it("saves only what changed, with the name and group trimmed", () => {
    const ada = bot("ada");
    const form = botSettingsForm(
      ada,
      {
        name: " Ada Lovelace ",
        tools: ["Read"],
        proactive: { ...DEFAULT_BOT_PROACTIVE_CONFIG },
      },
      saved,
      { soul: "new soul", memory: "memory" },
    );
    expect(form.changeCount).toBe(2);
    expect(form.dirtyDocuments).toEqual(["soul"]);
    expect(form.saveInput).toEqual({
      botId: ada.id,
      name: "Ada Lovelace",
      documents: { soul: "new soul" },
    });
  });

  it("clears a group typed as blank and keeps a real one trimmed", () => {
    const ops = bot("ops", { groupName: "Ops" });
    expect(botSettingsForm(ops, { groupName: "  " }, saved, {}).saveInput).toEqual({
      botId: ops.id,
      groupName: null,
    });
    expect(botSettingsForm(ops, { groupName: " Design " }, saved, {}).saveInput).toEqual({
      botId: ops.id,
      groupName: "Design",
    });
  });

  it("has nothing to save without changes or without a name", () => {
    const ada = bot("ada");
    expect(botSettingsForm(ada, {}, saved, {}).saveInput).toBeNull();
    const nameless = botSettingsForm(ada, { name: "  " }, saved, {});
    expect(nameless.nameMissing).toBe(true);
    expect(nameless.saveInput).toBeNull();
  });

  it("drops a draft once the saved document caught up with it", () => {
    const drafts = { soul: "soul", memory: "still typing" };
    const form = botSettingsForm(bot("ada"), {}, saved, drafts);
    expect(form.pendingDrafts).toEqual({ memory: "still typing" });

    const untouched = { memory: "still typing" };
    expect(botSettingsForm(bot("ada"), {}, saved, untouched).pendingDrafts).toBe(untouched);
  });

  it("treats every draft as unsaved while the documents load", () => {
    const form = botSettingsForm(bot("ada"), {}, null, { soul: "soul" });
    expect(form.dirtyDocuments).toEqual(["soul"]);
    expect(form.pendingDrafts).toEqual({ soul: "soul" });
  });
});

describe("botGroupSuggestions", () => {
  it("lists the environment's active groups once, sorted", () => {
    const bots = [
      { environmentId: local, bot: bot("a", { groupName: "Ops" }) },
      { environmentId: local, bot: bot("b", { groupName: "Design" }) },
      { environmentId: local, bot: bot("c", { groupName: "Ops" }) },
      {
        environmentId: local,
        bot: bot("d", { groupName: "Old", archivedAt: "2026-11-27T00:00:00.000Z" }),
      },
      { environmentId: remote, bot: bot("e", { groupName: "Remote" }) },
    ].map((entry) => ({ ...entry, status: "idle" as const }));
    expect(botGroupSuggestions(bots, local)).toEqual(["Design", "Ops"]);
  });

  it("offers starter groups when the environment has none", () => {
    expect(botGroupSuggestions([], local)).toEqual(["Engineering", "Operations", "Creative"]);
    expect(botGroupSuggestions([], null)).toEqual(["Engineering", "Operations", "Creative"]);
  });
});

describe("shuffleBotIdentity", () => {
  it("always changes the shape and picks a solid color other than the current one", () => {
    for (const random of [0, 0.5, 0.999]) {
      const next = shuffleBotIdentity({ icon: "circle", color: "#242429" }, () => random);
      expect(next.icon).not.toBe("circle");
      expect(next.color).not.toBe("#242429");
      expect(next.color).not.toBe(BOT_THEME_COLOR);
    }
  });
});

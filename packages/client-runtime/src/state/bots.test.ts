import {
  BotId,
  type BotCodingThreadLink,
  type BotListResult,
  type BotRecord,
  BotSlug,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { scopedThreadKey } from "../environment/scoped.ts";
import {
  botKey,
  groupBotsForSidebar,
  indexBotsAcrossEnvironments,
  projectKey,
  type ScopedBotEntry,
  withoutBotsModeThreads,
} from "./bots.ts";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");

const bot = (
  slug: string,
  overrides: Partial<Pick<BotRecord, "groupName" | "isPrimary" | "archivedAt">> = {},
): BotRecord => ({
  id: BotId.make(`bot-${slug}`),
  slug: BotSlug.make(slug),
  name: slug,
  role: "",
  groupName: null,
  icon: "bot",
  color: "#6366f1",
  isPrimary: false,
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-haiku" },
  runtimeMode: "full-access",
  tools: [],
  mcpServerNames: [],
  customMcpServers: {},
  skills: [],
  systemPromptMode: "custom",
  muted: false,
  threadId: ThreadId.make(`thread-${slug}`),
  folderPath: `/bots/${slug}`,
  hopCount: 0,
  archivedAt: null,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
  ...overrides,
});

const link = (
  owner: BotRecord,
  threadId: string,
  status: BotCodingThreadLink["status"],
  minute: number,
): BotCodingThreadLink => ({
  botId: owner.id,
  threadId: ThreadId.make(threadId),
  status,
  createdAt: `2026-11-26T00:${String(minute).padStart(2, "0")}:00.000Z`,
  resolvedAt: status === "pending" ? null : "2026-11-26T01:00:00.000Z",
});

const listResult = (overrides: Partial<BotListResult>): BotListResult => ({
  bots: [],
  availableMcpServers: [],
  backingProjectId: null,
  codingThreads: [],
  ...overrides,
});

const entry = (environmentId: EnvironmentId, record: BotRecord): ScopedBotEntry => ({
  environmentId,
  bot: record,
  status: "idle",
});

describe("indexBotsAcrossEnvironments", () => {
  const scout = bot("scout");
  const planner = bot("planner");

  it("scopes bots, backing projects and MCP servers to their environment", () => {
    const sameThreadElsewhere = { ...scout, id: BotId.make("bot-remote-scout") };
    const index = indexBotsAcrossEnvironments([
      [
        local,
        listResult({
          bots: [{ bot: scout, status: "working" }],
          availableMcpServers: [{ name: "github", transport: "stdio" }],
          backingProjectId: ProjectId.make("bots-project"),
        }),
      ],
      [remote, listResult({ bots: [{ bot: sameThreadElsewhere, status: "idle" }] })],
    ]);

    expect(index.bots.map(({ environmentId, bot }) => [environmentId, bot.id])).toEqual([
      [local, scout.id],
      [remote, sameThreadElsewhere.id],
    ]);
    expect(
      index.botByThreadKey.get(scopedThreadKey({ environmentId: local, threadId: scout.threadId })),
    ).toEqual({ environmentId: local, bot: scout, status: "working" });
    expect(
      index.botByThreadKey.get(scopedThreadKey({ environmentId: remote, threadId: scout.threadId }))
        ?.bot.id,
    ).toBe(sameThreadElsewhere.id);
    expect([...index.backingProjectKeys]).toEqual([
      projectKey(local, ProjectId.make("bots-project")),
    ]);
    expect(index.availableMcpServersByEnvironment.get(local)).toEqual([
      { name: "github", transport: "stdio" },
    ]);
    expect(index.availableMcpServersByEnvironment.get(remote)).toEqual([]);
  });

  it("resolves each coding thread to its newest supervising active bot and counts pending links", () => {
    const retired = bot("retired", { archivedAt: "2026-11-25T00:00:00.000Z" });
    const index = indexBotsAcrossEnvironments([
      [
        local,
        listResult({
          bots: [
            { bot: scout, status: "idle" },
            { bot: planner, status: "idle" },
            { bot: retired, status: "idle" },
          ],
          codingThreads: [
            link(planner, "thread-shared", "pending", 30),
            link(scout, "thread-fix", "woken", 10),
            link(scout, "thread-shared", "woken", 5),
            link(scout, "thread-docs", "pending", 20),
            link(bot("deleted"), "thread-orphan", "pending", 40),
            link(retired, "thread-shared", "pending", 50),
            link(retired, "thread-retired", "pending", 45),
          ],
        }),
      ],
      [remote, listResult({ bots: [{ bot: scout, status: "idle" }] })],
    ]);

    const supervisor = (environmentId: EnvironmentId, threadId: string) =>
      index.supervisorByCodingThreadKey.get(
        scopedThreadKey({ environmentId, threadId: ThreadId.make(threadId) }),
      );
    expect(supervisor(local, "thread-shared")?.botEntry.bot.id).toBe(planner.id);
    expect(supervisor(local, "thread-shared")?.link.status).toBe("pending");
    expect(supervisor(local, "thread-fix")?.botEntry).toEqual(entry(local, scout));
    expect(supervisor(local, "thread-orphan")).toBeUndefined();
    expect(supervisor(local, "thread-retired")).toBeUndefined();
    expect(supervisor(remote, "thread-fix")).toBeUndefined();
    expect(index.codingThreadsByBotKey.get(botKey(local, retired.id))).toBeUndefined();
    expect(
      index.botByThreadKey.get(
        scopedThreadKey({ environmentId: local, threadId: retired.threadId }),
      )?.bot.id,
    ).toBe(retired.id);

    expect(
      index.codingThreadsByBotKey
        .get(botKey(local, scout.id))
        ?.map(({ environmentId, link }) => [environmentId, link.threadId]),
    ).toEqual([
      [local, "thread-docs"],
      [local, "thread-fix"],
      [local, "thread-shared"],
    ]);
    expect(index.codingThreadsByBotKey.get(botKey(remote, scout.id))).toBeUndefined();
    expect(index.activeCodingThreadCount).toBe(2);
  });

  it("indexes nothing for environments without bots", () => {
    const index = indexBotsAcrossEnvironments([[local, listResult({})]]);
    expect(index.bots).toEqual([]);
    expect(index.supervisorByCodingThreadKey.size).toBe(0);
    expect(index.backingProjectKeys.size).toBe(0);
    expect(index.activeCodingThreadCount).toBe(0);
  });
});

describe("withoutBotsModeThreads", () => {
  const scout = bot("scout");
  const backingProjectId = ProjectId.make("bots-project");
  const repoProjectId = ProjectId.make("repo");
  const shell = (environmentId: EnvironmentId, projectId: ProjectId, threadId: string) => ({
    environmentId,
    projectId,
    id: ThreadId.make(threadId),
  });

  it("drops Bot threads and backing-project threads but keeps Bot-started coding threads", () => {
    const index = indexBotsAcrossEnvironments([
      [
        local,
        listResult({
          bots: [{ bot: scout, status: "idle" }],
          backingProjectId,
          codingThreads: [link(scout, "thread-fix", "pending", 10)],
        }),
      ],
    ]);
    const botThread = shell(local, repoProjectId, scout.threadId);
    const backingThread = shell(local, backingProjectId, "thread-scratch");
    const codingThread = shell(local, repoProjectId, "thread-fix");
    const sameIdsElsewhere = shell(remote, backingProjectId, scout.threadId);

    expect(
      withoutBotsModeThreads([botThread, backingThread, codingThread, sameIdsElsewhere], index),
    ).toEqual([codingThread, sameIdsElsewhere]);
  });
});

describe("groupBotsForSidebar", () => {
  it("pins the first active primary bot and sorts named groups before ungrouped bots", () => {
    const archivedPrimary = entry(
      local,
      bot("old-chief", { isPrimary: true, archivedAt: "2026-11-25T00:00:00.000Z" }),
    );
    const chief = entry(local, bot("chief", { isPrimary: true }));
    const remoteChief = entry(remote, bot("remote-chief", { isPrimary: true }));
    const loose = entry(local, bot("loose"));
    const writer = entry(local, bot("writer", { groupName: "writing" }));
    const builder = entry(remote, bot("builder", { groupName: "Engineering" }));
    const reviewer = entry(local, bot("reviewer", { groupName: "Engineering" }));
    const editor = entry(local, bot("editor", { groupName: "writing" }));
    const archived = entry(
      local,
      bot("retired", { groupName: "Engineering", archivedAt: "2026-11-25T00:00:00.000Z" }),
    );

    expect(
      groupBotsForSidebar([
        archivedPrimary,
        loose,
        chief,
        writer,
        builder,
        remoteChief,
        reviewer,
        editor,
        archived,
      ]),
    ).toEqual({
      primary: chief,
      groups: [
        { name: "Engineering", bots: [builder, reviewer] },
        { name: "writing", bots: [writer, editor] },
        { name: null, bots: [loose, remoteChief] },
      ],
    });
  });

  it("returns no primary and no groups for an empty roster", () => {
    expect(groupBotsForSidebar([])).toEqual({ primary: null, groups: [] });
  });
});

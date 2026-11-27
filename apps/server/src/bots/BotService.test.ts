import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type BotExchangeStatus,
  type BotId,
  type BotListResult,
  type BotRecord,
  BotSlug,
  EventId,
  MessageId,
  type OrchestrationV2Actor,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BotFolders from "./BotFolders.ts";
import * as BotService from "./BotService.ts";
import * as BotStore from "./BotStore.ts";

const at = DateTime.makeUnsafe("2026-11-26T00:00:00.000Z");
const modelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-haiku-4-5",
};

interface FakeThread {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly relationshipToParent: OrchestrationV2ThreadShell["lineage"]["relationshipToParent"];
  status: OrchestrationV2ThreadShell["status"];
  readonly messages: Array<OrchestrationV2ConversationMessage>;
  pullRequestUrl: string | null;
}

const message = (input: {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdBy: OrchestrationV2Actor;
  readonly senderThreadId?: ThreadId | undefined;
}): OrchestrationV2ConversationMessage => ({
  createdBy: input.createdBy,
  creationSource: "web",
  ...(input.senderThreadId === undefined ? {} : { senderThreadId: input.senderThreadId }),
  id: MessageId.make(input.id),
  threadId: input.threadId,
  runId: input.runId,
  nodeId: null,
  role: input.role,
  text: input.text,
  attachments: [],
  streaming: false,
  createdAt: at,
  updatedAt: at,
});

const messageUpdated = (
  payload: OrchestrationV2ConversationMessage,
): OrchestrationV2DomainEvent => ({
  id: EventId.make("event"),
  threadId: payload.threadId,
  occurredAt: at,
  type: "message.updated",
  payload,
});

const runUpdated = (
  threadId: ThreadId,
  runId: RunId,
  status: OrchestrationV2Run["status"],
): OrchestrationV2DomainEvent => ({
  id: EventId.make("event"),
  threadId,
  runId,
  occurredAt: at,
  type: "run.updated",
  payload: {
    id: runId,
    threadId,
    ordinal: 1,
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${runId}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at,
    startedAt: at,
    completedAt: at,
    checkpointId: null,
    contextHandoffId: null,
  },
});

const makeHarness = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bots-" });
  const home = path.join(baseDir, "home");
  yield* fileSystem.makeDirectory(path.join(home, ".claude"), { recursive: true });
  const sent = yield* Queue.unbounded<ThreadManagement.ThreadManagementSendInput>();
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const threads = new Map<ThreadId, FakeThread>();
  const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];
  const bootstraps: Array<ProjectService.ProjectBootstrapInput> = [];
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  let backingProjectId: ProjectId | null = null;
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}:${++counter}`;

  const addThread = (
    title: string,
    relationshipToParent: FakeThread["relationshipToParent"] = null,
  ) => {
    const threadId = ThreadId.make(nextId("thread"));
    threads.set(threadId, {
      projectId: backingProjectId ?? ProjectId.make("project:repo"),
      title,
      relationshipToParent,
      status: "idle",
      messages: [],
      pullRequestUrl: null,
    });
    return threadId;
  };

  const threadsLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: (threadId) =>
      Effect.sync(() => {
        const thread = threads.get(threadId);
        return thread === undefined
          ? null
          : ({
              id: threadId,
              projectId: thread.projectId,
              title: thread.title,
              status: thread.status,
              pendingRuntimeRequest: null,
              lineage: { relationshipToParent: thread.relationshipToParent },
            } as never);
      }),
    getThreadRecords: (threadId, _fields, filter) =>
      Effect.sync(() => {
        const thread = threads.get(threadId)!;
        const messageIds = filter?.messageIds;
        return {
          thread: {
            title: thread.title,
            linkedPullRequest:
              thread.pullRequestUrl === null ? null : { url: thread.pullRequestUrl },
          },
          messages:
            messageIds === undefined
              ? thread.messages
              : thread.messages.filter((candidate) => messageIds.includes(candidate.id)),
          turnItems: [],
          runtimeRequests: [],
        } as never;
      }),
    sendToThread: (input) =>
      Effect.gen(function* () {
        const runId = RunId.make(nextId("run"));
        threads.get(input.threadId)?.messages.push(
          message({
            id: input.messageId,
            threadId: input.threadId,
            runId,
            role: "user",
            text: input.text,
            createdBy: input.createdBy,
            senderThreadId: input.senderThreadId,
          }),
        );
        yield* Queue.offer(sent, input);
        return { run: { id: runId } } as never;
      }),
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);
        return {} as never;
      }),
    streamDomainEvents: Stream.fromQueue(events),
  });

  const launchLayer = Layer.mock(ThreadLaunch.ThreadLaunchService)({
    launch: (input) =>
      Effect.sync(() => {
        launches.push(input);
        return { threadId: addThread(input.title), projection: {} as never, resumed: false };
      }),
  });

  const projectsLayer = Layer.mock(ProjectService.ProjectService)({
    bootstrap: (input) =>
      Effect.sync(() => {
        bootstraps.push(input);
        backingProjectId ??= input.projectId;
        return { project: { id: backingProjectId }, created: true } as never;
      }),
    getByWorkspaceRoot: () =>
      Effect.sync(() =>
        backingProjectId === null ? Option.none() : Option.some({ id: backingProjectId } as never),
      ),
  });

  const layer = BotService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        BotStore.layerMemory,
        BotFolders.layer.pipe(
          Layer.provide(ServerConfig.layerTest(baseDir, baseDir)),
          Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
        ),
        projectsLayer,
        launchLayer,
        threadsLayer,
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

  /** Events are handled in order, so once this sentinel's wake arrives every earlier event is done. */
  const flushReactor = (bot: BotRecord) =>
    Effect.gen(function* () {
      const codingThreadId = addThread("Sentinel");
      const runId = RunId.make(nextId("run"));
      yield* Queue.offer(
        events,
        messageUpdated(
          message({
            id: nextId("message"),
            threadId: codingThreadId,
            runId,
            role: "user",
            text: "Sentinel",
            createdBy: "agent",
            senderThreadId: bot.threadId,
          }),
        ),
      );
      yield* Queue.offer(events, runUpdated(codingThreadId, runId, "completed"));
      const wake = yield* Queue.take(sent);
      assert.strictEqual(wake.threadId, bot.threadId);
      assert.include(wake.text, `(${codingThreadId})`);
    });

  return {
    baseDir,
    home,
    sent,
    events,
    threads,
    launches,
    bootstraps,
    dispatched,
    addThread,
    nextId,
    flushReactor,
    layer,
  };
});

type Harness = Effect.Success<typeof makeHarness>;

const withBots = <A, E>(
  body: (
    harness: Harness,
    bots: BotService.BotService["Service"],
    store: BotStore.BotStore["Service"],
  ) => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    return yield* Effect.gen(function* () {
      return yield* body(harness, yield* BotService.BotService, yield* BotStore.BotStore);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  }).pipe(Effect.provide(NodeServices.layer));

const readBot = (store: BotStore.BotStore["Service"], bot: BotRecord) =>
  store.get(bot.id).pipe(Effect.map(Option.getOrThrow));

const exchangeStatus = (store: BotStore.BotStore["Service"], bot: BotRecord, exchangeId: string) =>
  store
    .listExchangesForBot(bot.id)
    .pipe(
      Effect.map((exchanges) => exchanges.find((exchange) => exchange.id === exchangeId)?.status),
    );

it.effect("creates bots with unique slugs, one primary, an idle thread and seeded documents", () =>
  withBots((harness, bots) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const updates = yield* bots.subscribeList({}).pipe(Stream.toQueue({ capacity: "unbounded" }));
      assert.deepStrictEqual(yield* Queue.take(updates), {
        bots: [],
        availableMcpServers: [],
        backingProjectId: null,
        codingThreads: [],
      });

      const engineer = (yield* bots.create({
        name: "Engineer",
        modelSelection,
        role: "Ships code",
      })).bot;
      assert.strictEqual(engineer.slug, "engineer");
      assert.isTrue(engineer.isPrimary);
      assert.deepStrictEqual(engineer.tools, [
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash",
        "WebSearch",
        "WebFetch",
      ]);
      assert.strictEqual(engineer.runtimeMode, "full-access");
      assert.strictEqual(engineer.systemPromptMode, "custom");
      assert.strictEqual(engineer.folderPath, path.join(harness.baseDir, "bots", "engineer"));
      const afterCreate = yield* Queue.take(updates);
      assert.lengthOf(afterCreate.bots, 1);
      assert.isNotNull(afterCreate.backingProjectId);
      assert.strictEqual(afterCreate.backingProjectId, yield* bots.backingProjectId);

      assert.deepStrictEqual(
        harness.bootstraps.map(({ title, workspaceRoot }) => ({ title, workspaceRoot })),
        [{ title: "Bots", workspaceRoot: path.join(harness.baseDir, "bots") }],
      );
      const [launch] = harness.launches;
      assert.deepStrictEqual(launch?.workspaceStrategy, {
        type: "existing_worktree",
        worktreePath: engineer.folderPath,
      });
      assert.isUndefined(launch?.initialMessage);
      assert.strictEqual(launch?.projectId, yield* bots.backingProjectId);

      const second = (yield* bots.create({ name: "Engineer", modelSelection })).bot;
      assert.strictEqual(second.slug, "engineer-2");
      assert.isFalse(second.isPrimary);

      const conflict = yield* bots
        .create({ name: "Other", slug: BotSlug.make("engineer"), modelSelection })
        .pipe(Effect.flip);
      assert.strictEqual(conflict.code, "slug_conflict");

      const writer = yield* bots.create({
        name: "Writer",
        modelSelection,
        isPrimary: true,
        documents: { soul: "I write release notes." },
      });
      assert.strictEqual(writer.documents.soul, "I write release notes.");
      assert.include(writer.documents.memory, "# Memory");
      const roster = yield* bots.list({});
      assert.deepStrictEqual(
        roster.bots.map(({ bot, status }) => [bot.slug, bot.isPrimary, status]),
        [
          ["engineer", false, "idle"],
          ["engineer-2", false, "idle"],
          ["writer", true, "idle"],
        ],
      );

      harness.threads.get(engineer.threadId)!.status = "running";
      harness.threads.get(second.threadId)!.status = "failed";
      assert.deepStrictEqual(
        (yield* bots.list({})).bots.map(({ status }) => status),
        ["working", "error", "idle"],
      );

      const engineerFolder = engineer.folderPath;
      assert.include(
        yield* fileSystem.readFileString(path.join(engineerFolder, "SOUL.md")),
        "Ships code",
      );
      assert.include(
        yield* fileSystem.readFileString(path.join(engineerFolder, "AGENTS.md")),
        "`SOUL.md`",
      );
      assert.isTrue(yield* fileSystem.exists(path.join(harness.baseDir, "bots", "_shared")));
    }),
  ),
);

it.effect(
  "updates a bot and its thread, archives it, and deletes it while keeping its folder",
  () =>
    withBots((harness, bots) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const scout = (yield* bots.create({ name: "Scout", modelSelection })).bot;
        const planner = (yield* bots.create({ name: "Planner", modelSelection })).bot;

        const updated = yield* bots.update({
          botId: scout.id,
          name: "Researcher",
          runtimeMode: "approval-required",
          documents: { memory: "# Memory\n\n- Prefers primary sources." },
          muted: true,
        });
        assert.strictEqual(updated.bot.name, "Researcher");
        assert.strictEqual(updated.bot.slug, "researcher");
        assert.strictEqual(
          updated.bot.folderPath,
          path.join(harness.baseDir, "bots", "researcher"),
        );
        assert.isFalse(yield* fileSystem.exists(scout.folderPath));
        assert.isTrue(yield* fileSystem.exists(updated.bot.folderPath));
        assert.isTrue(updated.bot.muted);
        assert.include(updated.documents.memory, "Prefers primary sources.");
        assert.include(
          yield* fileSystem.readFileString(path.join(updated.bot.folderPath, "AGENTS.md")),
          "Researcher",
        );
        assert.deepStrictEqual(
          harness.dispatched.map((command) => [
            command.type,
            "threadId" in command ? command.threadId : null,
          ]),
          [
            ["thread.metadata.update", scout.threadId],
            ["thread.runtime-mode.set", scout.threadId],
          ],
        );
        assert.deepInclude(harness.dispatched[0], {
          type: "thread.metadata.update",
          title: "Researcher",
          worktreePath: updated.bot.folderPath,
        });

        yield* bots.update({ botId: planner.id, isPrimary: true });
        assert.deepStrictEqual(
          (yield* bots.list({})).bots.map(({ bot }) => [bot.slug, bot.isPrimary]),
          [
            ["researcher", false],
            ["planner", true],
          ],
        );

        const archived = yield* bots.update({ botId: scout.id, archived: true });
        assert.isNotNull(archived.bot.archivedAt);
        assert.deepStrictEqual(
          (yield* bots.list({})).bots.map(({ bot }) => bot.slug),
          ["planner"],
        );
        assert.lengthOf((yield* bots.list({ includeArchived: true })).bots, 2);
        assert.isNull((yield* bots.update({ botId: scout.id, archived: false })).bot.archivedAt);

        assert.deepStrictEqual(yield* bots.delete({ botId: scout.id }), { botId: scout.id });
        assert.deepStrictEqual(harness.dispatched.at(-1), {
          type: "thread.archive",
          commandId: harness.dispatched.at(-1)!.commandId,
          threadId: scout.threadId,
        });
        assert.strictEqual(
          (yield* bots.get({ botId: scout.id }).pipe(Effect.flip)).code,
          "bot_not_found",
        );
        assert.isTrue(yield* fileSystem.exists(path.join(updated.bot.folderPath, "MEMORY.md")));
      }),
    ),
);

it.effect(
  "renames a bot slug explicitly, avoids disk and roster collisions, and refuses while active",
  () =>
    withBots((harness, bots) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const chief = (yield* bots.create({ name: "Chief of Staff", modelSelection })).bot;
        const designer = (yield* bots.create({ name: "Design", modelSelection })).bot;
        const deleted = (yield* bots.create({ name: "Legacy", modelSelection })).bot;
        yield* bots.delete({ botId: deleted.id });

        // Explicit slug update moves the folder and updates the thread worktreePath.
        const renamed = (yield* bots.update({ botId: chief.id, slug: BotSlug.make("kelsier") }))
          .bot;
        assert.strictEqual(renamed.slug, "kelsier");
        assert.strictEqual(renamed.folderPath, path.join(harness.baseDir, "bots", "kelsier"));
        assert.isFalse(yield* fileSystem.exists(chief.folderPath));
        assert.isTrue(yield* fileSystem.exists(renamed.folderPath));
        assert.deepInclude(harness.dispatched.at(-1), {
          type: "thread.metadata.update",
          threadId: chief.threadId,
          worktreePath: renamed.folderPath,
        });

        // Explicit slug conflicts with another bot or an orphaned folder on disk.
        const dbConflict = yield* bots
          .update({ botId: designer.id, slug: BotSlug.make("kelsier") })
          .pipe(Effect.flip);
        assert.strictEqual(dbConflict.code, "slug_conflict");
        const diskConflict = yield* bots
          .update({ botId: designer.id, slug: BotSlug.make("legacy") })
          .pipe(Effect.flip);
        assert.strictEqual(diskConflict.code, "slug_conflict");
        assert.isTrue(yield* fileSystem.exists(designer.folderPath));

        // Auto-derived slug on rename skips an existing folder left on disk.
        const skippedDisk = (yield* bots.update({ botId: designer.id, name: "Legacy" })).bot;
        assert.strictEqual(skippedDisk.slug, "legacy-2");
        assert.isTrue(yield* fileSystem.exists(deleted.folderPath));
        assert.isTrue(yield* fileSystem.exists(skippedDisk.folderPath));

        // Active turns block slug changes, while metadata-only updates still succeed.
        harness.threads.get(renamed.threadId)!.status = "running";
        const busyError = yield* bots
          .update({ botId: renamed.id, name: "Survivor" })
          .pipe(Effect.flip);
        assert.strictEqual(busyError.code, "invalid_request");
        const roleUpdated = (yield* bots.update({ botId: renamed.id, role: "Chief of Staff" })).bot;
        assert.strictEqual(roleUpdated.role, "Chief of Staff");
        assert.strictEqual(roleUpdated.slug, "kelsier");
      }),
    ),
);

it.effect(
  "builds a harness profile only for bot threads, with the bot's tools, MCP servers and auth",
  () =>
    withBots((harness, bots) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.writeFileString(
          path.join(harness.home, ".claude.json"),
          JSON.stringify({
            projects: { "/repo": { allowedTools: [] } },
            mcpServers: {
              github: {
                command: "github-mcp",
                args: ["serve"],
                env: { GITHUB_TOKEN: "secret-token" },
              },
              linear: {
                type: "http",
                url: "https://mcp.linear.app",
                headers: { Authorization: "Bearer secret-header" },
              },
              broken: { type: "stdio" },
            },
          }),
        );
        yield* fileSystem.writeFileString(
          path.join(harness.home, ".claude", "settings.json"),
          JSON.stringify({
            apiKeyHelper: "/usr/local/bin/anthropic-key",
            env: { ANTHROPIC_BASE_URL: "https://gateway.example.com" },
          }),
        );
        const engineer = (yield* bots.create({
          name: "Engineer",
          role: "Ships code",
          modelSelection,
          tools: ["Read", "Bash"],
          mcpServerNames: ["github", "linear"],
          customMcpServers: { linear: { type: "sse", url: "https://linear.internal/sse" } },
          documents: { soul: "I ship small PRs.", memory: "- The repo uses vp." },
        })).bot;
        yield* bots.create({ name: "Reviewer", role: "Reviews PRs", modelSelection });

        const available = (yield* bots.list({})).availableMcpServers;
        assert.deepStrictEqual(available, [
          { name: "github", transport: "stdio" },
          { name: "linear", transport: "http" },
        ]);
        assert.notInclude(JSON.stringify(available), "secret");

        assert.isTrue(
          Option.isNone(yield* bots.resolveHarnessProfile(harness.addThread("Repo work"))),
        );

        const profile = Option.getOrThrow(yield* bots.resolveHarnessProfile(engineer.threadId));
        assert.strictEqual(profile.botId, engineer.id);
        assert.strictEqual(profile.systemPromptMode, "custom");
        assert.deepStrictEqual(profile.tools, ["Read", "Bash"]);
        assert.deepStrictEqual(profile.mcpServers, {
          github: {
            type: "stdio",
            command: "github-mcp",
            args: ["serve"],
            env: { GITHUB_TOKEN: "secret-token" },
          },
          linear: { type: "sse", url: "https://linear.internal/sse" },
        });
        assert.deepStrictEqual(profile.authSettings, {
          apiKeyHelper: "/usr/local/bin/anthropic-key",
          anthropicBaseUrl: "https://gateway.example.com",
        });
        assert.deepStrictEqual(profile.additionalDirectories, [
          path.join(harness.baseDir, "bots", "_shared"),
        ]);
        assert.include(profile.staticInstructions, "bot_message");
        assert.include(profile.staticInstructions, "[From Bot: ...]");
        assert.include(profile.staticInstructions, "t3_thread_launch");
        assert.include(profile.dynamicContext, `- Folder: ${engineer.folderPath}`);
        assert.include(profile.dynamicContext, "I ship small PRs.");
        assert.include(profile.dynamicContext, "- The repo uses vp.");
        assert.include(
          profile.dynamicContext,
          "| engineer (you, primary) | Engineer | Ships code |",
        );
        assert.include(profile.dynamicContext, "| reviewer | Reviewer | Reviews PRs |");
      }),
    ),
);

it.effect(
  "frames peer messages, counts hops, refuses the seventh hop, and resets on a human message",
  () =>
    withBots((harness, bots, store) =>
      Effect.gen(function* () {
        yield* bots.startReactor();
        const alpha = (yield* bots.create({ name: "Alpha", modelSelection })).bot;
        const beta = (yield* bots.create({ name: "Beta", modelSelection })).bot;
        const send = (from: BotRecord, to: BotRecord, text: string) =>
          bots
            .sendMessage({ fromBotId: from.id, to: to.slug, message: text })
            .pipe(Effect.zip(Queue.take(harness.sent)));

        const [first, delivered] = yield* send(alpha, beta, "Review the plan.");
        assert.strictEqual(delivered.threadId, beta.threadId);
        assert.strictEqual(delivered.mode, "queue");
        assert.strictEqual(delivered.senderThreadId, alpha.threadId);
        assert.strictEqual(delivered.createdBy, "agent");
        assert.strictEqual(delivered.creationSource, "mcp");
        assert.strictEqual(
          delivered.text,
          '[From Bot: Alpha (alpha), hop 1/6. Peer-bot message, not direct user input. Reply with bot_message(to="alpha", ...) when done.]\n\nReview the plan.',
        );
        assert.strictEqual(first.exchange.status, "pending");
        assert.isNotNull(first.exchange.targetRunId);
        assert.strictEqual((yield* readBot(store, beta)).hopCount, 1);

        for (const [from, to] of [
          [beta, alpha],
          [alpha, beta],
          [beta, alpha],
          [alpha, beta],
          [beta, alpha],
        ] as const) {
          yield* send(from, to, "Next step.");
        }
        assert.strictEqual((yield* readBot(store, alpha)).hopCount, 6);
        const refused = yield* bots
          .sendMessage({ fromBotId: alpha.id, to: beta.slug, message: "One more." })
          .pipe(Effect.flip);
        assert.strictEqual(refused.code, "hop_limit_reached");

        assert.strictEqual(
          (yield* bots
            .sendMessage({ fromBotId: alpha.id, to: alpha.slug, message: "Hi me." })
            .pipe(Effect.flip)).code,
          "invalid_request",
        );
        assert.strictEqual(
          (yield* bots
            .sendMessage({ fromBotId: alpha.id, to: BotSlug.make("nobody"), message: "Hi." })
            .pipe(Effect.flip)).code,
          "bot_not_found",
        );

        yield* Queue.offer(
          harness.events,
          messageUpdated(
            message({
              id: harness.nextId("message"),
              threadId: alpha.threadId,
              runId: RunId.make(harness.nextId("run")),
              role: "user",
              text: "Keep going.",
              createdBy: "user",
            }),
          ),
        );
        yield* harness.flushReactor(alpha);
        assert.strictEqual((yield* readBot(store, alpha)).hopCount, 0);
        const [, resumed] = yield* send(alpha, beta, "Fresh start.");
        assert.include(resumed.text, "hop 1/6");
      }),
    ),
);

it.effect("wakes the sender once when the peer's run ends", () =>
  withBots((harness, bots, store) =>
    Effect.gen(function* () {
      yield* bots.startReactor();
      const alpha = (yield* bots.create({ name: "Alpha", modelSelection })).bot;
      const beta = (yield* bots.create({ name: "Beta", modelSelection })).bot;
      const { exchange } = yield* bots.sendMessage({
        fromBotId: alpha.id,
        to: beta.slug,
        message: "Review the plan.",
      });
      yield* Queue.take(harness.sent);
      const runId = exchange.targetRunId!;
      harness.threads.get(beta.threadId)!.messages.push(
        message({
          id: harness.nextId("message"),
          threadId: beta.threadId,
          runId,
          role: "assistant",
          text: "LGTM, ship it.",
          createdBy: "agent",
        }),
      );

      yield* Queue.offer(harness.events, runUpdated(beta.threadId, runId, "completed"));
      const wake = yield* Queue.take(harness.sent);
      assert.strictEqual(wake.threadId, alpha.threadId);
      assert.strictEqual(wake.mode, "queue");
      assert.strictEqual(wake.senderThreadId, beta.threadId);
      assert.strictEqual(
        wake.text,
        "[Bot reply from Beta (beta), status: completed]\n\nLGTM, ship it.",
      );
      assert.strictEqual(yield* exchangeStatus(store, alpha, exchange.id), "woken");
      assert.strictEqual((yield* readBot(store, alpha)).hopCount, 2);

      yield* Queue.offer(harness.events, runUpdated(beta.threadId, runId, "completed"));
      yield* harness.flushReactor(alpha);
    }),
  ),
);

it.effect("skips the wake when the peer already replied with bot_message", () =>
  withBots((harness, bots, store) =>
    Effect.gen(function* () {
      yield* bots.startReactor();
      const alpha = (yield* bots.create({ name: "Alpha", modelSelection })).bot;
      const beta = (yield* bots.create({ name: "Beta", modelSelection })).bot;
      const { exchange } = yield* bots.sendMessage({
        fromBotId: alpha.id,
        to: beta.slug,
        message: "Review the plan.",
      });
      yield* Queue.take(harness.sent);
      yield* bots.sendMessage({ fromBotId: beta.id, to: alpha.slug, message: "Looks good." });
      yield* Queue.take(harness.sent);
      assert.strictEqual(yield* exchangeStatus(store, alpha, exchange.id), "replied");

      yield* Queue.offer(
        harness.events,
        runUpdated(beta.threadId, exchange.targetRunId!, "completed"),
      );
      yield* harness.flushReactor(alpha);
      assert.strictEqual(yield* exchangeStatus(store, alpha, exchange.id), "replied");
    }),
  ),
);

it.effect(
  "wakes the bot that launched a coding thread when that thread finishes or fails, and streams its latest status",
  () =>
    withBots((harness, bots, store) =>
      Effect.gen(function* () {
        yield* bots.startReactor();
        const engineer = (yield* bots.create({ name: "Engineer", modelSelection })).bot;
        const updates = yield* bots
          .subscribeList({})
          .pipe(Stream.toQueue({ capacity: "unbounded" }));
        const nextLinks = (
          until: (links: BotListResult["codingThreads"]) => boolean,
        ): Effect.Effect<ReadonlyArray<readonly [BotId, ThreadId, BotExchangeStatus]>> =>
          Queue.take(updates).pipe(
            Effect.orDie,
            Effect.map(({ codingThreads }) => codingThreads),
            Effect.repeat({ until }),
            Effect.map((links) =>
              links.map(({ botId, threadId, status }) => [botId, threadId, status] as const),
            ),
          );
        const messageCodingThread = (threadId: ThreadId) =>
          Effect.gen(function* () {
            const runId = RunId.make(harness.nextId("run"));
            const launched = messageUpdated(
              message({
                id: harness.nextId("message"),
                threadId,
                runId,
                role: "user",
                text: "Fix the login redirect.",
                createdBy: "agent",
                senderThreadId: engineer.threadId,
              }),
            );
            // message.updated repeats for one message; the watch must not.
            yield* Queue.offer(harness.events, launched);
            yield* Queue.offer(harness.events, launched);
            return { threadId, runId };
          });
        const launchCodingThread = (title: string) => messageCodingThread(harness.addThread(title));

        const fix = yield* launchCodingThread("Fix login");
        assert.deepStrictEqual(yield* nextLinks((links) => links.length > 0), [
          [engineer.id, fix.threadId, "pending"],
        ]);
        const fixThread = harness.threads.get(fix.threadId)!;
        fixThread.pullRequestUrl = "https://github.com/acme/app/pull/7";
        fixThread.messages.push(
          message({
            id: harness.nextId("message"),
            threadId: fix.threadId,
            runId: fix.runId,
            role: "assistant",
            text: "Fixed the redirect and opened a PR.",
            createdBy: "agent",
          }),
        );
        yield* Queue.offer(harness.events, runUpdated(fix.threadId, fix.runId, "completed"));
        const completed = yield* Queue.take(harness.sent);
        assert.strictEqual(completed.threadId, engineer.threadId);
        assert.strictEqual(completed.mode, "queue");
        assert.strictEqual(
          completed.text,
          `[Coding thread update: Fix login (${fix.threadId}), status: completed]\n\nFixed the redirect and opened a PR.\n\nPull request: https://github.com/acme/app/pull/7`,
        );
        assert.deepStrictEqual(yield* nextLinks((links) => links[0]?.status === "woken"), [
          [engineer.id, fix.threadId, "woken"],
        ]);

        const flaky = yield* launchCodingThread("Flaky test");
        yield* Queue.offer(harness.events, runUpdated(flaky.threadId, flaky.runId, "failed"));
        const failure = yield* Queue.take(harness.sent);
        assert.strictEqual(failure.threadId, engineer.threadId);
        assert.isTrue(
          failure.text.startsWith(
            `[Coding thread update: Flaky test (${flaky.threadId}), status: failed]`,
          ),
        );

        const rerun = yield* messageCodingThread(fix.threadId);
        assert.deepStrictEqual(yield* nextLinks((links) => links[0]?.threadId === fix.threadId), [
          [engineer.id, fix.threadId, "pending"],
          [engineer.id, flaky.threadId, "woken"],
        ]);
        yield* Queue.offer(harness.events, runUpdated(fix.threadId, rerun.runId, "completed"));
        yield* Queue.take(harness.sent);

        const exchanges = yield* store.listExchangesForBot(engineer.id);
        assert.deepStrictEqual(
          exchanges.map(({ kind, watchedThreadId, status }) => [kind, watchedThreadId, status]),
          [
            ["coding_thread", fix.threadId, "woken"],
            ["coding_thread", flaky.threadId, "woken"],
            ["coding_thread", fix.threadId, "woken"],
          ],
        );
        assert.deepStrictEqual(
          (yield* bots.list({})).codingThreads.map(({ threadId, status }) => [threadId, status]),
          [
            [fix.threadId, "woken"],
            [flaky.threadId, "woken"],
          ],
        );

        yield* bots.update({ botId: engineer.id, archived: true });
        assert.lengthOf((yield* bots.list({})).codingThreads, 0);
        assert.lengthOf((yield* bots.list({ includeArchived: true })).codingThreads, 2);
      }),
    ),
);

it.effect("leaves a delegate_task child to wake its parent itself", () =>
  withBots((harness, bots, store) =>
    Effect.gen(function* () {
      yield* bots.startReactor();
      const engineer = (yield* bots.create({ name: "Engineer", modelSelection })).bot;
      const childThreadId = harness.addThread("Delegated fix", "subagent");
      const runId = RunId.make(harness.nextId("run"));
      yield* Queue.offer(
        harness.events,
        messageUpdated(
          message({
            id: harness.nextId("message"),
            threadId: childThreadId,
            runId,
            role: "user",
            text: "Fix the login redirect.",
            createdBy: "agent",
            senderThreadId: engineer.threadId,
          }),
        ),
      );
      yield* Queue.offer(harness.events, runUpdated(childThreadId, runId, "completed"));
      yield* harness.flushReactor(engineer);

      const exchanges = yield* store.listExchangesForBot(engineer.id);
      assert.notInclude(
        exchanges.map(({ watchedThreadId }) => watchedThreadId),
        childThreadId,
      );
    }),
  ),
);

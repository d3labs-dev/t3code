import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  BotExchangeId,
  BotSlug,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as BotFolders from "../../../bots/BotFolders.ts";
import * as BotService from "../../../bots/BotService.ts";
import * as BotStore from "../../../bots/BotStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as BotsHandlers from "./handlers.ts";
import { BotsToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:bots");
const userThreadId = ThreadId.make("thread:user");
const botModel: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-haiku-4-5",
};

const asCaller = (threadId: ThreadId) =>
  Effect.provideService(McpInvocationContext.McpInvocationContext, {
    environmentId,
    requestNamespace: "provider:bots",
    thread: {
      threadId,
      providerSessionId: "provider:bots",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
    capabilities: new Set(["orchestration" as const]),
    issuedAt: 0,
  });

const lastResult = <A, E1, R1, E2, R2>(
  handled: Effect.Effect<Stream.Stream<{ readonly result: A }, E2, R2>, E1, R1>,
) =>
  handled.pipe(
    Stream.unwrap,
    Stream.runCollect,
    Effect.map((results) => results.at(-1)?.result),
  );

const withBotTools = <A, E>(
  body: (input: {
    readonly toolkit: Effect.Success<typeof BotsToolkit>;
    readonly bots: BotService.BotService["Service"];
    readonly store: BotStore.BotStore["Service"];
    readonly sent: ReadonlyArray<ThreadManagement.ThreadManagementSendInput>;
  }) => Effect.Effect<A, E, BotService.BotService | ThreadManagement.ThreadManagementService>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bot-tools-" });
    const sent: Array<ThreadManagement.ThreadManagementSendInput> = [];
    let backingProjectId: ProjectId | null = null;
    const dependencies = BotService.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          BotStore.layerMemory,
          BotFolders.layer.pipe(
            Layer.provide(ServerConfig.layerTest(baseDir, baseDir)),
            Layer.provide(Layer.succeed(HostProcess.HomeDirectory, baseDir)),
          ),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
            sendToThread: (input) =>
              Effect.sync(() => {
                sent.push(input);
                return { run: { id: RunId.make(`run:${sent.length}`) } } as never;
              }),
          }),
          Layer.mock(ThreadSearch.ThreadSearch)({
            searchThreadMessages: ({ threadIds, query }) =>
              Effect.succeed({
                matches: threadIds.map((threadId) => ({
                  messageId: MessageId.make(`message:${threadId}`),
                  threadId,
                  source: "assistant" as const,
                  createdBy: "agent" as const,
                  snippet: query,
                  messageCreatedAt: null,
                  quality: 1,
                })),
              }),
          }),
          Layer.mock(ThreadLaunch.ThreadLaunchService)({
            launch: (input) =>
              Effect.succeed({
                threadId: ThreadId.make(`thread:bot:${input.title}`),
                projection: {} as never,
                resumed: false,
              }),
          }),
          Layer.mock(ProjectService.ProjectService)({
            bootstrap: (input) =>
              Effect.sync(() => {
                backingProjectId ??= input.projectId;
                return { project: { id: backingProjectId }, created: true } as never;
              }),
            getByWorkspaceRoot: () =>
              Effect.succeed(
                backingProjectId === null
                  ? Option.none()
                  : Option.some({ id: backingProjectId } as never),
              ),
          }),
        ),
      ),
    );
    return yield* Effect.gen(function* () {
      return yield* body({
        toolkit: yield* BotsToolkit,
        bots: yield* BotService.BotService,
        store: yield* BotStore.BotStore,
        sent,
      });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(BotsHandlers.layer).pipe(
          Layer.provideMerge(dependencies),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("creates a Bot on the calling thread's model, lists it, and updates it by slug", () =>
  withBotTools(({ toolkit, bots }) =>
    Effect.gen(function* () {
      const created = yield* toolkit
        .handle("bot_create", { name: "Scout", soul: "I cite primary sources." })
        .pipe(lastResult, asCaller(userThreadId));
      const scout = Option.getOrThrow(yield* bots.getBySlug(BotSlug.make("scout")));
      expect(created).toMatchObject({ botId: scout.id, threadId: "thread:bot:Scout" });
      expect(scout.modelSelection).toEqual(liveThreadShell(userThreadId).modelSelection);
      expect((yield* bots.get({ botId: scout.id })).documents.soul).toBe("I cite primary sources.");

      expect(
        yield* toolkit.handle("bot_list", {}).pipe(lastResult, asCaller(userThreadId)),
      ).toEqual({
        bots: [
          expect.objectContaining({
            slug: "scout",
            name: "Scout",
            isPrimary: true,
            threadId: "thread:bot:Scout",
            link: expect.stringContaining("thread:bot:Scout"),
          }),
        ],
      });

      expect(
        yield* toolkit
          .handle("bot_update", { slug: "scout", role: "Checks sources", muted: true })
          .pipe(lastResult, asCaller(userThreadId)),
      ).toMatchObject({ botId: scout.id, slug: "scout" });
      expect((yield* bots.get({ botId: scout.id })).bot).toMatchObject({
        role: "Checks sources",
        muted: true,
      });
      expect(
        yield* toolkit
          .handle("bot_update", { slug: "nobody", muted: true })
          .pipe(lastResult, asCaller(userThreadId)),
      ).toMatchObject({ code: "invalid_request" });
    }),
  ),
);

it.effect("sends bot_message only as the calling Bot and reports the hop limit", () =>
  withBotTools(({ toolkit, bots, store, sent }) =>
    Effect.gen(function* () {
      const alpha = (yield* bots.create({ name: "Alpha", modelSelection: botModel })).bot;
      const beta = (yield* bots.create({ name: "Beta", modelSelection: botModel })).bot;

      expect(
        yield* toolkit
          .handle("bot_message", { to: "beta", message: "Review the plan." })
          .pipe(lastResult, asCaller(userThreadId)),
      ).toMatchObject({ code: "invalid_request" });
      expect(sent).toHaveLength(0);

      expect(
        yield* toolkit
          .handle("bot_message", { to: "beta", message: "Review the plan." })
          .pipe(lastResult, asCaller(alpha.threadId)),
      ).toMatchObject({
        targetBotId: beta.id,
        targetSlug: "beta",
        targetThreadId: beta.threadId,
        runId: "run:1",
        hopCount: 1,
      });
      expect(sent.map(({ threadId, senderThreadId }) => ({ threadId, senderThreadId }))).toEqual([
        { threadId: beta.threadId, senderThreadId: alpha.threadId },
      ]);

      yield* store.updateHopCount({ botId: alpha.id, hopCount: 6 });
      const refused = yield* toolkit
        .handle("bot_message", { to: "beta", message: "One more." })
        .pipe(lastResult, asCaller(alpha.threadId));
      expect(refused).toMatchObject({ code: "invalid_request" });
      expect(refused).toHaveProperty("message", expect.stringContaining("without a human message"));
      expect(sent).toHaveLength(1);
    }),
  ),
);

it.effect("searches a Bot's own thread and the coding threads it messaged, only from a Bot", () =>
  withBotTools(({ toolkit, bots, store }) =>
    Effect.gen(function* () {
      const scout = (yield* bots.create({ name: "Scout", modelSelection: botModel })).bot;
      const codingThreadId = ThreadId.make("thread:coding");
      yield* store.insertExchange({
        id: BotExchangeId.make("exchange:coding"),
        kind: "coding_thread",
        fromBotId: scout.id,
        toBotId: null,
        watchedThreadId: codingThreadId,
        targetRunId: RunId.make("run:coding"),
        hopCount: 0,
        expectReply: true,
        status: "pending",
        summary: null,
        createdAt: "2026-11-26T00:00:00.000Z",
        resolvedAt: null,
      });
      const search = (input: { readonly includeCodingThreads?: boolean }, caller: ThreadId) =>
        toolkit
          .handle("bot_search_history", { query: "release plan", ...input })
          .pipe(lastResult, asCaller(caller));

      expect(yield* search({}, scout.threadId)).toEqual({
        matches: [
          expect.objectContaining({
            threadId: scout.threadId,
            isBotThread: true,
            link: expect.stringContaining(scout.threadId),
          }),
          expect.objectContaining({
            threadId: codingThreadId,
            isBotThread: false,
            link: expect.stringContaining(codingThreadId),
          }),
        ],
      });
      expect(yield* search({ includeCodingThreads: false }, scout.threadId)).toEqual({
        matches: [expect.objectContaining({ threadId: scout.threadId, isBotThread: true })],
      });
      expect(yield* search({}, userThreadId)).toMatchObject({ code: "invalid_request" });
    }),
  ),
);

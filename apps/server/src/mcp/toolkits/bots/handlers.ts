import {
  type BotError,
  type BotId,
  type BotRecord,
  type BotSlug,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as BotService from "../../../bots/BotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { BotsToolkit } from "./tools.ts";

const toMcpFailure = (error: BotError) =>
  new OrchestratorMcpFailure({
    code: error.code === "operation_failed" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

const invalidRequest = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const documentsPatch = (soul: string | undefined, memory: string | undefined) => ({
  ...(soul === undefined ? {} : { soul }),
  ...(memory === undefined ? {} : { memory }),
});

const savedBot = (scope: McpInvocationContext.McpInvocationScope, bot: BotRecord) => ({
  botId: bot.id,
  slug: bot.slug,
  name: bot.name,
  threadId: bot.threadId,
  link: McpInvocationContext.threadLinkFor(scope, bot.threadId, bot.name),
});

const findBotId = Effect.fn("mcp.findBotId")(function* (
  botId: BotId | undefined,
  slug: BotSlug | undefined,
) {
  if (botId !== undefined) return botId;
  if (slug === undefined) return yield* invalidRequest("Pass botId or slug.");
  const bots = yield* BotService.BotService;
  const bot = yield* bots.getBySlug(slug).pipe(Effect.mapError(toMcpFailure));
  if (Option.isNone(bot)) return yield* invalidRequest(`No Bot has the slug "${slug}".`);
  return bot.value.id;
});

export const layer = McpToolAccess.toLayer(BotsToolkit, {
  bot_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { scope } = yield* readCaller();
      const bots = yield* BotService.BotService;
      const roster = yield* bots.list(input).pipe(Effect.mapError(toMcpFailure));
      return {
        bots: roster.bots.map(({ bot, status }) => ({
          id: bot.id,
          slug: bot.slug,
          name: bot.name,
          role: bot.role,
          groupName: bot.groupName,
          isPrimary: bot.isPrimary,
          threadId: bot.threadId,
          status,
          link: McpInvocationContext.threadLinkFor(scope, bot.threadId, bot.name),
        })),
      };
    }),
  ),
  bot_message: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const bots = yield* BotService.BotService;
      const sender =
        scope.thread === undefined
          ? Option.none<BotRecord>()
          : yield* bots.getByThreadId(scope.thread.threadId).pipe(Effect.mapError(toMcpFailure));
      if (Option.isNone(sender)) {
        return yield* invalidRequest("Only a Bot's own thread can send bot_message.");
      }
      const { exchange } = yield* bots
        .sendMessage({ ...input, fromBotId: sender.value.id })
        .pipe(Effect.mapError(toMcpFailure));
      return {
        exchangeId: exchange.id,
        targetBotId: exchange.toBotId,
        targetSlug: input.to,
        targetThreadId: exchange.watchedThreadId,
        link: McpInvocationContext.threadLinkFor(scope, exchange.watchedThreadId),
        runId: exchange.targetRunId,
        hopCount: exchange.hopCount,
      };
    }),
  ),
  bot_create: McpToolAccess.writesEnvironment(({ soul, memory, ...input }, check) =>
    Effect.gen(function* () {
      const { scope, caller } = yield* check;
      const modelSelection = input.modelSelection ?? caller?.modelSelection;
      if (modelSelection === undefined) {
        return yield* invalidRequest("Pass modelSelection when calling outside a thread.");
      }
      const bots = yield* BotService.BotService;
      const { bot } = yield* bots
        .create({ ...input, modelSelection, documents: documentsPatch(soul, memory) })
        .pipe(Effect.mapError(toMcpFailure));
      return savedBot(scope, bot);
    }),
  ),
  bot_update: McpToolAccess.writesEnvironment(({ botId, slug, soul, memory, ...input }, check) =>
    Effect.gen(function* () {
      const { scope } = yield* check;
      const bots = yield* BotService.BotService;
      const { bot } = yield* bots
        .update({
          ...input,
          botId: yield* findBotId(botId, slug),
          documents: documentsPatch(soul, memory),
        })
        .pipe(Effect.mapError(toMcpFailure));
      return savedBot(scope, bot);
    }),
  ),
});

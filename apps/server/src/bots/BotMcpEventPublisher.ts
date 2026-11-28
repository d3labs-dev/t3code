import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as McpEventClient from "../scheduledTasks/McpEventClient.ts";
import { ScheduledTaskMcpEventPublisher } from "../scheduledTasks/ScheduledTaskService.ts";
import * as BotFolders from "./BotFolders.ts";
import * as BotStore from "./BotStore.ts";

const failed = (message: string) => new McpEventClient.McpEventRequestError({ message });

/** Event tasks subscribe at the MCP servers of the Bot whose thread they run in. */
export const layer = Layer.effect(
  ScheduledTaskMcpEventPublisher,
  Effect.gen(function* () {
    const store = yield* BotStore.BotStore;
    const folders = yield* BotFolders.BotFolders;
    return yield* McpEventClient.make(({ threadId, server }) =>
      Effect.gen(function* () {
        const bot = yield* store
          .findByThreadId(threadId)
          .pipe(Effect.mapError(() => failed("Could not read the Bot for this thread.")));
        if (Option.isNone(bot)) {
          return yield* failed("An MCP event task runs in a Bot's thread.");
        }
        if (bot.value.archivedAt !== null) {
          return yield* failed(`${bot.value.name} is archived.`);
        }
        const servers = yield* folders.resolveMcpServers(
          bot.value.mcpServerNames,
          bot.value.customMcpServers,
        );
        const config = Object.hasOwn(servers, server) ? servers[server] : undefined;
        if (config === undefined) {
          return yield* failed(`${bot.value.name} has no MCP server named "${server}".`);
        }
        if (config.type !== "http") {
          return yield* failed(
            `MCP server "${server}" uses ${config.type}; events need a streamable HTTP server.`,
          );
        }
        return { url: config.url, headers: config.headers ?? {} };
      }),
    );
  }),
);

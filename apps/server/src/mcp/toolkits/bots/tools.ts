import {
  BotCreateInput,
  BotDocumentsPatch,
  BotExchange,
  BotId,
  BotListInput,
  BotMessageInput,
  BotRecord,
  BotSlug,
  BotStatus,
  BotUpdateInput,
  clampedPositiveInt,
  IsoDateTime,
  MessageId,
  OrchestrationThreadSearchSource,
  OrchestratorMcpFailure,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as BotService from "../../../bots/BotService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    BotService.BotService,
  ],
};

// Custom MCP servers stay out: their configs carry credentials an agent should not write.
const botSettings = Struct.omit(BotUpdateInput.fields, [
  "botId",
  "slug",
  "customMcpServers",
  "documents",
]);

const BotSaved = Schema.Struct({
  botId: BotId,
  slug: BotSlug,
  name: BotRecord.fields.name,
  threadId: BotRecord.fields.threadId,
  link: Schema.String,
});

const BotListTool = Tool.make("bot_list", {
  ...shared,
  description:
    "List Bots: persistent agents with their own thread, folder, and memory. Message one with `bot_message`.",
  parameters: BotListInput,
  success: Schema.Struct({
    bots: Schema.Array(
      Schema.Struct({
        ...Struct.pick(BotRecord.fields, [
          "id",
          "slug",
          "name",
          "role",
          "groupName",
          "isPrimary",
          "threadId",
        ]),
        status: BotStatus,
        link: Schema.String,
      }),
    ),
  }),
})
  .annotate(Tool.Title, "List Bots")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const BotMessageTool = Tool.make("bot_message", {
  ...shared,
  description:
    "Message a peer Bot by slug, as this Bot. Only a Bot's thread can call it. Its reply arrives later as a new message here, so end your turn instead of waiting. `expectReply: false` skips that wake.",
  parameters: Schema.Struct(Struct.omit(BotMessageInput.fields, ["fromBotId"])),
  success: Schema.Struct({
    exchangeId: BotExchange.fields.id,
    targetBotId: BotExchange.fields.toBotId,
    targetSlug: BotSlug,
    targetThreadId: BotExchange.fields.watchedThreadId,
    link: Schema.String,
    runId: BotExchange.fields.targetRunId,
    hopCount: BotExchange.fields.hopCount,
  }),
})
  .annotate(Tool.Title, "Message a Bot")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const BotCreateTool = Tool.make("bot_create", {
  ...shared,
  description:
    "Create a Bot. Its thread starts idle until messaged. `modelSelection` defaults to this thread's. `soul`, `now` and `memory` seed its SOUL.md, NOW.md and MEMORY.md.",
  parameters: Schema.Struct({
    name: BotCreateInput.fields.name,
    slug: BotCreateInput.fields.slug,
    ...Struct.omit(botSettings, ["name", "muted", "archived"]),
    ...BotDocumentsPatch.fields,
  }),
  success: BotSaved,
})
  .annotate(Tool.Title, "Create a Bot")
  .annotate(Tool.Destructive, false);

const BotUpdateTool = Tool.make("bot_update", {
  ...shared,
  description:
    "Change a Bot found by `botId` or `slug`. Omitted fields stay. `soul`, `now` and `memory` replace its SOUL.md, NOW.md and MEMORY.md. `archived: true` hides it from the roster.",
  parameters: Schema.Struct({
    botId: Schema.optionalKey(BotId),
    slug: Schema.optionalKey(BotSlug),
    ...botSettings,
    ...BotDocumentsPatch.fields,
  }),
  success: BotSaved,
})
  .annotate(Tool.Title, "Update a Bot")
  .annotate(Tool.Destructive, true);

const BotSearchHistoryTool = Tool.make("bot_search_history", {
  ...shared,
  description: "Search this Bot's thread and the coding threads it messaged.",
  parameters: Schema.Struct({
    query: TrimmedNonEmptyString,
    limit: Schema.optionalKey(clampedPositiveInt(50)),
    includeCodingThreads: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    matches: Schema.Array(
      Schema.Struct({
        messageId: MessageId,
        threadId: ThreadId,
        isBotThread: Schema.Boolean,
        source: OrchestrationThreadSearchSource,
        createdBy: Schema.Literals(["user", "agent"]),
        snippet: Schema.String,
        messageCreatedAt: Schema.NullOr(IsoDateTime),
        link: Schema.String,
      }),
    ),
  }),
})
  .annotate(Tool.Title, "Search Bot history")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const BotsToolkit = Toolkit.make(
  BotListTool,
  BotMessageTool,
  BotCreateTool,
  BotUpdateTool,
  BotSearchHistoryTool,
);

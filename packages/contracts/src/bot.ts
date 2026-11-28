import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode } from "./providerPolicy.ts";

export const BotId = TrimmedNonEmptyString.pipe(Schema.brand("BotId"));
export type BotId = typeof BotId.Type;

export const BotExchangeId = TrimmedNonEmptyString.pipe(Schema.brand("BotExchangeId"));
export type BotExchangeId = typeof BotExchangeId.Type;

const BOT_SLUG_MAX_LENGTH = 40;
const BOT_FALLBACK_SLUG = "bot";

export const BotSlug = Schema.String.check(
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
).pipe(Schema.brand("BotSlug"));
export type BotSlug = typeof BotSlug.Type;

export function slugifyBotName(name: string): BotSlug {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, BOT_SLUG_MAX_LENGTH)
    .replace(/-$/, "");
  return BotSlug.make(slug || BOT_FALLBACK_SLUG);
}

export const BOT_MAX_HOPS = 6;
export const BOT_DEFAULT_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
] as const;
export const BOT_DEFAULT_ICON = "squircle";
export const BOT_DEFAULT_COLOR = "#6366f1";

const BotStringMap = Schema.Record(Schema.String, Schema.String);

export const BotMcpServerConfig = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.optionalKey(Schema.Array(Schema.String)),
    env: Schema.optionalKey(BotStringMap),
  }),
  Schema.Struct({
    type: Schema.Literal("http"),
    url: TrimmedNonEmptyString,
    headers: Schema.optionalKey(BotStringMap),
  }),
  Schema.Struct({
    type: Schema.Literal("sse"),
    url: TrimmedNonEmptyString,
    headers: Schema.optionalKey(BotStringMap),
  }),
]);
export type BotMcpServerConfig = typeof BotMcpServerConfig.Type;

const BotMcpServers = Schema.Record(TrimmedNonEmptyString, BotMcpServerConfig);
const BotNames = Schema.Array(TrimmedNonEmptyString);

export const BotSystemPromptMode = Schema.Literals(["custom", "preset"]);
export type BotSystemPromptMode = typeof BotSystemPromptMode.Type;

export const BotStatus = Schema.Literals(["idle", "working", "waiting", "error"]);
export type BotStatus = typeof BotStatus.Type;

export const BotExchangeKind = Schema.Literals(["bot_message", "coding_thread"]);
export type BotExchangeKind = typeof BotExchangeKind.Type;

export const BotExchangeStatus = Schema.Literals(["pending", "replied", "woken", "cancelled"]);
export type BotExchangeStatus = typeof BotExchangeStatus.Type;

const BotEditableFields = {
  name: TrimmedNonEmptyString,
  role: Schema.String,
  groupName: Schema.NullOr(TrimmedNonEmptyString),
  icon: TrimmedNonEmptyString,
  color: TrimmedNonEmptyString,
  isPrimary: Schema.Boolean,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  tools: BotNames,
  mcpServerNames: BotNames,
  customMcpServers: BotMcpServers,
  skills: BotNames,
  systemPromptMode: BotSystemPromptMode,
};

const BOT_CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const BotProactiveConfig = Schema.Struct({
  enabled: Schema.Boolean,
  intervalMinutes: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 1440 })),
  activeHoursStart: Schema.String.check(Schema.isPattern(BOT_CLOCK_TIME)),
  activeHoursEnd: Schema.String.check(Schema.isPattern(BOT_CLOCK_TIME)),
  timezone: TrimmedNonEmptyString,
});
export type BotProactiveConfig = typeof BotProactiveConfig.Type;

export const DEFAULT_BOT_PROACTIVE_CONFIG: BotProactiveConfig = {
  enabled: false,
  intervalMinutes: 30,
  activeHoursStart: "08:00",
  activeHoursEnd: "22:00",
  timezone: "UTC",
};

export const BotRecord = Schema.Struct({
  id: BotId,
  slug: BotSlug,
  ...BotEditableFields,
  proactive: BotProactiveConfig,
  muted: Schema.Boolean,
  threadId: ThreadId,
  folderPath: TrimmedNonEmptyString,
  hopCount: NonNegativeInt,
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BotRecord = typeof BotRecord.Type;

export const BotExchange = Schema.Struct({
  id: BotExchangeId,
  kind: BotExchangeKind,
  fromBotId: BotId,
  toBotId: Schema.NullOr(BotId),
  watchedThreadId: ThreadId,
  targetRunId: Schema.NullOr(RunId),
  hopCount: NonNegativeInt,
  expectReply: Schema.Boolean,
  status: BotExchangeStatus,
  summary: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type BotExchange = typeof BotExchange.Type;

export const BotHarnessProfile = Schema.Struct({
  botId: BotId,
  slug: BotSlug,
  name: TrimmedNonEmptyString,
  systemPromptMode: BotSystemPromptMode,
  staticInstructions: Schema.String,
  dynamicContext: Schema.String,
  tools: BotNames,
  mcpServers: BotMcpServers,
  skills: BotNames,
  additionalDirectories: BotNames,
  authSettings: Schema.optionalKey(
    Schema.Struct({
      apiKeyHelper: Schema.optionalKey(TrimmedNonEmptyString),
      anthropicBaseUrl: Schema.optionalKey(TrimmedNonEmptyString),
    }),
  ),
});
export type BotHarnessProfile = typeof BotHarnessProfile.Type;

export const BOT_NOW_SOFT_CAP_BYTES = 2_048;
export const BOT_MEMORY_SOFT_CAP_BYTES = 4_096;
export const BOT_HEARTBEAT_SOFT_CAP_BYTES = 2_048;

export const BotDocuments = Schema.Struct({
  soul: Schema.String,
  now: Schema.String,
  memory: Schema.String,
  heartbeat: Schema.String,
});
export type BotDocuments = typeof BotDocuments.Type;

export const BotAvailableMcpServer = Schema.Struct({
  name: TrimmedNonEmptyString,
  transport: Schema.Literals(["stdio", "http", "sse"]),
});
export type BotAvailableMcpServer = typeof BotAvailableMcpServer.Type;

export class BotError extends Schema.TaggedError<BotError>()("BotError", {
  code: Schema.Literals([
    "bot_not_found",
    "slug_conflict",
    "hop_limit_reached",
    "invalid_request",
    "operation_failed",
  ]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const BotRosterEntry = Schema.Struct({
  bot: BotRecord,
  status: BotStatus,
});
export type BotRosterEntry = typeof BotRosterEntry.Type;

export const BotListInput = Schema.Struct({
  includeArchived: Schema.optionalKey(Schema.Boolean),
});
export type BotListInput = typeof BotListInput.Type;

/** The latest exchange through which a Bot watches a coding thread it messaged. */
export const BotCodingThreadLink = Schema.Struct({
  botId: BotId,
  threadId: ThreadId,
  status: BotExchangeStatus,
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type BotCodingThreadLink = typeof BotCodingThreadLink.Type;

export const BotListResult = Schema.Struct({
  bots: ForwardCompatibleArray(BotRosterEntry),
  availableMcpServers: Schema.Array(BotAvailableMcpServer),
  /** The internal project that owns every Bot thread; null until the first Bot exists. */
  backingProjectId: Schema.NullOr(ProjectId),
  codingThreads: ForwardCompatibleArray(BotCodingThreadLink),
});
export type BotListResult = typeof BotListResult.Type;

export const BotGetInput = Schema.Struct({
  botId: BotId,
});
export type BotGetInput = typeof BotGetInput.Type;

export const BotDetailResult = Schema.Struct({
  ...BotRosterEntry.fields,
  documents: BotDocuments,
});
export type BotDetailResult = typeof BotDetailResult.Type;

export const BotDocumentsPatch = Schema.Struct({
  soul: Schema.optionalKey(Schema.String),
  now: Schema.optionalKey(Schema.String),
  memory: Schema.optionalKey(Schema.String),
  heartbeat: Schema.optionalKey(Schema.String),
});

export const BotCreateInput = Schema.Struct({
  ...Struct.mapOmit(BotEditableFields, ["name", "modelSelection"], Schema.optionalKey),
  slug: Schema.optionalKey(BotSlug).annotate({ description: "Default: derived from the name." }),
  proactive: Schema.optionalKey(BotProactiveConfig),
  documents: Schema.optionalKey(BotDocumentsPatch),
});
export type BotCreateInput = typeof BotCreateInput.Type;

export const BotUpdateInput = Schema.Struct({
  botId: BotId,
  slug: Schema.optionalKey(BotSlug).annotate({
    description:
      "Optional new slug. Renaming a Bot without passing slug derives one from the new name.",
  }),
  ...Struct.map(BotEditableFields, Schema.optionalKey),
  muted: Schema.optionalKey(Schema.Boolean),
  archived: Schema.optionalKey(Schema.Boolean),
  proactive: Schema.optionalKey(BotProactiveConfig),
  documents: Schema.optionalKey(BotDocumentsPatch),
});
export type BotUpdateInput = typeof BotUpdateInput.Type;

export const BotDeleteInput = Schema.Struct({
  botId: BotId,
});
export type BotDeleteInput = typeof BotDeleteInput.Type;

export const BotDeleteResult = Schema.Struct({
  botId: BotId,
});
export type BotDeleteResult = typeof BotDeleteResult.Type;

export const BotMessageInput = Schema.Struct({
  fromBotId: BotId,
  to: BotSlug,
  message: TrimmedNonEmptyString,
  expectReply: Schema.optionalKey(Schema.Boolean),
});
export type BotMessageInput = typeof BotMessageInput.Type;

export const BotMessageResult = Schema.Struct({
  exchange: BotExchange,
});
export type BotMessageResult = typeof BotMessageResult.Type;

export const BotListExchangesInput = Schema.Struct({
  botId: BotId,
});
export type BotListExchangesInput = typeof BotListExchangesInput.Type;

export const BotListExchangesResult = Schema.Struct({
  exchanges: ForwardCompatibleArray(BotExchange),
});
export type BotListExchangesResult = typeof BotListExchangesResult.Type;

import {
  BotCodingThreadLink,
  BotExchange,
  BotExchangeId,
  type BotExchangeStatus,
  BotId,
  BotMcpServerConfig,
  BotRecord,
  BotSlug,
  IsoDateTime,
  ModelSelection,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";
import * as SqlSchema from "effect/sql/SqlSchema";

import * as ServerConfig from "../config.ts";

export class BotStoreError extends Schema.TaggedError<BotStoreError>()("BotStoreError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Bot store operation '${this.operation}' failed.`;
  }
}

const BotNamesJson = Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString));

const BotDbRow = Schema.Struct({
  ...BotRecord.fields,
  isPrimary: Schema.BooleanFromBit,
  muted: Schema.BooleanFromBit,
  modelSelection: Schema.fromJsonString(ModelSelection),
  tools: BotNamesJson,
  mcpServerNames: BotNamesJson,
  customMcpServers: Schema.fromJsonString(Schema.Record(TrimmedNonEmptyString, BotMcpServerConfig)),
  skills: BotNamesJson,
});

const ExchangeDbRow = Schema.Struct({
  ...BotExchange.fields,
  expectReply: Schema.BooleanFromBit,
});

const BOT_COLUMNS = `
  bot_id AS "id",
  slug,
  name,
  role,
  group_name AS "groupName",
  icon,
  color,
  is_primary AS "isPrimary",
  model_selection_json AS "modelSelection",
  runtime_mode AS "runtimeMode",
  tools_json AS "tools",
  mcp_server_names_json AS "mcpServerNames",
  custom_mcp_servers_json AS "customMcpServers",
  skills_json AS "skills",
  system_prompt_mode AS "systemPromptMode",
  muted,
  thread_id AS "threadId",
  folder_path AS "folderPath",
  hop_count AS "hopCount",
  archived_at AS "archivedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const EXCHANGE_COLUMNS = `
  exchange_id AS "id",
  kind,
  from_bot_id AS "fromBotId",
  to_bot_id AS "toBotId",
  watched_thread_id AS "watchedThreadId",
  target_run_id AS "targetRunId",
  hop_count AS "hopCount",
  expect_reply AS "expectReply",
  status,
  summary,
  created_at AS "createdAt",
  resolved_at AS "resolvedAt"
`;

const RECENT_EXCHANGE_LIMIT = 50;
const CODING_THREAD_LINK_LIMIT = 200;

export class BotStore extends Context.Service<
  BotStore,
  {
    readonly insert: (bot: BotRecord) => Effect.Effect<void, BotStoreError>;
    /** Replaces every column except the id; a primary bot clears the others in the same write. */
    readonly update: (bot: BotRecord) => Effect.Effect<void, BotStoreError>;
    /** Cancels pending exchanges that involve the bot, then removes it. */
    readonly delete: (botId: BotId, resolvedAt: IsoDateTime) => Effect.Effect<void, BotStoreError>;
    readonly get: (botId: BotId) => Effect.Effect<Option.Option<BotRecord>, BotStoreError>;
    readonly findBySlug: (slug: BotSlug) => Effect.Effect<Option.Option<BotRecord>, BotStoreError>;
    readonly findByThreadId: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<BotRecord>, BotStoreError>;
    readonly list: (options: {
      readonly includeArchived: boolean;
    }) => Effect.Effect<ReadonlyArray<BotRecord>, BotStoreError>;
    readonly updateHopCount: (input: {
      readonly botId: BotId;
      readonly hopCount: number;
    }) => Effect.Effect<void, BotStoreError>;
    /** False when an exchange with the same id, or a coding-thread watch of the same run, exists. */
    readonly insertExchange: (exchange: BotExchange) => Effect.Effect<boolean, BotStoreError>;
    /** Moves a pending exchange to a final status; false when it was no longer pending. */
    readonly resolveExchange: (input: {
      readonly exchangeId: BotExchangeId;
      readonly status: Exclude<BotExchangeStatus, "pending">;
      readonly summary: string | null;
      readonly resolvedAt: IsoDateTime;
    }) => Effect.Effect<boolean, BotStoreError>;
    readonly retargetExchange: (input: {
      readonly exchangeId: BotExchangeId;
      readonly targetRunId: RunId;
    }) => Effect.Effect<void, BotStoreError>;
    /** Newest first. */
    readonly listExchangesForBot: (
      botId: BotId,
    ) => Effect.Effect<ReadonlyArray<BotExchange>, BotStoreError>;
    readonly findPendingExchangesByWatchedThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<BotExchange>, BotStoreError>;
    /** The latest coding-thread exchange per bot and watched thread, newest first. */
    readonly listCodingThreadLinks: (options: {
      readonly includeArchived: boolean;
    }) => Effect.Effect<ReadonlyArray<BotCodingThreadLink>, BotStoreError>;
  }
>()("t3/bots/BotStore") {}

const setup = Effect.fn("BotStore.setup")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The server and the CLI can open this file from separate processes.
  yield* sql`PRAGMA busy_timeout = 5000;`;
  yield* sql`PRAGMA foreign_keys = ON;`;
  yield* sql`PRAGMA journal_mode = WAL;`;
  yield* sql`PRAGMA synchronous = NORMAL;`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS bots (
      bot_id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      group_name TEXT,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      mcp_server_names_json TEXT NOT NULL,
      custom_mcp_servers_json TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      system_prompt_mode TEXT NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      thread_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      hop_count INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS bots_slug ON bots (slug)`;
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS bots_thread_id ON bots (thread_id)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS bot_exchanges (
      exchange_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      from_bot_id TEXT NOT NULL REFERENCES bots (bot_id) ON DELETE CASCADE,
      to_bot_id TEXT REFERENCES bots (bot_id) ON DELETE SET NULL,
      watched_thread_id TEXT NOT NULL,
      target_run_id TEXT,
      hop_count INTEGER NOT NULL,
      expect_reply INTEGER NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS bot_exchanges_watched_thread
    ON bot_exchanges (watched_thread_id, status)
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS bot_exchanges_status ON bot_exchanges (status)`;
  yield* sql`CREATE INDEX IF NOT EXISTS bot_exchanges_from_bot ON bot_exchanges (from_bot_id)`;
  yield* sql`CREATE INDEX IF NOT EXISTS bot_exchanges_to_bot ON bot_exchanges (to_bot_id)`;
  // message.updated repeats for one message; a coding thread's run is watched once per bot.
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bot_exchanges_coding_run
    ON bot_exchanges (from_bot_id, watched_thread_id, target_run_id)
    WHERE kind = 'coding_thread'
  `;
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* setup();
  const encodeBot = Schema.encodeEffect(BotDbRow);
  const encodeExchange = Schema.encodeEffect(ExchangeDbRow);

  const mapError =
    (operation: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new BotStoreError({ operation, cause })));

  const selectBots = SqlSchema.findAll({
    Request: Schema.Struct({
      botId: Schema.optional(BotId),
      slug: Schema.optional(BotSlug),
      threadId: Schema.optional(ThreadId),
      includeArchived: Schema.Boolean,
    }),
    Result: BotDbRow,
    execute: (request) => sql`
      SELECT ${sql.literal(BOT_COLUMNS)}
      FROM bots
      WHERE ${sql.and([
        ...(request.includeArchived ? [] : [sql`archived_at IS NULL`]),
        ...(request.botId === undefined ? [] : [sql`bot_id = ${request.botId}`]),
        ...(request.slug === undefined ? [] : [sql`slug = ${request.slug}`]),
        ...(request.threadId === undefined ? [] : [sql`thread_id = ${request.threadId}`]),
      ])}
      ORDER BY created_at ASC, rowid ASC
    `,
  });

  const selectExchanges = SqlSchema.findAll({
    Request: Schema.Struct({
      botId: Schema.optional(BotId),
      pendingWatchedThreadId: Schema.optional(ThreadId),
    }),
    Result: ExchangeDbRow,
    execute: (request) => sql`
      SELECT ${sql.literal(EXCHANGE_COLUMNS)}
      FROM bot_exchanges
      WHERE ${sql.and([
        ...(request.botId === undefined
          ? []
          : [sql`(from_bot_id = ${request.botId} OR to_bot_id = ${request.botId})`]),
        ...(request.pendingWatchedThreadId === undefined
          ? []
          : [sql`watched_thread_id = ${request.pendingWatchedThreadId}`, sql`status = 'pending'`]),
      ])}
      ORDER BY created_at DESC, rowid DESC
      ${request.botId === undefined ? sql.literal("") : sql`LIMIT ${RECENT_EXCHANGE_LIMIT}`}
    `,
  });

  const selectCodingThreadLinks = SqlSchema.findAll({
    Request: Schema.Struct({ includeArchived: Schema.Boolean }),
    Result: BotCodingThreadLink,
    execute: (request) => sql`
      SELECT
        latest.from_bot_id AS "botId",
        latest.watched_thread_id AS "threadId",
        latest.status,
        latest.created_at AS "createdAt",
        latest.resolved_at AS "resolvedAt"
      FROM (
        SELECT
          exchange.*,
          exchange.rowid AS insertion_order,
          ROW_NUMBER() OVER (
            PARTITION BY exchange.from_bot_id, exchange.watched_thread_id
            ORDER BY exchange.created_at DESC, exchange.rowid DESC
          ) AS recency
        FROM bot_exchanges AS exchange
        JOIN bots ON bots.bot_id = exchange.from_bot_id
        WHERE ${sql.and([
          sql`exchange.kind = 'coding_thread'`,
          ...(request.includeArchived ? [] : [sql`bots.archived_at IS NULL`]),
        ])}
      ) AS latest
      WHERE latest.recency = 1
      ORDER BY latest.created_at DESC, latest.insertion_order DESC
      LIMIT ${CODING_THREAD_LINK_LIMIT}
    `,
  });

  const findOne = (request: Parameters<typeof selectBots>[0]) =>
    selectBots(request).pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
    );

  const clearOtherPrimaries = (bot: BotRecord) =>
    bot.isPrimary
      ? sql`UPDATE bots SET is_primary = 0 WHERE bot_id != ${bot.id} AND is_primary = 1`
      : Effect.void;

  const botColumns = (encoded: typeof BotDbRow.Encoded) => ({
    slug: encoded.slug,
    name: encoded.name,
    role: encoded.role,
    group_name: encoded.groupName,
    icon: encoded.icon,
    color: encoded.color,
    is_primary: encoded.isPrimary,
    model_selection_json: encoded.modelSelection,
    runtime_mode: encoded.runtimeMode,
    tools_json: encoded.tools,
    mcp_server_names_json: encoded.mcpServerNames,
    custom_mcp_servers_json: encoded.customMcpServers,
    skills_json: encoded.skills,
    system_prompt_mode: encoded.systemPromptMode,
    muted: encoded.muted,
    thread_id: encoded.threadId,
    folder_path: encoded.folderPath,
    hop_count: encoded.hopCount,
    archived_at: encoded.archivedAt,
    created_at: encoded.createdAt,
    updated_at: encoded.updatedAt,
  });

  const insert: BotStore["Service"]["insert"] = Effect.fn("BotStore.insert")(function* (bot) {
    const encoded = yield* encodeBot(bot);
    yield* sql.withTransaction(
      clearOtherPrimaries(bot).pipe(
        Effect.andThen(
          sql`INSERT INTO bots ${sql.insert({ bot_id: encoded.id, ...botColumns(encoded) })}`,
        ),
      ),
    );
  }, mapError("insert"));

  const update: BotStore["Service"]["update"] = Effect.fn("BotStore.update")(function* (bot) {
    const encoded = yield* encodeBot(bot);
    yield* sql.withTransaction(
      clearOtherPrimaries(bot).pipe(
        Effect.andThen(
          sql`UPDATE bots SET ${sql.update(botColumns(encoded))} WHERE bot_id = ${encoded.id}`,
        ),
      ),
    );
  }, mapError("update"));

  const deleteBot: BotStore["Service"]["delete"] = Effect.fn("BotStore.delete")(function* (
    botId,
    resolvedAt,
  ) {
    yield* sql.withTransaction(
      Effect.all([
        sql`
            UPDATE bot_exchanges
            SET status = 'cancelled', resolved_at = ${resolvedAt}
            WHERE status = 'pending' AND (from_bot_id = ${botId} OR to_bot_id = ${botId})
          `,
        sql`DELETE FROM bots WHERE bot_id = ${botId}`,
      ]),
    );
  }, mapError("delete"));

  const updateHopCount: BotStore["Service"]["updateHopCount"] = Effect.fn(
    "BotStore.updateHopCount",
  )(function* (input) {
    yield* sql`UPDATE bots SET hop_count = ${input.hopCount} WHERE bot_id = ${input.botId}`;
  }, mapError("updateHopCount"));

  const insertExchange: BotStore["Service"]["insertExchange"] = Effect.fn(
    "BotStore.insertExchange",
  )(function* (exchange) {
    const encoded = yield* encodeExchange(exchange);
    const inserted = yield* sql`
      INSERT INTO bot_exchanges ${sql.insert({
        exchange_id: encoded.id,
        kind: encoded.kind,
        from_bot_id: encoded.fromBotId,
        to_bot_id: encoded.toBotId,
        watched_thread_id: encoded.watchedThreadId,
        target_run_id: encoded.targetRunId,
        hop_count: encoded.hopCount,
        expect_reply: encoded.expectReply,
        status: encoded.status,
        summary: encoded.summary,
        created_at: encoded.createdAt,
        resolved_at: encoded.resolvedAt,
      })}
      ON CONFLICT DO NOTHING
      RETURNING exchange_id
    `;
    return inserted.length > 0;
  }, mapError("insertExchange"));

  const resolveExchange: BotStore["Service"]["resolveExchange"] = Effect.fn(
    "BotStore.resolveExchange",
  )(function* (input) {
    const resolved = yield* sql`
      UPDATE bot_exchanges
      SET status = ${input.status}, summary = ${input.summary}, resolved_at = ${input.resolvedAt}
      WHERE exchange_id = ${input.exchangeId} AND status = 'pending'
      RETURNING exchange_id
    `;
    return resolved.length > 0;
  }, mapError("resolveExchange"));

  const retargetExchange: BotStore["Service"]["retargetExchange"] = Effect.fn(
    "BotStore.retargetExchange",
  )(function* (input) {
    yield* sql`
      UPDATE bot_exchanges SET target_run_id = ${input.targetRunId}
      WHERE exchange_id = ${input.exchangeId} AND status = 'pending'
    `;
  }, mapError("retargetExchange"));

  const get: BotStore["Service"]["get"] = Effect.fn("BotStore.get")(function* (botId) {
    return yield* findOne({ botId, includeArchived: true });
  }, mapError("get"));

  const findBySlug: BotStore["Service"]["findBySlug"] = Effect.fn("BotStore.findBySlug")(function* (
    slug,
  ) {
    return yield* findOne({ slug, includeArchived: true });
  }, mapError("findBySlug"));

  const findByThreadId: BotStore["Service"]["findByThreadId"] = Effect.fn(
    "BotStore.findByThreadId",
  )(function* (threadId) {
    return yield* findOne({ threadId, includeArchived: true });
  }, mapError("findByThreadId"));

  const list: BotStore["Service"]["list"] = Effect.fn("BotStore.list")(function* (options) {
    return yield* selectBots({ includeArchived: options.includeArchived }).pipe(
      NodeSqliteClient.readOnly,
    );
  }, mapError("list"));

  const listExchangesForBot: BotStore["Service"]["listExchangesForBot"] = Effect.fn(
    "BotStore.listExchangesForBot",
  )(function* (botId) {
    return yield* selectExchanges({ botId }).pipe(NodeSqliteClient.readOnly);
  }, mapError("listExchangesForBot"));

  const findPendingExchangesByWatchedThread: BotStore["Service"]["findPendingExchangesByWatchedThread"] =
    Effect.fn("BotStore.findPendingExchangesByWatchedThread")(function* (threadId) {
      return yield* selectExchanges({ pendingWatchedThreadId: threadId }).pipe(
        NodeSqliteClient.readOnly,
      );
    }, mapError("findPendingExchangesByWatchedThread"));

  const listCodingThreadLinks: BotStore["Service"]["listCodingThreadLinks"] = Effect.fn(
    "BotStore.listCodingThreadLinks",
  )(function* (options) {
    return yield* selectCodingThreadLinks(options).pipe(NodeSqliteClient.readOnly);
  }, mapError("listCodingThreadLinks"));

  return BotStore.of({
    insert,
    update,
    delete: deleteBot,
    get,
    findBySlug,
    findByThreadId,
    list,
    updateHopCount,
    insertExchange,
    resolveExchange,
    retargetExchange,
    listExchangesForBot,
    findPendingExchangesByWatchedThread,
    listCodingThreadLinks,
  });
});

const layerWith = (database: Layer.Layer<SqlClient.SqlClient, SqlError.SqlError>) =>
  Layer.effect(BotStore, make).pipe(Layer.provide(database));

/** Bots keep their own database beside statev2.sqlite so the orchestration schema stays untouched. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(stateDir, { recursive: true });
    return layerWith(
      NodeSqliteClient.layer({
        filename: path.join(stateDir, "bots.sqlite"),
        readerWorker: true,
        writerWorker: true,
        spanAttributes: { "db.name": "bots.sqlite", "service.name": "t3code-server" },
      }),
    );
  }),
);

export const layerMemory = layerWith(NodeSqliteClient.layer({ filename: ":memory:" }));

import {
  type BotAvailableMcpServer,
  type BotDocuments,
  type BotHarnessProfile,
  type BotId,
  BotMcpServerConfig,
  type BotRecord,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export type BotAuthSettings = NonNullable<BotHarnessProfile["authSettings"]>;
type BotMcpServers = Readonly<Record<string, BotMcpServerConfig>>;
type DocumentName = keyof BotDocuments;

export class BotFolderError extends Schema.TaggedError<BotFolderError>()("BotFolderError", {
  operation: Schema.Literals(["ensure", "read-document", "write-document"]),
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Bot folder operation '${this.operation}' failed for ${this.path}.`;
  }
}

export class BotFolders extends Context.Service<
  BotFolders,
  {
    /** `<baseDir>/bots`: one immutable folder per bot id, plus `_shared/`. */
    readonly root: string;
    readonly sharedDir: string;
    readonly folderFor: (botId: BotId) => string;
    /** Creates `_shared/` and the bot's folder; returns the folder path. */
    readonly ensure: (folderPath: string) => Effect.Effect<string, BotFolderError>;
    /** A missing document reads as empty. */
    readonly readDocuments: (folderPath: string) => Effect.Effect<BotDocuments, BotFolderError>;
    /** `seed` writes only documents that do not exist yet, so a kept folder keeps its memory. */
    readonly writeDocuments: (
      folderPath: string,
      documents: Partial<BotDocuments>,
      mode: "replace" | "seed",
    ) => Effect.Effect<void, BotFolderError>;
    /** Points providers that read AGENTS.md, not Claude's harness profile, at the bot's files. */
    readonly writeAgentsFile: (
      bot: Pick<BotRecord, "folderPath" | "name" | "role">,
    ) => Effect.Effect<void, BotFolderError>;
    /** Names and transports only: configs can hold credentials. */
    readonly listAvailableMcpServers: Effect.Effect<ReadonlyArray<BotAvailableMcpServer>>;
    /** Global servers named in `names`, with `custom` overriding them by name. */
    readonly resolveMcpServers: (
      names: ReadonlyArray<string>,
      custom: BotMcpServers,
    ) => Effect.Effect<BotMcpServers>;
    readonly readAuthSettings: Effect.Effect<BotAuthSettings | undefined>;
  }
>()("t3/bots/BotFolders") {}

const DOCUMENT_FILES: Readonly<Record<DocumentName, string>> = {
  soul: "SOUL.md",
  memory: "MEMORY.md",
};

const agentsFileContents = (bot: Pick<BotRecord, "name" | "role">) =>
  [
    `# ${bot.name}`,
    "",
    `You are ${bot.name}, a persistent T3 Code Bot.${bot.role.trim() === "" ? "" : ` Role: ${bot.role.trim()}`}`,
    "",
    "Before you act, read these files in this folder:",
    "",
    "- `SOUL.md`: who you are, how you work, and your standing rules.",
    "- `MEMORY.md`: what you remember. Keep it current with durable facts, decisions and open follow-ups.",
    "",
    "`../_shared/` holds handoff files shared with the other Bots.",
    "",
  ].join("\n");

const decodeJsonObject = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeMcpServerConfig = Schema.decodeUnknownOption(BotMcpServerConfig);
const decodeTrimmed = Schema.decodeUnknownOption(TrimmedNonEmptyString);

// Claude Code treats an entry without `type` as stdio unless it has a URL.
const toMcpServerConfig = (raw: unknown): Option.Option<BotMcpServerConfig> =>
  Predicate.isObject(raw)
    ? decodeMcpServerConfig({ type: "url" in raw ? "http" : "stdio", ...raw })
    : Option.none();

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homeDirectory = yield* HostProcess.HomeDirectory;

  const root = path.resolve(config.baseDir, "bots");
  const sharedDir = path.join(root, "_shared");
  const folderFor = (botId: BotId) => path.join(root, botId);
  const documentPath = (folderPath: string, name: DocumentName) =>
    path.join(folderPath, DOCUMENT_FILES[name]);
  const claudeConfigPath = path.join(homeDirectory, ".claude.json");
  const claudeSettingsPath = path.join(homeDirectory, ".claude", "settings.json");

  const writeFile = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) => new BotFolderError({ operation: "write-document", path: filePath, cause }),
      ),
    );

  const ensure: BotFolders["Service"]["ensure"] = Effect.fn("BotFolders.ensure")(
    function* (folderPath) {
      for (const directory of [sharedDir, folderPath]) {
        yield* fileSystem
          .makeDirectory(directory, { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) => new BotFolderError({ operation: "ensure", path: directory, cause }),
            ),
          );
      }
      return folderPath;
    },
  );

  const readDocument = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
      Effect.mapError(
        (cause) => new BotFolderError({ operation: "read-document", path: filePath, cause }),
      ),
    );

  const readDocuments: BotFolders["Service"]["readDocuments"] = Effect.fn(
    "BotFolders.readDocuments",
  )(function* (folderPath) {
    const [soul, memory] = yield* Effect.all([
      readDocument(documentPath(folderPath, "soul")),
      readDocument(documentPath(folderPath, "memory")),
    ]);
    return { soul, memory };
  });

  const writeDocuments: BotFolders["Service"]["writeDocuments"] = Effect.fn(
    "BotFolders.writeDocuments",
  )(function* (folderPath, documents, mode) {
    for (const name of ["soul", "memory"] as const) {
      const contents = documents[name];
      if (contents === undefined) continue;
      const filePath = documentPath(folderPath, name);
      if (
        mode === "seed" &&
        (yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false)))
      ) {
        continue;
      }
      yield* writeFile(filePath, contents);
    }
  });

  const writeAgentsFile: BotFolders["Service"]["writeAgentsFile"] = (bot) =>
    writeFile(path.join(bot.folderPath, "AGENTS.md"), agentsFileContents(bot)).pipe(
      Effect.withSpan("BotFolders.writeAgentsFile"),
    );

  // ~/.claude.json also holds every project's history and can be megabytes; parse it once per change.
  const globalServersCache = yield* Ref.make<{
    readonly stamp: string;
    readonly servers: BotMcpServers;
  } | null>(null);

  const readGlobalMcpServers = Effect.gen(function* () {
    const info = yield* fileSystem.stat(claudeConfigPath).pipe(Effect.option);
    if (Option.isNone(info)) return {};
    const stamp = `${Option.getOrUndefined(info.value.mtime)?.getTime() ?? 0}:${info.value.size}`;
    const cached = yield* Ref.get(globalServersCache);
    if (cached?.stamp === stamp) return cached.servers;
    const parsed = yield* fileSystem.readFileString(claudeConfigPath).pipe(
      Effect.map(decodeJsonObject),
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isNone(parsed)) {
      yield* Effect.logWarning("Bots could not read Claude's global MCP servers.", {
        path: claudeConfigPath,
      });
    }
    const rawServers = Option.match(parsed, {
      onNone: () => undefined,
      onSome: (config) => config["mcpServers"],
    });
    const servers: Record<string, BotMcpServerConfig> = {};
    if (Predicate.isObject(rawServers)) {
      for (const [name, raw] of Object.entries(rawServers)) {
        const server = toMcpServerConfig(raw);
        if (name.trim() !== "" && Option.isSome(server)) servers[name.trim()] = server.value;
      }
    }
    yield* Ref.set(globalServersCache, { stamp, servers });
    return servers;
  }).pipe(Effect.withSpan("BotFolders.readGlobalMcpServers"));

  const listAvailableMcpServers: BotFolders["Service"]["listAvailableMcpServers"] =
    readGlobalMcpServers.pipe(
      Effect.map((servers) =>
        Object.entries(servers).map(([name, server]) => ({
          name: TrimmedNonEmptyString.make(name),
          transport: server.type,
        })),
      ),
    );

  const resolveMcpServers: BotFolders["Service"]["resolveMcpServers"] = (names, custom) =>
    readGlobalMcpServers.pipe(
      Effect.map((global) => ({
        ...Object.fromEntries(
          names.flatMap((name) =>
            Object.hasOwn(global, name) ? [[name, global[name]!] as const] : [],
          ),
        ),
        ...custom,
      })),
    );

  const readAuthSettings: BotFolders["Service"]["readAuthSettings"] = Effect.gen(function* () {
    const settings = yield* fileSystem.readFileString(claudeSettingsPath).pipe(
      Effect.map(decodeJsonObject),
      Effect.orElseSucceed(() => Option.none()),
    );
    if (Option.isNone(settings)) return undefined;
    const env = settings.value["env"];
    const apiKeyHelper = decodeTrimmed(settings.value["apiKeyHelper"]);
    const anthropicBaseUrl = decodeTrimmed(
      Predicate.isObject(env) ? env["ANTHROPIC_BASE_URL"] : undefined,
    );
    if (Option.isNone(apiKeyHelper) && Option.isNone(anthropicBaseUrl)) return undefined;
    const authSettings: BotAuthSettings = {
      ...(Option.isSome(apiKeyHelper) ? { apiKeyHelper: apiKeyHelper.value } : {}),
      ...(Option.isSome(anthropicBaseUrl) ? { anthropicBaseUrl: anthropicBaseUrl.value } : {}),
    };
    return authSettings;
  }).pipe(Effect.withSpan("BotFolders.readAuthSettings"));

  return BotFolders.of({
    root,
    sharedDir,
    folderFor,
    ensure,
    readDocuments,
    writeDocuments,
    writeAgentsFile,
    listAvailableMcpServers,
    resolveMcpServers,
    readAuthSettings,
  });
});

export const layer = Layer.effect(BotFolders, make);

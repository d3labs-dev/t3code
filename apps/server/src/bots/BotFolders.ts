import {
  type BotAvailableMcpServer,
  type BotDocuments,
  type BotHarnessProfile,
  BotMcpServerConfig,
  type BotRecord,
  type BotSlug,
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
  operation: Schema.Literals(["ensure", "rename", "read-document", "write-document"]),
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
    /** `<baseDir>/bots`: one folder per bot slug, plus `_shared/`. */
    readonly root: string;
    readonly sharedDir: string;
    readonly folderFor: (slug: BotSlug) => string;
    readonly exists: (slug: BotSlug) => Effect.Effect<boolean>;
    /** Creates `_shared/` and the bot's folder; returns the bot's folder. */
    readonly ensure: (slug: BotSlug) => Effect.Effect<string, BotFolderError>;
    /** Moves a bot's folder to a new slug; refuses to overwrite an existing folder. */
    readonly rename: (from: BotSlug, to: BotSlug) => Effect.Effect<string, BotFolderError>;
    /** A missing document reads as empty. */
    readonly readDocuments: (slug: BotSlug) => Effect.Effect<BotDocuments, BotFolderError>;
    /** `seed` writes only documents that do not exist yet, so a kept folder keeps its memory. */
    readonly writeDocuments: (
      slug: BotSlug,
      documents: Partial<BotDocuments>,
      mode: "replace" | "seed",
    ) => Effect.Effect<void, BotFolderError>;
    /** Points providers that read AGENTS.md, not Claude's harness profile, at the bot's files. */
    readonly writeAgentsFile: (
      bot: Pick<BotRecord, "slug" | "name" | "role">,
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
  const folderFor = (slug: BotSlug) => path.join(root, slug);
  const documentPath = (slug: BotSlug, name: DocumentName) =>
    path.join(folderFor(slug), DOCUMENT_FILES[name]);
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

  const exists: BotFolders["Service"]["exists"] = (slug) =>
    fileSystem.exists(folderFor(slug)).pipe(Effect.orElseSucceed(() => false));

  const ensure: BotFolders["Service"]["ensure"] = Effect.fn("BotFolders.ensure")(function* (slug) {
    const folder = folderFor(slug);
    for (const directory of [sharedDir, folder]) {
      yield* fileSystem
        .makeDirectory(directory, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) => new BotFolderError({ operation: "ensure", path: directory, cause }),
          ),
        );
    }
    return folder;
  });

  const rename: BotFolders["Service"]["rename"] = Effect.fn("BotFolders.rename")(
    function* (from, to) {
      const target = folderFor(to);
      if (from === to) return yield* ensure(to);
      const source = folderFor(from);
      if (!(yield* fileSystem.exists(source).pipe(Effect.orElseSucceed(() => false)))) {
        return yield* ensure(to);
      }
      if (yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false))) {
        return yield* new BotFolderError({
          operation: "rename",
          path: target,
          cause: new Error(`Target folder already exists: ${target}`),
        });
      }
      yield* fileSystem
        .rename(source, target)
        .pipe(
          Effect.mapError(
            (cause) => new BotFolderError({ operation: "rename", path: target, cause }),
          ),
        );
      return target;
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
  )(function* (slug) {
    const [soul, memory] = yield* Effect.all([
      readDocument(documentPath(slug, "soul")),
      readDocument(documentPath(slug, "memory")),
    ]);
    return { soul, memory };
  });

  const writeDocuments: BotFolders["Service"]["writeDocuments"] = Effect.fn(
    "BotFolders.writeDocuments",
  )(function* (slug, documents, mode) {
    for (const name of ["soul", "memory"] as const) {
      const contents = documents[name];
      if (contents === undefined) continue;
      const filePath = documentPath(slug, name);
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
    writeFile(path.join(folderFor(bot.slug), "AGENTS.md"), agentsFileContents(bot)).pipe(
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
    exists,
    ensure,
    rename,
    readDocuments,
    writeDocuments,
    writeAgentsFile,
    listAvailableMcpServers,
    resolveMcpServers,
    readAuthSettings,
  });
});

export const layer = Layer.effect(BotFolders, make);

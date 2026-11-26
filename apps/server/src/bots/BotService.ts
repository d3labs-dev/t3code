import {
  BOT_DEFAULT_COLOR,
  BOT_DEFAULT_ICON,
  BOT_DEFAULT_TOOLS,
  BOT_MAX_HOPS,
  BotError,
  type BotCreateInput,
  type BotDeleteInput,
  type BotDeleteResult,
  type BotDetailResult,
  type BotExchange,
  BotExchangeId,
  type BotGetInput,
  type BotHarnessProfile,
  BotId,
  type BotListExchangesInput,
  type BotListExchangesResult,
  type BotListInput,
  type BotListResult,
  type BotMessageInput,
  type BotMessageResult,
  type BotRecord,
  type BotRosterEntry,
  BotSlug,
  type BotStatus,
  type BotUpdateInput,
  CommandId,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
  ProjectId,
  type RunId,
  type ThreadId,
  slugifyBotName,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { latestRootProviderFailure } from "@t3tools/shared/orchestrationV2ThreadError";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as BotFolders from "./BotFolders.ts";
import { resolveBotHarnessProfile } from "./BotHarnessProfile.ts";
import * as BotStore from "./BotStore.ts";

export class BotService extends Context.Service<
  BotService,
  {
    /** The internal project that owns every bot thread, once a bot has been created. */
    readonly backingProjectId: Effect.Effect<ProjectId | null>;
    readonly list: (input: BotListInput) => Effect.Effect<BotListResult, BotError>;
    readonly subscribeList: (input?: BotListInput) => Stream.Stream<BotListResult, BotError>;
    readonly get: (input: BotGetInput) => Effect.Effect<BotDetailResult, BotError>;
    readonly getBySlug: (slug: BotSlug) => Effect.Effect<Option.Option<BotRecord>, BotError>;
    readonly getByThreadId: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<BotRecord>, BotError>;
    /** Starts the bot's thread idle: no turn runs until someone messages it. */
    readonly create: (input: BotCreateInput) => Effect.Effect<BotDetailResult, BotError>;
    readonly update: (input: BotUpdateInput) => Effect.Effect<BotDetailResult, BotError>;
    /** Archives the bot's thread and keeps its folder on disk. */
    readonly delete: (input: BotDeleteInput) => Effect.Effect<BotDeleteResult, BotError>;
    readonly sendMessage: (input: BotMessageInput) => Effect.Effect<BotMessageResult, BotError>;
    readonly listExchanges: (
      input: BotListExchangesInput,
    ) => Effect.Effect<BotListExchangesResult, BotError>;
    /** None for any thread that is not a bot's. */
    readonly resolveHarnessProfile: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<BotHarnessProfile>, BotError>;
    /** Resets hop counts on human messages and wakes bots when the work they wait on ends. */
    readonly startReactor: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/bots/BotService") {}

const WORKING_RUN_STATUSES: ReadonlySet<OrchestrationV2ThreadShell["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
]);
const WAKING_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
const MAX_WAKE_TEXT_LENGTH = 4000;

const statusOf = (shell: OrchestrationV2ThreadShell | null): BotStatus => {
  if (shell === null) return "idle";
  if (
    shell.status === "waiting" ||
    (shell.pendingRuntimeRequest !== null && shell.pendingRuntimeRequest.blocking !== false)
  ) {
    return "waiting";
  }
  if (WORKING_RUN_STATUSES.has(shell.status)) return "working";
  return shell.status === "failed" ? "error" : "idle";
};

const truncate = (text: string) =>
  text.length <= MAX_WAKE_TEXT_LENGTH
    ? text
    : `${text.slice(0, MAX_WAKE_TEXT_LENGTH).trimEnd()}\n\n[Truncated. Read the rest with t3_thread_read.]`;

// The delivered message keeps this id, so the run that carries it can be found after a steer moves it.
const botMessageId = (exchangeId: BotExchangeId) => MessageId.make(`bot-message:${exchangeId}`);

const nextFreeSlug = (base: BotSlug, taken: ReadonlySet<string>): BotSlug => {
  if (!taken.has(base)) return base;
  for (let attempt = 2; ; attempt++) {
    const suffix = `-${attempt}`;
    const candidate = `${base.slice(0, 40 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return BotSlug.make(candidate);
  }
};

const defaultSoul = (bot: Pick<BotRecord, "name" | "role">) =>
  [
    `# ${bot.name}`,
    "",
    bot.role.trim() === ""
      ? "Describe who this Bot is, how it works, and what it cares about."
      : bot.role.trim(),
    "",
  ].join("\n");

const DEFAULT_MEMORY = "# Memory\n\n";

const latestMessage = (messages: ReadonlyArray<OrchestrationV2ConversationMessage>) =>
  messages.reduce<OrchestrationV2ConversationMessage | undefined>(
    (latest, message) =>
      latest === undefined ||
      DateTime.toEpochMillis(message.createdAt) >= DateTime.toEpochMillis(latest.createdAt)
        ? message
        : latest,
    undefined,
  );

const failed = (message: string) => (cause: unknown) =>
  new BotError({ code: "operation_failed", message, cause });

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const folders = yield* BotFolders.BotFolders;
  const projects = yield* ProjectService.ProjectService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  // Sliding: a slow subscriber only needs to know the roster changed since its last read.
  const changes = yield* PubSub.sliding<void>(1);
  const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  // Serializes slug choice and the first-bot-is-primary rule.
  const createLock = yield* Semaphore.make(1);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const requireBot = (botId: BotId) =>
    store.get(botId).pipe(
      Effect.mapError(failed("Couldn't read the Bot.")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new BotError({ code: "bot_not_found", message: `Bot ${botId} was not found.` }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const rosterEntry = (bot: BotRecord): Effect.Effect<BotRosterEntry, BotError> =>
    threads.getThreadShell(bot.threadId).pipe(
      Effect.map((shell) => ({ bot, status: statusOf(shell) })),
      Effect.mapError(failed("Couldn't read the Bot's thread.")),
    );

  const detail = (bot: BotRecord): Effect.Effect<BotDetailResult, BotError> =>
    Effect.all(
      [
        rosterEntry(bot),
        folders
          .readDocuments(bot.slug)
          .pipe(Effect.mapError(failed("Couldn't read the Bot's documents."))),
      ],
      { concurrency: 2 },
    ).pipe(Effect.map(([entry, documents]) => ({ ...entry, documents })));

  const backingProjectId: BotService["Service"]["backingProjectId"] = projects
    .getByWorkspaceRoot(folders.root)
    .pipe(
      Effect.map(Option.match({ onNone: () => null, onSome: (project) => project.id })),
      Effect.catch((cause) =>
        Effect.logWarning("Couldn't look up the Bots project.", { cause }).pipe(Effect.as(null)),
      ),
    );

  const ensureBackingProject = Effect.fn("BotService.ensureBackingProject")(function* () {
    const id = yield* randomUuidV4;
    const bootstrapped = yield* projects
      .bootstrap({
        commandId: CommandId.make(`bots-project:${id}`),
        projectId: ProjectId.make(id),
        title: "Bots",
        workspaceRoot: folders.root,
      })
      .pipe(
        // bootstrap reads before locking; racing creates return the winner in a conflict.
        Effect.catchTags({
          ProjectConflictError: (conflict) =>
            Effect.succeed({ project: { id: conflict.conflictingProjectId } }),
        }),
        Effect.mapError(failed("Couldn't create the Bots project.")),
      );
    return bootstrapped.project.id;
  });

  const list: BotService["Service"]["list"] = Effect.fn("BotService.list")(function* (input) {
    const bots = yield* store
      .list({ includeArchived: input.includeArchived === true })
      .pipe(Effect.mapError(failed("Couldn't list Bots.")));
    const [entries, availableMcpServers] = yield* Effect.all(
      [Effect.forEach(bots, rosterEntry, { concurrency: 4 }), folders.listAvailableMcpServers],
      { concurrency: 2 },
    );
    return { bots: entries, availableMcpServers };
  });

  const subscribeList: BotService["Service"]["subscribeList"] = (input = {}) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading to buffer concurrent changes.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list(input)),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list(input))),
        );
      }),
    );

  const get: BotService["Service"]["get"] = Effect.fn("BotService.get")(function* (input) {
    return yield* detail(yield* requireBot(input.botId));
  });

  const getBySlug: BotService["Service"]["getBySlug"] = (slug) =>
    store.findBySlug(slug).pipe(Effect.mapError(failed("Couldn't read the Bot.")));

  const getByThreadId: BotService["Service"]["getByThreadId"] = (threadId) =>
    store.findByThreadId(threadId).pipe(Effect.mapError(failed("Couldn't read the Bot.")));

  const create: BotService["Service"]["create"] = Effect.fn("BotService.create")(function* (input) {
    const existing = yield* store
      .list({ includeArchived: true })
      .pipe(Effect.mapError(failed("Couldn't list Bots.")));
    const taken = new Set<string>(existing.map((bot) => bot.slug));
    if (input.slug !== undefined && taken.has(input.slug)) {
      return yield* new BotError({
        code: "slug_conflict",
        message: `A Bot with the slug "${input.slug}" already exists.`,
      });
    }
    const slug = input.slug ?? nextFreeSlug(slugifyBotName(input.name), taken);
    const role = input.role ?? "";
    const botId = BotId.make(yield* randomUuidV4);
    const now = yield* nowIso;

    const folderPath = yield* folders
      .ensure(slug)
      .pipe(Effect.mapError(failed("Couldn't create the Bot's folder.")));
    yield* Effect.all([
      folders.writeDocuments(slug, input.documents ?? {}, "replace"),
      folders.writeDocuments(
        slug,
        { soul: defaultSoul({ name: input.name, role }), memory: DEFAULT_MEMORY },
        "seed",
      ),
      folders.writeAgentsFile({ slug, name: input.name, role }),
    ]).pipe(Effect.mapError(failed("Couldn't write the Bot's documents.")));

    const projectId = yield* ensureBackingProject();
    const runtimeMode = input.runtimeMode ?? "full-access";
    const launched = yield* threadLaunch
      .launch({
        commandId: CommandId.make(`bot-create:${botId}`),
        projectId,
        title: input.name,
        modelSelection: input.modelSelection,
        runtimeMode,
        interactionMode: "default",
        workspaceStrategy: { type: "existing_worktree", worktreePath: folderPath },
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(Effect.mapError(failed("Couldn't start the Bot's thread.")));

    const bot: BotRecord = {
      id: botId,
      slug,
      name: input.name,
      role,
      groupName: input.groupName ?? null,
      icon: input.icon ?? BOT_DEFAULT_ICON,
      color: input.color ?? BOT_DEFAULT_COLOR,
      isPrimary: input.isPrimary ?? existing.length === 0,
      modelSelection: input.modelSelection,
      runtimeMode,
      tools: input.tools ?? [...BOT_DEFAULT_TOOLS],
      mcpServerNames: input.mcpServerNames ?? [],
      customMcpServers: input.customMcpServers ?? {},
      skills: input.skills ?? [],
      systemPromptMode: input.systemPromptMode ?? "custom",
      muted: false,
      threadId: launched.threadId,
      folderPath,
      hopCount: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    yield* store.insert(bot).pipe(Effect.mapError(failed("Couldn't save the Bot.")));
    yield* notifyChanged;
    return yield* detail(bot);
  }, createLock.withPermits(1));

  const update: BotService["Service"]["update"] = Effect.fn("BotService.update")(function* (input) {
    const { botId, muted, archived, documents, ...editable } = input;
    const bot = yield* requireBot(botId);
    const now = yield* nowIso;
    const next: BotRecord = {
      ...bot,
      ...editable,
      ...(muted === undefined ? {} : { muted }),
      archivedAt:
        archived === undefined ? bot.archivedAt : archived ? (bot.archivedAt ?? now) : null,
      updatedAt: now,
    };
    yield* Effect.all([
      documents === undefined
        ? Effect.void
        : folders.writeDocuments(bot.slug, documents, "replace"),
      folders.writeAgentsFile(next),
    ]).pipe(Effect.mapError(failed("Couldn't write the Bot's documents.")));

    const commandPrefix = `bot-update:${yield* randomUuidV4}`;
    const threadCommands = [
      ...(next.name === bot.name
        ? []
        : [
            {
              type: "thread.metadata.update" as const,
              commandId: CommandId.make(`${commandPrefix}:title`),
              threadId: bot.threadId,
              title: next.name,
            },
          ]),
      ...(editable.modelSelection === undefined
        ? []
        : [
            {
              type: "thread.model-selection.set" as const,
              commandId: CommandId.make(`${commandPrefix}:model`),
              threadId: bot.threadId,
              modelSelection: editable.modelSelection,
            },
          ]),
      ...(next.runtimeMode === bot.runtimeMode
        ? []
        : [
            {
              type: "thread.runtime-mode.set" as const,
              commandId: CommandId.make(`${commandPrefix}:runtime-mode`),
              threadId: bot.threadId,
              runtimeMode: next.runtimeMode,
            },
          ]),
    ];
    for (const command of threadCommands) {
      yield* threads
        .dispatch(command)
        .pipe(Effect.mapError(failed("Couldn't update the Bot's thread.")));
    }

    yield* store.update(next).pipe(Effect.mapError(failed("Couldn't save the Bot.")));
    yield* notifyChanged;
    return yield* detail(next);
  });

  const deleteBot: BotService["Service"]["delete"] = Effect.fn("BotService.delete")(
    function* (input) {
      const bot = yield* requireBot(input.botId);
      yield* store
        .delete(bot.id, yield* nowIso)
        .pipe(Effect.mapError(failed("Couldn't delete the Bot.")));
      yield* threads
        .dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`bot-delete:${bot.id}`),
          threadId: bot.threadId,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Deleted a Bot without archiving its thread.", {
              threadId: bot.threadId,
              cause,
            }),
          ),
        );
      yield* notifyChanged;
      return { botId: bot.id };
    },
  );

  const sendToBotThread = Effect.fn("BotService.sendToBotThread")(function* (input: {
    readonly bot: BotRecord;
    readonly commandId: CommandId;
    readonly messageId: MessageId;
    readonly senderThreadId: ThreadId;
    readonly text: string;
    readonly creationSource: "mcp" | "server";
  }) {
    const shell = yield* threads
      .getThreadShell(input.bot.threadId)
      .pipe(Effect.mapError(failed(`Couldn't read the thread of Bot "${input.bot.slug}".`)));
    if (shell === null) {
      return yield* new BotError({
        code: "operation_failed",
        message: `The thread of Bot "${input.bot.slug}" no longer exists.`,
      });
    }
    return yield* threads
      .sendToThread({
        projectId: shell.projectId,
        commandId: input.commandId,
        threadId: input.bot.threadId,
        messageId: input.messageId,
        senderThreadId: input.senderThreadId,
        text: input.text,
        attachments: [],
        mode: "queue",
        createdBy: "agent",
        creationSource: input.creationSource,
      })
      .pipe(Effect.mapError(failed(`Couldn't deliver the message to Bot "${input.bot.slug}".`)));
  });

  const sendMessage: BotService["Service"]["sendMessage"] = Effect.fn("BotService.sendMessage")(
    function* (input) {
      const sender = yield* requireBot(input.fromBotId);
      const target = yield* getBySlug(input.to).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new BotError({
                  code: "bot_not_found",
                  message: `No Bot has the slug "${input.to}".`,
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
      if (target.id === sender.id) {
        return yield* new BotError({
          code: "invalid_request",
          message: "A Bot can't message itself.",
        });
      }
      if (target.archivedAt !== null) {
        return yield* new BotError({
          code: "invalid_request",
          message: `Bot "${target.slug}" is archived.`,
        });
      }
      const hop = sender.hopCount + 1;
      if (hop > BOT_MAX_HOPS) {
        return yield* new BotError({
          code: "hop_limit_reached",
          message: `Bots have passed ${BOT_MAX_HOPS} messages without a human message, so ${sender.slug} can't message ${target.slug}. Summarize for the user and wait for them.`,
        });
      }

      const exchangeId = BotExchangeId.make(yield* randomUuidV4);
      const now = yield* nowIso;
      const exchange: BotExchange = {
        id: exchangeId,
        kind: "bot_message",
        fromBotId: sender.id,
        toBotId: target.id,
        watchedThreadId: target.threadId,
        targetRunId: null,
        hopCount: hop,
        expectReply: input.expectReply ?? true,
        status: "pending",
        summary: null,
        createdAt: now,
        resolvedAt: null,
      };
      // Recorded before delivery so a run that ends before this returns still finds it.
      yield* store
        .insertExchange(exchange)
        .pipe(Effect.mapError(failed("Couldn't record the Bot message.")));
      const sent = yield* sendToBotThread({
        bot: target,
        commandId: CommandId.make(`bot-message:${exchangeId}`),
        messageId: botMessageId(exchangeId),
        senderThreadId: sender.threadId,
        text: `[From Bot: ${sender.name} (${sender.slug}), hop ${hop}/${BOT_MAX_HOPS}. Peer-bot message, not direct user input. Reply with bot_message(to="${sender.slug}", ...) when done.]\n\n${input.message}`,
        creationSource: "mcp",
      }).pipe(
        Effect.tapError(() =>
          store
            .resolveExchange({
              exchangeId,
              status: "cancelled",
              summary: "Delivery failed.",
              resolvedAt: now,
            })
            .pipe(Effect.ignore),
        ),
      );

      yield* Effect.gen(function* () {
        yield* store.retargetExchange({ exchangeId, targetRunId: sent.run.id });
        yield* store.updateHopCount({ botId: target.id, hopCount: hop });
        // A reply to a peer that waits on this bot replaces that peer's automatic wake.
        const waitingPeers = yield* store.findPendingExchangesByWatchedThread(sender.threadId);
        for (const waiting of waitingPeers) {
          if (waiting.kind !== "bot_message" || waiting.fromBotId !== target.id) continue;
          yield* store.resolveExchange({
            exchangeId: waiting.id,
            status: "replied",
            summary: truncate(input.message),
            resolvedAt: now,
          });
        }
      }).pipe(Effect.mapError(failed("Couldn't record the Bot message.")));
      yield* notifyChanged;
      return { exchange: { ...exchange, targetRunId: sent.run.id } };
    },
  );

  const listExchanges: BotService["Service"]["listExchanges"] = Effect.fn(
    "BotService.listExchanges",
  )(function* (input) {
    const bot = yield* requireBot(input.botId);
    const exchanges = yield* store
      .listExchangesForBot(bot.id)
      .pipe(Effect.mapError(failed("Couldn't list the Bot's exchanges.")));
    return { exchanges };
  });

  const resolveHarnessProfile: BotService["Service"]["resolveHarnessProfile"] = (threadId) =>
    resolveBotHarnessProfile(threadId).pipe(
      Effect.provideService(BotStore.BotStore, store),
      Effect.provideService(BotFolders.BotFolders, folders),
    );

  const readOutcome = Effect.fn("BotService.readOutcome")(function* (
    threadId: ThreadId,
    runId: RunId,
    run: OrchestrationV2Run | null,
  ) {
    const records = yield* threads.getThreadRecords(
      threadId,
      ["messages", "turnItems", "runtimeRequests"],
      {
        messageRunIds: [runId],
        messageRoles: ["assistant"],
        turnItemRunIds: [runId],
        turnItemTypes: ["error"],
        runtimeRequestStatuses: ["pending"],
      },
    );
    const finalMessage = latestMessage(
      records.messages.filter(
        (message) =>
          message.role === "assistant" && message.runId === runId && message.text.trim() !== "",
      ),
    );
    return {
      title: records.thread.title,
      finalMessage: finalMessage === undefined ? null : truncate(finalMessage.text.trim()),
      error: latestRootProviderFailure(run, records.turnItems)?.message ?? null,
      pendingRequest:
        records.runtimeRequests.find((request) => request.status === "pending")?.kind ?? null,
      pullRequest:
        records.thread.linkedPullRequest?.url ?? records.thread.pullRequests?.at(-1)?.url ?? null,
    };
  });

  type Outcome = Effect.Success<ReturnType<typeof readOutcome>>;

  const outcomeBody = (outcome: Outcome, emptyText: string) =>
    [
      outcome.finalMessage ?? emptyText,
      outcome.error === null ? null : `Error: ${outcome.error}`,
      outcome.pendingRequest === null
        ? null
        : `Waiting on a ${outcome.pendingRequest} request; answer it with t3_pending_request.`,
      outcome.pullRequest === null ? null : `Pull request: ${outcome.pullRequest}`,
    ]
      .filter((line) => line !== null)
      .join("\n\n");

  const wakeForBotReply = Effect.fn("BotService.wakeForBotReply")(function* (
    exchange: BotExchange,
    runId: RunId,
    status: string,
    run: OrchestrationV2Run | null,
  ) {
    const now = yield* nowIso;
    const hop = exchange.hopCount + 1;
    if (hop > BOT_MAX_HOPS) {
      yield* store.resolveExchange({
        exchangeId: exchange.id,
        status: "cancelled",
        summary: "Hop limit reached, so the sender was not woken.",
        resolvedAt: now,
      });
      return;
    }
    const outcome = yield* readOutcome(exchange.watchedThreadId, runId, run);
    const claimed = yield* store.resolveExchange({
      exchangeId: exchange.id,
      status: "woken",
      summary: outcome.finalMessage,
      resolvedAt: now,
    });
    const [sender, target] = yield* Effect.all([
      store.get(exchange.fromBotId),
      exchange.toBotId === null ? Effect.succeedNone : store.get(exchange.toBotId),
    ]);
    if (!claimed || Option.isNone(sender) || Option.isNone(target)) return;
    yield* store.updateHopCount({ botId: sender.value.id, hopCount: hop });
    yield* sendToBotThread({
      bot: sender.value,
      commandId: CommandId.make(`bot-wake:${exchange.id}`),
      messageId: MessageId.make(`bot-wake:${exchange.id}`),
      senderThreadId: exchange.watchedThreadId,
      text: `[Bot reply from ${target.value.name} (${target.value.slug}), status: ${status}]\n\n${outcomeBody(outcome, "(No reply text.)")}`,
      creationSource: "server",
    });
  });

  const wakeForCodingThread = Effect.fn("BotService.wakeForCodingThread")(function* (
    exchange: BotExchange,
    runId: RunId,
    status: string,
    run: OrchestrationV2Run | null,
  ) {
    const outcome = yield* readOutcome(exchange.watchedThreadId, runId, run);
    const claimed = yield* store.resolveExchange({
      exchangeId: exchange.id,
      status: "woken",
      summary: outcome.finalMessage,
      resolvedAt: yield* nowIso,
    });
    const bot = yield* store.get(exchange.fromBotId);
    if (!claimed || Option.isNone(bot)) return;
    yield* sendToBotThread({
      bot: bot.value,
      commandId: CommandId.make(`bot-wake:${exchange.id}`),
      messageId: MessageId.make(`bot-wake:${exchange.id}`),
      senderThreadId: exchange.watchedThreadId,
      text: `[Coding thread update: ${outcome.title} (${exchange.watchedThreadId}), status: ${status}]\n\n${outcomeBody(outcome, "(No final message.)")}`,
      creationSource: "server",
    });
  });

  // The reactor sees every domain event; these handlers stay untraced and return before any read
  // for the common events they ignore.
  const onUserMessage = Effect.fnUntraced(function* (message: OrchestrationV2ConversationMessage) {
    if (message.createdBy === "user" && message.senderThreadId === undefined) {
      const bot = yield* store.findByThreadId(message.threadId);
      if (Option.isSome(bot) && bot.value.hopCount !== 0) {
        yield* store.updateHopCount({ botId: bot.value.id, hopCount: 0 });
        yield* notifyChanged;
      }
      return;
    }
    if (message.senderThreadId === undefined || message.runId === null) return;
    const sender = yield* store.findByThreadId(message.senderThreadId);
    if (Option.isNone(sender)) return;
    if (Option.isSome(yield* store.findByThreadId(message.threadId))) return;
    // delegate_task wakes its parent when the child ends, so a watch here would wake the bot twice.
    const shell = yield* threads.getThreadShell(message.threadId);
    if (shell?.lineage.relationshipToParent === "subagent") return;
    yield* store.insertExchange({
      id: BotExchangeId.make(yield* randomUuidV4),
      kind: "coding_thread",
      fromBotId: sender.value.id,
      toBotId: null,
      watchedThreadId: message.threadId,
      targetRunId: message.runId,
      hopCount: sender.value.hopCount,
      expectReply: true,
      status: "pending",
      summary: null,
      createdAt: yield* nowIso,
      resolvedAt: null,
    });
  });

  const notifyIfBotThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    if (Option.isSome(yield* store.findByThreadId(threadId))) yield* notifyChanged;
  });

  const onRunEnded = Effect.fnUntraced(function* (run: OrchestrationV2Run) {
    const pending = yield* store.findPendingExchangesByWatchedThread(run.threadId);
    if (pending.length === 0) return;
    const botMessages = pending.filter((exchange) => exchange.kind === "bot_message");
    const carriers =
      botMessages.length === 0
        ? new Map<MessageId, RunId | null>()
        : new Map(
            (yield* threads.getThreadRecords(run.threadId, ["messages"], {
              messageIds: botMessages.map((exchange) => botMessageId(exchange.id)),
            })).messages.map((message) => [message.id, message.runId] as const),
          );
    for (const exchange of pending) {
      if (exchange.kind === "coding_thread") {
        if (exchange.targetRunId === run.id) {
          yield* wakeForCodingThread(exchange, run.id, run.status, run);
        }
        continue;
      }
      const carrierRunId = carriers.get(botMessageId(exchange.id)) ?? exchange.targetRunId;
      if (carrierRunId !== run.id) {
        // A steer moved the message into the active run; wait for that run instead.
        if (carrierRunId !== null && carrierRunId !== exchange.targetRunId) {
          yield* store.retargetExchange({ exchangeId: exchange.id, targetRunId: carrierRunId });
        }
        continue;
      }
      if (exchange.expectReply) {
        yield* wakeForBotReply(exchange, run.id, run.status, run);
      } else {
        const outcome = yield* readOutcome(run.threadId, run.id, run);
        yield* store.resolveExchange({
          exchangeId: exchange.id,
          status: "replied",
          summary: outcome.finalMessage,
          resolvedAt: yield* nowIso,
        });
      }
    }
  });

  const onRequestPending = Effect.fnUntraced(function* (threadId: ThreadId, runId: RunId) {
    const pending = yield* store.findPendingExchangesByWatchedThread(threadId);
    for (const exchange of pending) {
      if (exchange.targetRunId !== runId) continue;
      if (exchange.kind === "coding_thread") {
        yield* wakeForCodingThread(exchange, runId, "waiting", null);
      } else if (exchange.expectReply) {
        yield* wakeForBotReply(exchange, runId, "waiting", null);
      }
    }
  });

  const handleEvent = Effect.fnUntraced(
    function* (event: OrchestrationV2DomainEvent) {
      switch (event.type) {
        case "message.updated":
          if (event.payload.role === "user") yield* onUserMessage(event.payload);
          return;
        case "run.updated":
          yield* notifyIfBotThread(event.payload.threadId);
          if (WAKING_RUN_STATUSES.has(event.payload.status)) yield* onRunEnded(event.payload);
          return;
        case "runtime-request.updated":
          if (event.payload.status !== "pending") return;
          yield* notifyIfBotThread(event.threadId);
          if (event.runId !== undefined) yield* onRequestPending(event.threadId, event.runId);
          return;
      }
    },
    (effect, event) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Bot reactor skipped an event.", { eventType: event.type, cause }),
        ),
      ),
  );

  const startReactor: BotService["Service"]["startReactor"] = Effect.fn("BotService.startReactor")(
    function* () {
      yield* forkParked(
        Stream.runForEach(threads.streamDomainEvents, handleEvent).pipe(
          Effect.catch((cause) => Effect.logError("Bot reactor stopped.", { cause })),
        ),
      );
    },
  );

  return BotService.of({
    backingProjectId,
    list,
    subscribeList,
    get,
    getBySlug,
    getByThreadId,
    create,
    update,
    delete: deleteBot,
    sendMessage,
    listExchanges,
    resolveHarnessProfile,
    startReactor,
  });
});

export const layer = Layer.effect(BotService, make);

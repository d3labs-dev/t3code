import {
  type BotAvailableMcpServer,
  type BotCodingThreadLink,
  type BotExchangeKind,
  type BotExchangeStatus,
  type BotId,
  type BotListResult,
  type BotRecord,
  type BotStatus,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { scopedProjectKey, scopedThreadKey } from "../environment/scoped.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createBotsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const botDetail = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:bots:detail",
    tag: WS_METHODS.botsGet,
  });
  const botExchanges = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:bots:exchanges",
    tag: WS_METHODS.botsListExchanges,
  });
  return {
    botsLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:bots:live",
      tag: WS_METHODS.botsSubscribe,
    }),
    botDetail,
    botExchanges,
    createBot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:create",
      tag: WS_METHODS.botsCreate,
    }),
    // The roster streams its changes, but a Bot's documents only come back from a fresh read.
    updateBot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:update",
      tag: WS_METHODS.botsUpdate,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(botDetail({ environmentId, input: { botId: input.botId } })),
        ),
    }),
    deleteBot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:delete",
      tag: WS_METHODS.botsDelete,
    }),
  };
}

export type ScopedBotEntry = {
  readonly environmentId: EnvironmentId;
  readonly bot: BotRecord;
  readonly status: BotStatus;
};

export type ScopedCodingThreadLink = {
  readonly environmentId: EnvironmentId;
  readonly link: BotCodingThreadLink;
};

export type ScopedCodingThreadSupervisor = {
  readonly botEntry: ScopedBotEntry;
  readonly link: BotCodingThreadLink;
};

/** A coding-thread exchange is the link through which a Bot watches a thread it messaged. */
export const BOT_EXCHANGE_STATUS_LABEL: {
  readonly [Kind in BotExchangeKind]: { readonly [Status in BotExchangeStatus]: string };
} = {
  coding_thread: {
    pending: "Watching",
    woken: "Update sent",
    replied: "Replied",
    cancelled: "Stopped watching",
  },
  bot_message: {
    pending: "Pending",
    woken: "Delivered",
    replied: "Replied",
    cancelled: "Cancelled",
  },
};

export interface BotsIndex {
  readonly bots: ReadonlyArray<ScopedBotEntry>;
  readonly botByThreadKey: ReadonlyMap<string, ScopedBotEntry>;
  readonly supervisorByCodingThreadKey: ReadonlyMap<string, ScopedCodingThreadSupervisor>;
  /** Keyed by `botKey`, newest link first. */
  readonly codingThreadsByBotKey: ReadonlyMap<string, ReadonlyArray<ScopedCodingThreadLink>>;
  /** Keyed by `projectKey`. */
  readonly backingProjectKeys: ReadonlySet<string>;
  readonly availableMcpServersByEnvironment: ReadonlyMap<
    EnvironmentId,
    ReadonlyArray<BotAvailableMcpServer>
  >;
  readonly activeCodingThreadCount: number;
}

export const botKey = (environmentId: EnvironmentId, botId: BotId): string =>
  `${environmentId}:${botId}`;

export const projectKey = (environmentId: EnvironmentId, projectId: ProjectId): string =>
  scopedProjectKey({ environmentId, projectId });

const isNewer = (left: BotCodingThreadLink, right: BotCodingThreadLink) =>
  left.createdAt > right.createdAt;

const newestFirst = (left: ScopedCodingThreadLink, right: ScopedCodingThreadLink) =>
  isNewer(left.link, right.link) ? -1 : isNewer(right.link, left.link) ? 1 : 0;

/**
 * Links whose Bot is missing from its environment's roster, or archived, are left out everywhere.
 * Archived Bots themselves stay indexed so their threads still resolve to a Bot.
 */
export function indexBotsAcrossEnvironments(
  entries: ReadonlyArray<readonly [EnvironmentId, BotListResult]>,
): BotsIndex {
  const bots: Array<ScopedBotEntry> = [];
  const botByKey = new Map<string, ScopedBotEntry>();
  const botByThreadKey = new Map<string, ScopedBotEntry>();
  const supervisorByCodingThreadKey = new Map<string, ScopedCodingThreadSupervisor>();
  const codingThreadsByBotKey = new Map<string, Array<ScopedCodingThreadLink>>();
  const backingProjectKeys = new Set<string>();
  const availableMcpServersByEnvironment = new Map<
    EnvironmentId,
    ReadonlyArray<BotAvailableMcpServer>
  >();
  let activeCodingThreadCount = 0;

  for (const [environmentId, result] of entries) {
    availableMcpServersByEnvironment.set(environmentId, result.availableMcpServers);
    if (result.backingProjectId !== null) {
      backingProjectKeys.add(projectKey(environmentId, result.backingProjectId));
    }
    for (const { bot, status } of result.bots) {
      const entry = { environmentId, bot, status };
      bots.push(entry);
      botByKey.set(botKey(environmentId, bot.id), entry);
      botByThreadKey.set(scopedThreadKey({ environmentId, threadId: bot.threadId }), entry);
    }
    for (const link of result.codingThreads) {
      const key = botKey(environmentId, link.botId);
      const botEntry = botByKey.get(key);
      if (botEntry === undefined || botEntry.bot.archivedAt !== null) continue;
      const scoped = { environmentId, link };
      const botLinks = codingThreadsByBotKey.get(key);
      if (botLinks === undefined) codingThreadsByBotKey.set(key, [scoped]);
      else botLinks.push(scoped);
      if (link.status === "pending") activeCodingThreadCount++;
      const threadKey = scopedThreadKey({ environmentId, threadId: link.threadId });
      const current = supervisorByCodingThreadKey.get(threadKey);
      if (current === undefined || isNewer(link, current.link)) {
        supervisorByCodingThreadKey.set(threadKey, { botEntry, link });
      }
    }
  }
  for (const links of codingThreadsByBotKey.values()) links.sort(newestFirst);

  return {
    bots,
    botByThreadKey,
    supervisorByCodingThreadKey,
    codingThreadsByBotKey,
    backingProjectKeys,
    availableMcpServersByEnvironment,
    activeCodingThreadCount,
  };
}

/**
 * Drops Bot threads and the backing project's threads, which belong to Bots mode. Coding threads
 * a Bot starts live in real projects and stay. Returns the same array when nothing is dropped.
 */
export function withoutBotsModeThreads<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly id: ThreadId;
  },
>(threads: ReadonlyArray<T>, index: BotsIndex): ReadonlyArray<T> {
  if (index.bots.length === 0 && index.backingProjectKeys.size === 0) return threads;
  const kept = threads.filter(
    (thread) =>
      !index.backingProjectKeys.has(projectKey(thread.environmentId, thread.projectId)) &&
      !index.botByThreadKey.has(
        scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      ),
  );
  return kept.length === threads.length ? threads : kept;
}

export interface BotSidebarGroup {
  readonly name: string | null;
  readonly bots: ReadonlyArray<ScopedBotEntry>;
}

export interface BotSidebar {
  readonly primary: ScopedBotEntry | null;
  readonly groups: ReadonlyArray<BotSidebarGroup>;
}

/** Archived Bots stay out; named groups sort by name and ungrouped Bots come last. */
export function groupBotsForSidebar(bots: ReadonlyArray<ScopedBotEntry>): BotSidebar {
  const active = bots.filter(({ bot }) => bot.archivedAt === null);
  const primary = active.find(({ bot }) => bot.isPrimary) ?? null;
  const byGroup = new Map<string | null, Array<ScopedBotEntry>>();
  for (const entry of active) {
    if (entry === primary) continue;
    const group = byGroup.get(entry.bot.groupName);
    if (group === undefined) byGroup.set(entry.bot.groupName, [entry]);
    else group.push(entry);
  }
  const groups = [...byGroup]
    .map(([name, members]) => ({ name, bots: members }))
    .sort((left, right) => {
      if (left.name === null) return right.name === null ? 0 : 1;
      if (right.name === null) return -1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
  return { primary, groups };
}

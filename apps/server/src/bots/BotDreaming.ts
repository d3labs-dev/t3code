import { type BotRecord, isCompactionCommandMessage } from "@t3tools/contracts";
import { isServerBotDreamingMessage } from "@t3tools/shared/botDreaming";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";

import type { IdleCompactionRecords } from "../orchestration-v2/IdleCompaction.ts";

export const BOT_DREAMING_MIN_TOKENS = 80_000;
export const BOT_DREAMING_FALLBACK_TURNS = 16;
// Without native compaction the context stays large after a dream, so tokens alone would re-dream every idle spell.
export const BOT_DREAMING_NON_COMPACT_COOLDOWN_TURNS = 12;
export const BOT_DREAMING_IDLE_DELAY_MS = 15 * 60_000;
// Twice idle compaction's lead: the dream finishes and its `/compact` still lands on a warm cache.
export const BOT_DREAMING_CACHE_LEAD_MS = 4 * 60_000;

export type BotDreamingRecords = IdleCompactionRecords;
type BotDreamingRun = BotDreamingRecords["runs"][number];

export type BotDreamingAction =
  | { readonly kind: "dream"; readonly runId: BotDreamingRun["id"]; readonly startMs: number }
  | { readonly kind: "compact_after_dream"; readonly runId: BotDreamingRun["id"] };

// Drivers whose `/compact` turn reaches the provider's own compaction.
const NATIVE_COMPACTION_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

/**
 * What an idle Bot thread should do next: consolidate its memory files, compact natively right
 * after a consolidation, or nothing. Claude consolidates only while its prompt cache is warm.
 */
export function botDreamingAction(
  {
    thread,
    runs,
    messages,
    providerThreads,
    providerTurns,
    runtimeRequests,
    turnItems,
    contextTransfers,
  }: BotDreamingRecords,
  bot: Pick<BotRecord, "archivedAt" | "muted">,
  options: { readonly hasPendingBotExchanges: boolean },
  nowMs: number,
): BotDreamingAction | null {
  if (bot.archivedAt !== null || bot.muted) return null;
  if (thread.deletedAt !== null || thread.archivedAt !== null) return null;
  // A removed or steered queued message leaves a cancelled run that never started.
  const startedRuns = runs
    .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
    .toSorted((left, right) => right.ordinal - left.ordinal);
  const latestRun = startedRuns[0];
  if (latestRun?.status !== "completed" || latestRun.completedAt === null) return null;
  if (
    options.hasPendingBotExchanges ||
    runtimeRequests.some((request) => request.status === "pending") ||
    contextTransfers.some(
      (transfer) => transfer.targetThreadId === thread.id && transfer.status === "pending",
    ) ||
    derivePendingBackgroundWork({
      latestRun,
      runs,
      providerThreads,
      turnItems,
      activeProviderThreadId: thread.activeProviderThreadId,
    }).length > 0
  )
    return null;
  const messageById = new Map(messages.map((message) => [message.id, message] as const));
  const isMaintenanceRun = (run: BotDreamingRun) => {
    const message = messageById.get(run.userMessageId);
    return (
      message !== undefined &&
      (isCompactionCommandMessage(message) || isServerBotDreamingMessage(message))
    );
  };
  const latestMessage = messageById.get(latestRun.userMessageId);
  if (latestMessage === undefined || isCompactionCommandMessage(latestMessage)) return null;
  const providerThread = providerThreads.find(
    (candidate) => candidate.id === thread.activeProviderThreadId,
  );
  // The thread's current selection receives the next turn, so it must still be this session.
  if (
    providerThread === undefined ||
    providerThread.id !== latestRun.providerThreadId ||
    providerThread.providerInstanceId !== thread.providerInstanceId ||
    latestRun.providerInstanceId !== thread.providerInstanceId
  )
    return null;
  const driver = providerThread.driver;
  const usage = providerTurns
    .filter((turn) => turn.providerThreadId === providerThread.id && turn.tokenUsage !== undefined)
    .map((turn) => turn.tokenUsage!)
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  // A fully cached request reports no TTL; without one Claude could pay a cold read.
  const cacheExpiresAt = usage?.promptCacheExpiresAt;
  const cacheExpiryMs = cacheExpiresAt === undefined ? Number.NaN : Date.parse(cacheExpiresAt);
  const claudeCacheWarm = Number.isFinite(cacheExpiryMs) && nowMs < cacheExpiryMs;
  if (isServerBotDreamingMessage(latestMessage)) {
    return NATIVE_COMPACTION_DRIVERS.has(driver) && (driver !== "claudeAgent" || claudeCacheWarm)
      ? { kind: "compact_after_dream", runId: latestRun.id }
      : null;
  }
  const largeContext = (usage?.usedTokens ?? 0) >= BOT_DREAMING_MIN_TOKENS;
  if (driver === "claudeAgent") {
    if (!largeContext || !claudeCacheWarm) return null;
    return {
      kind: "dream",
      runId: latestRun.id,
      startMs: Math.max(cacheExpiryMs - BOT_DREAMING_CACHE_LEAD_MS, nowMs),
    };
  }
  const lastMaintenanceIndex = startedRuns.findIndex(isMaintenanceRun);
  const turnsSinceMaintenance = (
    lastMaintenanceIndex === -1 ? startedRuns : startedRuns.slice(0, lastMaintenanceIndex)
  ).filter((run) => run.status === "completed").length;
  if (!largeContext && turnsSinceMaintenance < BOT_DREAMING_FALLBACK_TURNS) return null;
  if (
    !NATIVE_COMPACTION_DRIVERS.has(driver) &&
    lastMaintenanceIndex !== -1 &&
    turnsSinceMaintenance < BOT_DREAMING_NON_COMPACT_COOLDOWN_TURNS
  )
    return null;
  return {
    kind: "dream",
    runId: latestRun.id,
    startMs: DateTime.toEpochMillis(latestRun.completedAt) + BOT_DREAMING_IDLE_DELAY_MS,
  };
}

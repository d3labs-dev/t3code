import type {
  BotDocuments,
  BotProactiveConfig,
  BotRecord,
  ModelSelection,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;
// Option ids that pick a provider's reasoning depth: Claude, Codex, an ACP agent such as
// Antigravity, and OpenCode. A scout only reads, so medium is plenty.
const REASONING_OPTION_IDS: ReadonlySet<string> = new Set([
  "effort",
  "reasoningEffort",
  "thought_level",
  "variant",
]);

export type BotHeartbeatMainThreadRecords = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "providerThreads" | "runtimeRequests" | "turnItems" | "contextTransfers"
>;

type ActiveHours = Pick<BotProactiveConfig, "activeHoursStart" | "activeHoursEnd" | "timezone">;

const clockMinutes = (clock: string) => {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours! % 24) * 60 + minutes!;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string) => {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    formatter = formatterFor("UTC");
  }
  formatters.set(timeZone, formatter);
  return formatter;
};

const localMinutes = (timeZone: string, atMs: number) => {
  const parts = formatterFor(timeZone).formatToParts(atMs);
  const part = (type: "hour" | "minute") =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? "0");
  return (part("hour") % 24) * 60 + part("minute");
};

/** Whether `nowMs` falls inside the window in the Bot's timezone; the window may wrap midnight. */
export function isWithinActiveHours(config: ActiveHours, nowMs: number): boolean {
  const start = clockMinutes(config.activeHoursStart);
  const end = clockMinutes(config.activeHoursEnd);
  if (start === end) return true;
  const now = localMinutes(config.timezone, nowMs);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * When the next check-in may run: one interval after the last attempt, or after now on startup so
 * a restart never checks in straight away, then moved to the next active minute.
 */
export function nextHeartbeatAtMs(input: {
  readonly config: BotProactiveConfig;
  readonly lastAttemptAtMs: number | null;
  readonly nowMs: number;
}): number {
  const intervalMs = input.config.intervalMinutes * MINUTE_MS;
  const dueMs =
    input.lastAttemptAtMs === null
      ? input.nowMs + intervalMs
      : Math.max(input.lastAttemptAtMs + intervalMs, input.nowMs);
  if (isWithinActiveHours(input.config, dueMs)) return dueMs;
  // Minute steps stay correct across DST shifts; a day and a half covers any window.
  const firstMinuteMs = Math.ceil(dueMs / MINUTE_MS) * MINUTE_MS;
  for (let step = 0; step <= MINUTES_PER_DAY * 1.5; step += 1) {
    const candidateMs = firstMinuteMs + step * MINUTE_MS;
    if (isWithinActiveHours(input.config, candidateMs)) return candidateMs;
  }
  return dueMs;
}

/** The Bot's own model with its reasoning dialed to medium where the Bot picked one. */
export function scoutModelSelectionFor(selection: ModelSelection): ModelSelection {
  if (selection.options === undefined) return selection;
  return {
    ...selection,
    options: selection.options.map((option) =>
      REASONING_OPTION_IDS.has(option.id) && typeof option.value === "string"
        ? { id: option.id, value: "medium" }
        : option,
    ),
  };
}

/** Whether the primary Bot should run a background check now; idle and quiet means skip. */
export function shouldRunBotHeartbeatScout(input: {
  readonly bot: Pick<BotRecord, "isPrimary" | "proactive" | "muted" | "archivedAt">;
  readonly mainThreadRecords: BotHeartbeatMainThreadRecords;
  readonly scoutThreadBusy: boolean;
  readonly hasPendingBotExchanges: boolean;
  readonly documents: Pick<BotDocuments, "now" | "heartbeat">;
  readonly nowMs: number;
}): boolean {
  const { bot, mainThreadRecords: records } = input;
  if (!bot.isPrimary || !bot.proactive.enabled || bot.muted || bot.archivedAt !== null) {
    return false;
  }
  if (!isWithinActiveHours(bot.proactive, input.nowMs)) return false;
  if (input.documents.now.trim() === "" && input.documents.heartbeat.trim() === "") return false;
  if (input.scoutThreadBusy || input.hasPendingBotExchanges) return false;
  if (records.thread.deletedAt !== null || records.thread.archivedAt !== null) return false;
  const latestRun = records.runs.toSorted((left, right) => right.ordinal - left.ordinal)[0];
  return !(
    records.runs.some(
      (run) =>
        run.status === "queued" ||
        run.status === "preparing" ||
        run.status === "starting" ||
        run.status === "running" ||
        run.status === "waiting",
    ) ||
    records.runtimeRequests.some((request) => request.status === "pending") ||
    records.contextTransfers.some(
      (transfer) => transfer.targetThreadId === records.thread.id && transfer.status === "pending",
    ) ||
    derivePendingBackgroundWork({
      latestRun,
      runs: records.runs,
      providerThreads: records.providerThreads,
      turnItems: records.turnItems,
      activeProviderThreadId: records.thread.activeProviderThreadId,
    }).length > 0
  );
}

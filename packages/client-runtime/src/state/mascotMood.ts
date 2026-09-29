// @effect-diagnostics globalDate:off -- "Finished today" counts by the local calendar day.
import type { DesktopMascotMood } from "@t3tools/contracts";

import { type EnvironmentThreadShell, resolveThreadWorkingStartedAt } from "./models.ts";
import { effectiveSnoozed } from "./threadSettled.ts";

const MINUTE_MS = 60 * 1000;
const STUCK_AFTER_MS = 20 * MINUTE_MS;
const URGENT_AT_WAITING_THREADS = 2;
const JUGGLING_AT_WORKING_THREADS = 2;
const CELEBRATE_AT_THREADS_FINISHED_TODAY = 5;
const BORED_AFTER_MS = 30 * MINUTE_MS;
const GRUMPY_AFTER_MS = 2 * 60 * MINUTE_MS;

export type MascotThread = Pick<
  EnvironmentThreadShell,
  | "archivedAt"
  | "settledOverride"
  | "snoozedUntil"
  | "snoozedAt"
  | "latestUserMessageAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "latestRun"
  | "runtime"
> & {
  /** When this client last showed the thread; undefined when it never has. */
  readonly lastVisitedAt: string | undefined;
};

type ThreadStatus = "approval" | "input" | "working" | "waiting" | "failed" | "limited" | "ready";

/** Mirrors the web sidebar's `resolveSidebarThreadStatus`. */
function threadStatus(thread: MascotThread): ThreadStatus {
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  switch (thread.runtime?.status) {
    case "preparing":
    case "queued":
    case "starting":
    case "running":
    case "waiting":
      return "working";
    case "idle":
      return "waiting";
    case "failed":
      return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
    default:
      return "ready";
  }
}

/** The first candidate that parses, in epoch ms; 0 when none does. */
function firstValidTimestampMs(...candidates: ReadonlyArray<string | null | undefined>): number {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function hasUnseenCompletion(thread: MascotThread): boolean {
  const completedAt = firstValidTimestampMs(thread.latestRun?.completedAt);
  if (completedAt === 0 || !thread.lastVisitedAt) return false;
  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  return Number.isNaN(lastVisitedAt) || completedAt > lastVisitedAt;
}

function hasUnseenFailure(thread: MascotThread, status: ThreadStatus): boolean {
  if (status !== "failed") return false;
  if (thread.lastVisitedAt === undefined) return true;
  return (
    firstValidTimestampMs(thread.latestRun?.completedAt) >
    firstValidTimestampMs(thread.lastVisitedAt)
  );
}

function lastActivityMs(thread: MascotThread): number {
  return Math.max(
    firstValidTimestampMs(thread.latestRun?.completedAt),
    firstValidTimestampMs(thread.latestRun?.startedAt),
    firstValidTimestampMs(thread.latestRun?.requestedAt),
    firstValidTimestampMs(thread.latestUserMessageAt),
  );
}

function isSameLocalDay(leftMs: number, rightMs: number): boolean {
  return new Date(leftMs).toDateString() === new Date(rightMs).toDateString();
}

/** The D3 cat's mood for the state of every thread; earlier checks win. */
export function resolveMascotMood(input: {
  readonly threads: ReadonlyArray<MascotThread>;
  readonly nowMs: number;
}): DesktopMascotMood {
  const now = new Date(input.nowMs).toISOString();
  const threads = input.threads.filter((thread) => thread.archivedAt === null);
  if (threads.length === 0) return "default";
  const active = threads.filter((thread) => !effectiveSnoozed(thread, { now }));
  const statuses = active.map((thread) => ({ thread, status: threadStatus(thread) }));

  const waiting = statuses.filter(({ status }) => status === "approval" || status === "input");
  if (
    waiting.length >= URGENT_AT_WAITING_THREADS ||
    statuses.some(({ thread, status }) => hasUnseenFailure(thread, status))
  ) {
    return "urgent";
  }
  if (waiting.length > 0) return "waiting";

  const working = statuses.filter(({ status }) => status === "working");
  if (working.length > 0) {
    const stuck = working.some(({ thread }) => {
      const startedAt = firstValidTimestampMs(resolveThreadWorkingStartedAt(thread));
      return startedAt > 0 && input.nowMs - startedAt > STUCK_AFTER_MS;
    });
    if (stuck) return "confused";
    return working.length >= JUGGLING_AT_WORKING_THREADS ? "juggling" : "thinking";
  }

  if (active.some(hasUnseenCompletion)) return "excited";

  const finishedToday = threads.filter((thread) => {
    const completedAt = firstValidTimestampMs(thread.latestRun?.completedAt);
    return completedAt > 0 && isSameLocalDay(completedAt, input.nowMs);
  }).length;
  if (finishedToday >= CELEBRATE_AT_THREADS_FINISHED_TODAY) return "celebrating";

  const idleMs = input.nowMs - Math.max(0, ...threads.map(lastActivityMs));
  if (idleMs > GRUMPY_AFTER_MS) return "grumpy";
  if (idleMs > BORED_AFTER_MS) return "bored";

  if (active.every((thread) => thread.settledOverride === "settled")) return "sleeping";
  return "default";
}

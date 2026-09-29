import type { DesktopMascotMood } from "@t3tools/contracts";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import {
  firstValidTimestampMs,
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveWorkingStartedAt,
} from "./components/Sidebar.logic";
import type { SidebarThreadSummary } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const STUCK_AFTER_MS = 45 * 60 * 1000;
const URGENT_AT_WAITING_THREADS = 3;
const JUGGLING_AT_WORKING_THREADS = 3;
const CELEBRATE_AT_THREADS_FINISHED_TODAY = 10;
const BORED_AFTER_MS = 2 * HOUR_MS;
const GRUMPY_AFTER_MS = 6 * HOUR_MS;

export interface MascotThread extends Omit<SidebarThreadSummary, "lastVisitedAt"> {
  readonly lastVisitedAt: string | undefined;
}

function hasUnseenFailure(thread: MascotThread, status: string): boolean {
  const failedAt =
    status === "failed" ? firstValidTimestampMs(thread.latestRun?.completedAt) : null;
  if (failedAt === null) return false;
  if (thread.lastVisitedAt === undefined) return true;
  return failedAt > firstValidTimestampMs(thread.lastVisitedAt);
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

/** The Dock mascot for the state of every thread; earlier checks win. */
export function resolveMascotMood(input: {
  readonly threads: ReadonlyArray<MascotThread>;
  readonly nowMs: number;
}): DesktopMascotMood {
  const now = new Date(input.nowMs).toISOString();
  const threads = input.threads.filter((thread) => thread.archivedAt === null);
  if (threads.length === 0) return "default";
  const active = threads.filter((thread) => !effectiveSnoozed(thread, { now }));
  const statuses = active.map((thread) => ({ thread, status: resolveSidebarThreadStatus(thread) }));

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
      const startedAt = firstValidTimestampMs(resolveWorkingStartedAt(thread));
      return startedAt > 0 && input.nowMs - startedAt > STUCK_AFTER_MS;
    });
    if (stuck) return "confused";
    return working.length >= JUGGLING_AT_WORKING_THREADS ? "juggling" : "thinking";
  }

  if (active.some((thread) => hasUnseenCompletion(thread))) return "excited";

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

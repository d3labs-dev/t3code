// @effect-diagnostics globalDate:off -- Fixtures build ISO timestamps relative to a fixed now.
import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, RunId } from "@t3tools/contracts";

import { type MascotThread, resolveMascotMood } from "./mascotMood.ts";
import type { ThreadRunSummary, ThreadRuntimeSummary } from "./models.ts";

const NOW = Date.parse("2026-09-24T15:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function makeThread(overrides: Partial<MascotThread> = {}): MascotThread {
  return {
    archivedAt: null,
    settledOverride: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt: minutesAgo(30),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestRun: null,
    runtime: null,
    lastVisitedAt: minutesAgo(1),
    ...overrides,
  };
}

function run(overrides: Partial<ThreadRunSummary>): ThreadRunSummary {
  return {
    runId: RunId.make("run-1"),
    status: "completed",
    requestedAt: minutesAgo(30),
    startedAt: minutesAgo(30),
    completedAt: minutesAgo(20),
    assistantMessageId: null,
    ...overrides,
  };
}

function runtime(status: ThreadRuntimeSummary["status"], minutes: number): ThreadRuntimeSummary {
  const active = status === "running";
  return {
    status,
    activeRunId: active ? RunId.make("run-1") : null,
    activityStartedAt: active ? minutesAgo(minutes) : null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: null,
    lastError: null,
    updatedAt: minutesAgo(minutes),
  };
}

const running = (startedMinutesAgo: number) =>
  makeThread({
    runtime: runtime("running", startedMinutesAgo),
    latestRun: run({
      status: "running",
      startedAt: minutesAgo(startedMinutesAgo),
      completedAt: null,
    }),
  });

const failed = (input: { readonly failedMinutesAgo: number; readonly visitedMinutesAgo: number }) =>
  makeThread({
    runtime: runtime("failed", input.failedMinutesAgo),
    latestRun: run({ status: "failed", completedAt: minutesAgo(input.failedMinutesAgo) }),
    lastVisitedAt: minutesAgo(input.visitedMinutesAgo),
  });

const mood = (...threads: MascotThread[]) => resolveMascotMood({ threads, nowMs: NOW });

describe("resolveMascotMood", () => {
  it("treats an unseen failure as urgent, above everything else", () => {
    const unseen = failed({ failedMinutesAgo: 5, visitedMinutesAgo: 10 });
    expect(mood(unseen, makeThread({ hasPendingUserInput: true }), running(1))).toBe("urgent");
  });

  it("forgets a failure once the thread was visited after it", () => {
    expect(mood(failed({ failedMinutesAgo: 5, visitedMinutesAgo: 1 }))).toBe("default");
  });

  it("waits on one question and turns urgent at two", () => {
    const asking = () => makeThread({ hasPendingApprovals: true });
    expect(mood(asking(), running(1))).toBe("waiting");
    expect(mood(asking(), asking())).toBe("urgent");
  });

  it("thinks while an agent works, juggles two at once, and looks confused once one runs long", () => {
    expect(mood(running(5))).toBe("thinking");
    expect(mood(running(5), running(5))).toBe("juggling");
    expect(mood(running(5), running(25))).toBe("confused");
    expect(mood(makeThread({ runtime: runtime("queued", 1) }))).toBe("thinking");
  });

  it("gets excited about a finished run the user has not opened", () => {
    expect(mood(makeThread({ latestRun: run({}), lastVisitedAt: minutesAgo(25) }))).toBe("excited");
  });

  it("celebrates five threads finished today only while nothing is working", () => {
    const done = Array.from({ length: 5 }, () => makeThread({ latestRun: run({}) }));
    expect(mood(...done)).toBe("celebrating");
    expect(mood(...done, running(5))).toBe("thinking");
    expect(mood(...done.slice(1))).toBe("default");
  });

  it("gets bored after half an idle hour and grumpy after two hours", () => {
    const idleFor = (minutes: number) =>
      makeThread({
        latestUserMessageAt: minutesAgo(minutes),
        latestRun: run({
          requestedAt: minutesAgo(minutes),
          startedAt: minutesAgo(minutes),
          completedAt: minutesAgo(minutes),
        }),
      });
    expect(mood(idleFor(20))).toBe("default");
    expect(mood(idleFor(45))).toBe("bored");
    expect(mood(idleFor(3 * 60))).toBe("grumpy");
  });

  it("sleeps when every thread is settled or snoozed", () => {
    expect(
      mood(
        makeThread({ settledOverride: "settled" }),
        makeThread({ snoozedUntil: minutesAgo(-60), snoozedAt: minutesAgo(10) }),
      ),
    ).toBe("sleeping");
  });

  it("ignores archived threads and starts at the everyday look", () => {
    expect(mood()).toBe("default");
    expect(mood(makeThread({ archivedAt: minutesAgo(1), hasPendingUserInput: true }))).toBe(
      "default",
    );
  });
});

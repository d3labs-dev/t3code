import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";

import { type MascotThread, resolveMascotMood } from "./mascotMood";
import { makeThreadFixture, type ThreadFixtureOverrides } from "./test-fixtures";
import type { ThreadRunSummary, ThreadRuntimeSummary } from "@t3tools/client-runtime/state/shell";

const NOW = Date.parse("2026-09-24T15:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

let nextId = 0;
function makeThread({
  lastVisitedAt = minutesAgo(1),
  ...overrides
}: Omit<ThreadFixtureOverrides, "lastVisitedAt"> & {
  readonly lastVisitedAt?: string;
} = {}): MascotThread {
  nextId += 1;
  return {
    ...makeThreadFixture({
      id: ThreadId.make(`thread-${nextId}`),
      environmentId: EnvironmentId.make("environment-local"),
      projectId: ProjectId.make("project-1"),
      latestUserMessageAt: minutesAgo(30),
      ...overrides,
    }),
    lastVisitedAt,
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

  it("waits on one question and turns urgent at three", () => {
    const asking = () => makeThread({ hasPendingApprovals: true });
    expect(mood(asking(), running(1))).toBe("waiting");
    expect(mood(asking(), asking(), asking())).toBe("urgent");
  });

  it("thinks while agents work, juggles three at once, and looks confused once one runs long", () => {
    expect(mood(running(5), running(5))).toBe("thinking");
    expect(mood(running(5), running(5), running(5))).toBe("juggling");
    expect(mood(running(5), running(5), running(60))).toBe("confused");
  });

  it("gets excited about a finished turn the user has not opened", () => {
    expect(mood(makeThread({ latestRun: run({}), lastVisitedAt: minutesAgo(25) }))).toBe("excited");
  });

  it("celebrates ten threads finished today only while nothing is working", () => {
    const done = Array.from({ length: 10 }, () => makeThread({ latestRun: run({}) }));
    expect(mood(...done)).toBe("celebrating");
    expect(mood(...done, running(5))).toBe("thinking");
    expect(mood(...done.slice(1))).toBe("default");
  });

  it("gets bored after two idle hours and grumpy after six", () => {
    const idleFor = (minutes: number) =>
      makeThread({
        latestUserMessageAt: minutesAgo(minutes),
        latestRun: run({
          requestedAt: minutesAgo(minutes),
          startedAt: minutesAgo(minutes),
          completedAt: minutesAgo(minutes),
        }),
      });
    expect(mood(idleFor(90))).toBe("default");
    expect(mood(idleFor(3 * 60))).toBe("bored");
    expect(mood(idleFor(7 * 60))).toBe("grumpy");
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

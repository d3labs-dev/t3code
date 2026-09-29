import type {
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { deliveryForDevice, fitPushData, makeAggregateState } from "./serverPushPayloads.ts";

const nowMs = Date.parse("2026-09-29T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(nowMs - minutes * 60_000));

const allOn: RelayAgentAwarenessPreferences = {
  liveActivitiesEnabled: true,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

function threadState(
  threadId: string,
  phase: RelayAgentActivityState["phase"],
  updatedAt = minutesAgo(0),
): RelayAgentActivityState {
  return {
    environmentId: "env" as RelayAgentActivityState["environmentId"],
    threadId: threadId as RelayAgentActivityState["threadId"],
    projectTitle: "T3 Code",
    threadTitle: `Task ${threadId}`,
    modelTitle: "gpt-5.4",
    phase,
    headline: phase,
    updatedAt,
    deepLink: `/threads/env/${threadId}`,
  };
}

function deliver(input: {
  readonly before: ReadonlyArray<RelayAgentActivityState> | null;
  readonly after: ReadonlyArray<RelayAgentActivityState>;
  readonly changed: RelayAgentActivityState | null;
  readonly preferences?: RelayAgentAwarenessPreferences;
}) {
  return deliveryForDevice({
    deviceId: "device",
    userId: "server-push",
    preferences: input.preferences ?? allOn,
    previousAggregate:
      input.before === null ? null : makeAggregateState({ states: input.before, nowMs }),
    aggregate: makeAggregateState({ states: input.after, nowMs }),
    changedState: input.changed,
    nowMs,
  });
}

describe("deliveryForDevice", () => {
  it("alerts once when a running thread starts waiting for approval", () => {
    const running = threadState("a", "running");
    const waiting = threadState("a", "waiting_for_approval");

    const first = deliver({ before: [running], after: [waiting], changed: waiting });
    expect(first?.data).toMatchObject({
      t3_kind: "agent_activity",
      device_id: "device",
      user_id: "server-push",
      alert_title: "Task a",
      alert_body: "Approval: T3 Code",
      alert_path: "/threads/env/a",
      active: "true",
      activity_chip: "Review",
    });

    const repeat = deliver({ before: [waiting], after: [waiting], changed: waiting });
    expect(repeat?.data.alert_id).toBeUndefined();
    expect(repeat?.data.active).toBe("true");
  });

  it("groups threads that need attention at the same time", () => {
    const before = [threadState("a", "running"), threadState("b", "running")];
    const after = [threadState("a", "waiting_for_input"), threadState("b", "waiting_for_approval")];

    const delivery = deliver({ before, after, changed: after[0]! });
    expect(delivery?.data.alert_title).toBe("2 agents need attention");
    expect(delivery?.data.alert_body).toBe("Task a, Task b");
  });

  it("alerts for a fresh completion but not one older than two minutes", () => {
    const running = threadState("a", "running", minutesAgo(10));
    const done = threadState("a", "completed");
    expect(deliver({ before: [running], after: [done], changed: done })?.data).toMatchObject({
      alert_body: "Done: T3 Code",
      active: "false",
      activity_title: "Agent work completed",
    });

    const late = threadState("a", "completed", minutesAgo(3));
    expect(deliver({ before: [running], after: [late], changed: late })?.data.alert_id).toBe(
      undefined,
    );
  });

  it("honors the phone's per-phase and notification switches", () => {
    const running = threadState("a", "running");
    const failed = threadState("a", "failed");
    expect(
      deliver({
        before: [running],
        after: [failed],
        changed: failed,
        preferences: { ...allOn, notifyOnFailure: false },
      })?.data.alert_id,
    ).toBeUndefined();
    expect(
      deliver({
        before: [running],
        after: [failed],
        changed: failed,
        preferences: { ...allOn, notificationsEnabled: false },
      })?.data,
    ).toMatchObject({ active: "false", activity_expires_at: "0" });
  });

  it("alerts from the thread state alone before the phone has a card", () => {
    const waiting = threadState("a", "waiting_for_input");
    expect(deliver({ before: null, after: [waiting], changed: waiting })?.data.alert_body).toBe(
      "Input: T3 Code",
    );
  });

  it("stays silent when the phone has nothing to show or clear", () => {
    expect(deliver({ before: null, after: [], changed: null })).toBeNull();
    expect(
      deliver({
        before: null,
        after: [threadState("a", "running")],
        changed: threadState("a", "running"),
        preferences: { ...allOn, liveActivitiesEnabled: false },
      }),
    ).toBeNull();
  });

  it("clears a delivered card once the last thread goes away", () => {
    const delivery = deliver({ before: [threadState("a", "running")], after: [], changed: null });
    expect(delivery?.data).toMatchObject({ active: "false", activity_expires_at: "0" });
    expect(delivery?.baseline).toBeNull();
  });
});

describe("makeAggregateState", () => {
  it("drops running rows after two hours and keeps recent finishes beside live work", () => {
    const aggregate = makeAggregateState({
      states: [
        threadState("stuck", "running", minutesAgo(121)),
        threadState("live", "running"),
        threadState("done", "completed", minutesAgo(5)),
        threadState("old", "completed", minutesAgo(16)),
      ],
      nowMs,
    });
    expect(aggregate?.activeCount).toBe(1);
    expect(aggregate?.activities.map((row) => row.threadId)).toEqual(["live", "done"]);
  });
});

describe("fitPushData", () => {
  it("shortens the longest texts until the payload fits Expo's budget", () => {
    const data = fitPushData({
      t3_kind: "agent_activity",
      alert_title: "🙂".repeat(2_000),
      activity_line_0: `Working\t${"x".repeat(2_000)}\tProject`,
    });
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(3_500);
    expect(data.t3_kind).toBe("agent_activity");
    expect(data.activity_line_0?.split("\t")).toHaveLength(3);
    expect(data.alert_title?.endsWith("…")).toBe(true);
  });
});

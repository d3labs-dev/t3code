import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";

import { botRecords, NOW_MS } from "./BotDreaming.testFixtures.ts";
import {
  isWithinActiveHours,
  nextHeartbeatAtMs,
  scoutModelSelectionFor,
  shouldRunBotHeartbeatScout,
} from "./BotHeartbeat.ts";
import { primaryBot } from "./BotHeartbeat.testFixtures.ts";

const utc = (time: string) => Date.parse(`2026-01-15T${time}:00.000Z`);
const hours = (activeHoursStart: string, activeHoursEnd: string, timezone = "UTC") => ({
  activeHoursStart,
  activeHoursEnd,
  timezone,
});

describe("isWithinActiveHours", () => {
  it.each([
    ["a daytime window before it opens", hours("08:00", "22:00"), "07:59", false],
    ["a daytime window as it opens", hours("08:00", "22:00"), "08:00", true],
    ["a daytime window as it closes", hours("08:00", "22:00"), "22:00", false],
    ["an overnight window before midnight", hours("22:00", "06:00"), "23:30", true],
    ["an overnight window after midnight", hours("22:00", "06:00"), "05:59", true],
    ["an overnight window at noon", hours("22:00", "06:00"), "12:00", false],
    ["New York at 07:30 local", hours("08:00", "22:00", "America/New_York"), "12:30", false],
    ["New York at 08:00 local", hours("08:00", "22:00", "America/New_York"), "13:00", true],
    ["an unknown timezone, read as UTC", hours("08:00", "22:00", "Mars/Olympus"), "07:00", false],
    ["equal start and end", hours("09:00", "09:00"), "03:00", true],
  ] as const)("%s", (_, config, time, expected) => {
    expect(isWithinActiveHours(config, utc(time))).toBe(expected);
  });
});

describe("nextHeartbeatAtMs", () => {
  const config = { ...primaryBot.proactive, ...hours("08:00", "22:00") };
  it.each([
    ["waits a full interval on startup", null, utc("12:00"), utc("12:30")],
    ["waits one interval after the last attempt", utc("11:50"), utc("12:00"), utc("12:20")],
    ["runs now when overdue", utc("10:00"), utc("12:00"), utc("12:00")],
    [
      "moves to the next morning outside active hours",
      utc("21:45"),
      utc("21:50"),
      Date.parse("2026-01-16T08:00:00.000Z"),
    ],
  ] as const)("%s", (_, lastAttemptAtMs, nowMs, expected) => {
    expect(nextHeartbeatAtMs({ config, lastAttemptAtMs, nowMs })).toBe(expected);
  });
});

describe("scoutModelSelectionFor", () => {
  it.each([
    ["claudeAgent", "effort", "max"],
    ["codex", "reasoningEffort", "xhigh"],
    ["antigravity", "thought_level", "high"],
  ] as const)("dials %s's %s to medium", (instanceId, id, value) => {
    const selection = {
      instanceId: ProviderInstanceId.make(instanceId),
      model: "model",
      options: [
        { id, value },
        { id: "fastMode", value: true },
      ],
    };
    expect(scoutModelSelectionFor(selection)).toEqual({
      ...selection,
      options: [
        { id, value: "medium" },
        { id: "fastMode", value: true },
      ],
    });
  });

  it("keeps a selection without options", () => {
    const selection = { instanceId: ProviderInstanceId.make("cursor"), model: "model" };
    expect(scoutModelSelectionFor(selection)).toBe(selection);
  });
});

describe("shouldRunBotHeartbeatScout", () => {
  const idle = botRecords();
  const input = {
    bot: primaryBot,
    mainThreadRecords: idle,
    scoutThreadBusy: false,
    hasPendingBotExchanges: false,
    documents: { now: "- Ship PR #286", heartbeat: "" },
    nowMs: NOW_MS,
  };

  it.each([
    ["an idle primary Bot with NOW.md", {}, true],
    [
      "an idle primary Bot with only HEARTBEAT.md",
      { documents: { now: " ", heartbeat: "- CI" } },
      true,
    ],
    ["a specialist Bot", { bot: { ...primaryBot, isPrimary: false } }, false],
    [
      "disabled check-ins",
      { bot: { ...primaryBot, proactive: { ...primaryBot.proactive, enabled: false } } },
      false,
    ],
    ["a muted Bot", { bot: { ...primaryBot, muted: true } }, false],
    ["an archived Bot", { bot: { ...primaryBot, archivedAt: primaryBot.createdAt } }, false],
    [
      "quiet hours",
      {
        bot: { ...primaryBot, proactive: { ...primaryBot.proactive, ...hours("13:00", "20:00") } },
      },
      false,
    ],
    ["empty NOW.md and HEARTBEAT.md", { documents: { now: "\n", heartbeat: "  " } }, false],
    ["a busy scout", { scoutThreadBusy: true }, false],
    ["a pending Bot exchange", { hasPendingBotExchanges: true }, false],
    [
      "a running Bot turn",
      { mainThreadRecords: botRecords({ runs: [{ text: "Plan", status: "running" }] }) },
      false,
    ],
    [
      "an archived Bot thread",
      {
        mainThreadRecords: {
          ...idle,
          thread: { ...idle.thread, archivedAt: idle.thread.updatedAt },
        },
      },
      false,
    ],
  ] as const)("%s", (_, overrides, expected) => {
    expect(shouldRunBotHeartbeatScout({ ...input, ...overrides })).toBe(expected);
  });
});

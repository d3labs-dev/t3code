import { describe, expect, it } from "@effect/vitest";
import { NodeId, RunId, RuntimeRequestId } from "@t3tools/contracts";
import { BOT_DREAMING_PROMPT } from "@t3tools/shared/botDreaming";
import * as DateTime from "effect/DateTime";

import {
  BOT_DREAMING_CACHE_LEAD_MS,
  BOT_DREAMING_FALLBACK_TURNS,
  BOT_DREAMING_IDLE_DELAY_MS,
  BOT_DREAMING_MIN_TOKENS,
  BOT_DREAMING_NON_COMPACT_COOLDOWN_TURNS,
  botDreamingAction,
} from "./BotDreaming.ts";
import { at, botRecords, MINUTE_MS, NOW_MS } from "./BotDreaming.testFixtures.ts";

const activeBot = { archivedAt: null, muted: false };
const idle = { hasPendingBotExchanges: false };
const lastRunId = (records: ReturnType<typeof botRecords>) => records.runs.at(-1)!.id;

describe("botDreamingAction", () => {
  it("dreams on Claude just before the prompt cache expires and never once it is cold", () => {
    const warm = botRecords({ cacheExpiresInMs: 60 * MINUTE_MS });
    expect(botDreamingAction(warm, activeBot, idle, NOW_MS)).toEqual({
      kind: "dream",
      runId: lastRunId(warm),
      startMs: NOW_MS + 60 * MINUTE_MS - BOT_DREAMING_CACHE_LEAD_MS,
    });
    const insideLead = botRecords({ cacheExpiresInMs: 2 * MINUTE_MS });
    expect(botDreamingAction(insideLead, activeBot, idle, NOW_MS)).toMatchObject({
      kind: "dream",
      startMs: NOW_MS,
    });
    expect(botDreamingAction(insideLead, activeBot, idle, NOW_MS + 2 * MINUTE_MS)).toBeNull();
    expect(botDreamingAction(botRecords(), activeBot, idle, NOW_MS)).toBeNull();
    expect(
      botDreamingAction(
        botRecords({ cacheExpiresInMs: 60 * MINUTE_MS, usedTokens: BOT_DREAMING_MIN_TOKENS - 1 }),
        activeBot,
        idle,
        NOW_MS,
      ),
    ).toBeNull();
  });

  it.each(["codex", "antigravity"])(
    "dreams on %s after the idle delay by context size or turn count",
    (driver) => {
      const expected = { kind: "dream", startMs: NOW_MS + BOT_DREAMING_IDLE_DELAY_MS };
      expect(botDreamingAction(botRecords({ driver }), activeBot, idle, NOW_MS)).toMatchObject(
        expected,
      );
      const smallContext = { driver, usedTokens: 10_000 };
      expect(botDreamingAction(botRecords(smallContext), activeBot, idle, NOW_MS)).toBeNull();
      const turns = (count: number) =>
        Array.from({ length: count }, (_, index) => ({ text: `Message ${index}` }));
      const manyTurns = botRecords({
        ...smallContext,
        runs: [{ text: BOT_DREAMING_PROMPT }, ...turns(BOT_DREAMING_FALLBACK_TURNS)],
      });
      expect(botDreamingAction(manyTurns, activeBot, idle, NOW_MS)).toMatchObject(expected);
      const sinceDream = botRecords({
        ...smallContext,
        runs: [
          ...turns(BOT_DREAMING_FALLBACK_TURNS),
          { text: BOT_DREAMING_PROMPT },
          ...turns(BOT_DREAMING_FALLBACK_TURNS - 1),
        ],
      });
      expect(botDreamingAction(sinceDream, activeBot, idle, NOW_MS)).toBeNull();
    },
  );

  it("waits out a turn cooldown before dreaming again on a large Antigravity context", () => {
    const afterDream = (turnCount: number) =>
      botRecords({
        driver: "antigravity",
        usedTokens: 90_000,
        runs: [
          { text: "Plan the release" },
          { text: BOT_DREAMING_PROMPT },
          ...Array.from({ length: turnCount }, (_, index) => ({ text: `Message ${index}` })),
        ],
      });
    for (let turnCount = 1; turnCount < BOT_DREAMING_NON_COMPACT_COOLDOWN_TURNS; turnCount++) {
      expect(botDreamingAction(afterDream(turnCount), activeBot, idle, NOW_MS)).toBeNull();
    }
    expect(
      botDreamingAction(
        afterDream(BOT_DREAMING_NON_COMPACT_COOLDOWN_TURNS),
        activeBot,
        idle,
        NOW_MS,
      ),
    ).toMatchObject({ kind: "dream" });
  });

  it.each([
    { driver: "claudeAgent", compacts: true },
    { driver: "codex", compacts: true },
    { driver: "antigravity", compacts: false },
  ])("after a dream on $driver, compacts natively: $compacts", ({ driver, compacts }) => {
    const dreamed = botRecords({
      driver,
      cacheExpiresInMs: 60 * MINUTE_MS,
      runs: [{ text: "Plan the release" }, { text: BOT_DREAMING_PROMPT }],
    });
    expect(botDreamingAction(dreamed, activeBot, idle, NOW_MS)).toEqual(
      compacts ? { kind: "compact_after_dream", runId: lastRunId(dreamed) } : null,
    );
  });

  it("skips compacting after a Claude dream once the prompt cache is cold", () => {
    const dreamed = botRecords({
      cacheExpiresInMs: 2 * MINUTE_MS,
      runs: [{ text: "Plan the release" }, { text: BOT_DREAMING_PROMPT }],
    });
    expect(botDreamingAction(dreamed, activeBot, idle, NOW_MS + 2 * MINUTE_MS)).toBeNull();
    const uncached = botRecords({
      runs: [{ text: "Plan the release" }, { text: BOT_DREAMING_PROMPT }],
    });
    expect(botDreamingAction(uncached, activeBot, idle, NOW_MS)).toBeNull();
  });

  it("skips archived, muted, busy, and compacted Bots", () => {
    const warm = { cacheExpiresInMs: 60 * MINUTE_MS };
    const expectSkipped = (
      records: ReturnType<typeof botRecords>,
      bot: Parameters<typeof botDreamingAction>[1] = activeBot,
      options: Parameters<typeof botDreamingAction>[2] = idle,
    ) => expect(botDreamingAction(records, bot, options, NOW_MS)).toBeNull();
    expect(botDreamingAction(botRecords(warm), activeBot, idle, NOW_MS)).not.toBeNull();

    expectSkipped(botRecords(warm), { archivedAt: DateTime.formatIso(at()), muted: false });
    expectSkipped(botRecords(warm), { archivedAt: null, muted: true });
    expectSkipped(botRecords(warm), activeBot, { hasPendingBotExchanges: true });
    const archivedThread = botRecords(warm);
    archivedThread.thread = { ...archivedThread.thread, archivedAt: at() };
    expectSkipped(archivedThread);
    const pendingRequest = botRecords(warm);
    pendingRequest.runtimeRequests = [
      {
        id: RuntimeRequestId.make("request"),
        nodeId: NodeId.make("bot-root-node"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "user_input",
        status: "pending",
        responseCapability: { type: "message" },
        createdAt: at(),
        resolvedAt: null,
      },
    ];
    expectSkipped(pendingRequest);
    expectSkipped(botRecords({ ...warm, runs: [{ text: "/compact" }] }));
    expectSkipped(
      botRecords({ ...warm, runs: [{ text: "Hi" }, { text: "Still going", status: "running" }] }),
    );
    expectSkipped(
      botRecords({
        driver: "antigravity",
        runs: [{ text: "Plan the release" }, { text: BOT_DREAMING_PROMPT }],
      }),
    );
    const steered = botRecords(warm);
    steered.runs = [
      ...steered.runs,
      {
        ...steered.runs[0]!,
        id: RunId.make("queued"),
        ordinal: 2,
        status: "cancelled",
        startedAt: null,
      },
    ];
    expect(botDreamingAction(steered, activeBot, idle, NOW_MS)?.runId).toBe(
      lastRunId(botRecords()),
    );
  });
});

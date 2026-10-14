import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { makeCswap } from "./cswap.ts";
import { CSWAP_LIST_SAMPLE, fakeCswapRunner } from "./cswapTestHelpers.ts";

const config = { kind: "cswap", binaryPath: "cswap", enabled: true } as const;

const readAccounts = (
  output: { readonly stdout: string; readonly code: number },
  binaryPath: string = config.binaryPath,
) => {
  const runner = fakeCswapRunner(output);
  return makeCswap.pipe(
    Effect.flatMap((cswap) => cswap.readAccounts({ ...config, binaryPath })),
    Effect.provide(runner.layer),
    Effect.provideService(HostProcess.HomeDirectory, "/home/tester"),
    Effect.map((accounts) => ({ accounts, runs: runner.runs })),
  );
};

const listWith = (account: Record<string, unknown>) =>
  JSON.stringify({ ...CSWAP_LIST_SAMPLE, accounts: [account] });

describe("cswap usage source", () => {
  it.effect("maps every account to the windows the native Claude provider draws", () =>
    Effect.gen(function* () {
      const { accounts, runs } = yield* readAccounts(
        { stdout: JSON.stringify(CSWAP_LIST_SAMPLE), code: 0 },
        "~/.local/bin/cswap",
      );
      expect(runs.map((run) => [run.command, run.args])).toEqual([
        ["/home/tester/.local/bin/cswap", ["list", "--json"]],
      ]);
      expect(accounts).toEqual([
        {
          id: "1",
          driver: "claudeAgent",
          email: "work@example.com",
          label: "work",
          plan: "Claude Subscription",
          workspaceId: "4033dbf0-1a34-4d32-8d86-a5c84aabe105",
          usageLimits: {
            checkedAt: "2026-10-14T04:28:50.000Z",
            windows: [
              {
                id: "five_hour",
                kind: "session",
                label: "Session",
                windowDurationMins: 300,
                usedPercent: 4,
                resetsAt: "2026-10-14T06:09:59.906Z",
              },
              {
                id: "seven_day",
                kind: "weekly",
                label: "Weekly",
                windowDurationMins: 10080,
                usedPercent: 31,
                resetsAt: "2026-10-19T01:59:59.906Z",
              },
              {
                id: "seven_day_fable",
                kind: "weekly",
                label: "Weekly · Fable",
                windowDurationMins: 10080,
                usedPercent: 0,
                resetsAt: "2026-10-19T02:00:00.000Z",
              },
            ],
          },
        },
        expect.objectContaining({ id: "2", email: "personal@example.com", label: "personal" }),
      ]);
      expect(accounts[1]?.usageLimits.windows[0]).toEqual({
        id: "five_hour",
        kind: "session",
        label: "Session",
        windowDurationMins: 300,
        usedPercent: 0,
      });
    }),
  );

  it.effect("keeps unreadable accounts as rows and leaves API-key accounts out of limits", () =>
    Effect.gen(function* () {
      const [base] = CSWAP_LIST_SAMPLE.accounts;
      const expired = yield* readAccounts({
        stdout: listWith({ ...base, usageStatus: "token_expired", usage: null }),
        code: 0,
      });
      expect(expired.accounts[0]?.usageLimits.unavailable).toEqual({
        reason: "probeFailed",
        message: "claude-swap could not read this account's usage.",
      });
      const apiKey = yield* readAccounts({
        stdout: listWith({ ...base, usageStatus: "api_key", usage: null }),
        code: 0,
      });
      expect(apiKey.accounts[0]?.usageLimits.unavailable).toEqual({ reason: "unsupported" });
    }),
  );

  it.effect("fails on a non-zero exit, unreadable JSON, or an unknown schema version", () =>
    Effect.gen(function* () {
      const failures = yield* Effect.forEach(
        [
          { stdout: "", code: 1 },
          { stdout: "not json", code: 0 },
          { stdout: JSON.stringify({ ...CSWAP_LIST_SAMPLE, schemaVersion: 2 }), code: 0 },
        ],
        (output) => readAccounts(output).pipe(Effect.flip),
      );
      expect(failures.map((failure) => failure.detail)).toEqual([
        "claude-swap exited with code 1.",
        "claude-swap returned output this version cannot read.",
        "claude-swap returned output this version cannot read.",
      ]);
    }),
  );
});

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";

/** A real `cswap list --json` payload, emails anonymized. */
export const CSWAP_LIST_SAMPLE = {
  schemaVersion: 1,
  activeAccountNumber: 1,
  accounts: [
    {
      number: 1,
      email: "work@example.com",
      organizationName: "work@example.com's Organization",
      organizationUuid: "4033dbf0-1a34-4d32-8d86-a5c84aabe105",
      isOrganization: true,
      active: true,
      usageStatus: "ok",
      usage: {
        fiveHour: {
          pct: 4.0,
          resetsAt: "2026-10-14T06:09:59.906493+00:00",
          countdown: "1h 41m",
          clock: "Oct 14 01:09",
        },
        sevenDay: {
          pct: 31.0,
          resetsAt: "2026-10-19T01:59:59.906519+00:00",
          countdown: "4d 21h",
          clock: "Oct 18 20:59",
          expectedPct: 30.0,
          aheadOfPace: false,
          projectedExhaustionAt: "2026-10-18T20:50:27Z",
          willLastToReset: false,
        },
        scoped: [
          {
            pct: 0.0,
            resetsAt: "2026-10-19T02:00:00+00:00",
            countdown: "4d 21h",
            clock: "Oct 18 21:00",
            expectedPct: 30.0,
            aheadOfPace: false,
            willLastToReset: true,
            name: "Fable",
          },
        ],
      },
      alias: "work",
      usageFetchedAt: "2026-10-14T04:28:50Z",
      usageAgeSeconds: 0.0,
    },
    {
      number: 2,
      email: "personal@example.com",
      organizationName: "personal@example.com's Organization",
      organizationUuid: "fbcead14-051c-4904-893c-13dc21dd678a",
      isOrganization: true,
      active: false,
      usageStatus: "ok",
      usage: {
        fiveHour: { pct: 0.0 },
        sevenDay: {
          pct: 19.0,
          resetsAt: "2026-10-18T10:00:00.252889+00:00",
          countdown: "4d 5h",
          clock: "Oct 18 05:00",
          expectedPct: 39.6,
          aheadOfPace: false,
          projectedExhaustionAt: "2026-10-25T23:53:52Z",
          willLastToReset: true,
        },
        scoped: [
          {
            pct: 0.0,
            resetsAt: "2026-10-18T10:00:00+00:00",
            countdown: "4d 5h",
            clock: "Oct 18 05:00",
            expectedPct: 39.6,
            aheadOfPace: false,
            willLastToReset: true,
            name: "Fable",
          },
        ],
      },
      alias: "personal",
      usageFetchedAt: "2026-10-14T04:28:50Z",
      usageAgeSeconds: 0.0,
    },
  ],
};

/** Stands in for the cswap CLI, which has no test environment. */
export function fakeCswapRunner(output: { readonly stdout: string; readonly code: number }) {
  const runs: Array<ProcessRunner.ProcessRunInput> = [];
  const layer = Layer.succeed(
    ProcessRunner.ProcessRunner,
    ProcessRunner.ProcessRunner.of({
      run: Effect.fn("ProcessRunner.run")((input) =>
        Effect.sync(() => {
          runs.push(input);
          return {
            stdout: output.stdout,
            stderr: "",
            code: ChildProcessSpawner.ExitCode(output.code),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }),
      ),
    }),
  );
  return { runs, layer };
}

/**
 * Reads every Claude account claude-swap (`cswap`) manages, so accounts that
 * are not signed in to this environment's Claude provider still show their
 * quota.
 *
 * Always goes through `cswap list --json`, never cswap's stored credentials
 * or Anthropic's API: cswap refreshes OAuth tokens under Claude Code's
 * credential locks, and a second refresher would race it and can rotate the
 * refresh token out from under both.
 *
 * @module usage/cswap
 */
import {
  ProviderDriverKind,
  UsageLimitSourceError,
  type CswapUsageLimitSourceConfig,
  type UsageLimitSourceAccount,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { claudeUsageResponseToLimits } from "../provider/claudeUsageLimits.ts";

const LIST_TIMEOUT_SECONDS = 30;

/** `pct` is percent used; `resetsAt` is absent while a window has not started. */
const CswapWindow = Schema.Struct({
  pct: Schema.Number,
  resetsAt: Schema.optional(Schema.String),
});
const CswapAccount = Schema.Struct({
  number: Schema.Number,
  email: Schema.String,
  organizationUuid: Schema.optional(Schema.String),
  usageStatus: Schema.String,
  usage: Schema.NullOr(
    Schema.Struct({
      fiveHour: Schema.optional(CswapWindow),
      sevenDay: Schema.optional(CswapWindow),
      scoped: Schema.optional(
        Schema.Array(Schema.Struct({ ...CswapWindow.fields, name: Schema.String })),
      ),
    }),
  ),
  usageFetchedAt: Schema.optional(Schema.String),
});
const CswapList = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  accounts: Schema.Array(CswapAccount),
});
type CswapAccount = typeof CswapAccount.Type;

const decodeCswapList = Schema.decodeUnknownEffect(Schema.fromJsonString(CswapList));
const isUsageLimitSourceError = Schema.is(UsageLimitSourceError);

function cswapWindow(window: typeof CswapWindow.Type | undefined) {
  return window ? { utilization: window.pct, resets_at: window.resetsAt ?? null } : null;
}

function cswapAccountToSource(input: {
  readonly account: CswapAccount;
  readonly checkedAt: string;
}): UsageLimitSourceAccount {
  const { account } = input;
  // cswap may serve a recent cached read; dating it lets a fresher native read win the merge.
  const fetchedAt =
    account.usageFetchedAt === undefined ? Option.none() : DateTime.make(account.usageFetchedAt);
  const checkedAt = Option.match(fetchedAt, {
    onNone: () => input.checkedAt,
    onSome: DateTime.formatIso,
  });
  const organizationUuid = account.organizationUuid?.trim();
  const base = {
    id: String(account.number),
    driver: ProviderDriverKind.make("claudeAgent"),
    email: account.email,
    plan: "Claude Subscription",
    ...(organizationUuid ? { workspaceId: organizationUuid } : {}),
  };
  if (account.usageStatus === "api_key") {
    return {
      ...base,
      usageLimits: makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" }),
    };
  }
  if (account.usageStatus !== "ok" || account.usage === null) {
    return {
      ...base,
      usageLimits: makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "claude-swap could not read this account's usage.",
      }),
    };
  }
  const usage = account.usage;
  return {
    ...base,
    usageLimits: claudeUsageResponseToLimits({
      checkedAt,
      response: {
        rate_limits_available: true,
        rate_limits: {
          five_hour: cswapWindow(usage.fiveHour),
          seven_day: cswapWindow(usage.sevenDay),
          model_scoped: (usage.scoped ?? []).map((window) => ({
            display_name: window.name,
            utilization: window.pct,
            resets_at: window.resetsAt ?? null,
          })),
        },
      },
    }).limits,
  };
}

export const makeCswap = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const readAccounts = Effect.fn("Cswap.readAccounts")(function* (
    config: CswapUsageLimitSourceConfig,
  ): Effect.fn.Return<ReadonlyArray<UsageLimitSourceAccount>, UsageLimitSourceError> {
    const command = expandHomePath(config.binaryPath, yield* HostProcess.HomeDirectory);
    const output = yield* processRunner
      .run({ command, args: ["list", "--json"], timeout: `${LIST_TIMEOUT_SECONDS} seconds` })
      .pipe(
        Effect.catchTags({
          ProcessSpawnError: () =>
            Effect.fail(
              new UsageLimitSourceError({
                detail: "Could not run claude-swap. Check its binary path.",
              }),
            ),
          ProcessTimeoutError: () =>
            Effect.fail(
              new UsageLimitSourceError({
                detail: `claude-swap did not answer within ${LIST_TIMEOUT_SECONDS} seconds.`,
              }),
            ),
          ProcessOutputLimitError: () =>
            Effect.fail(
              new UsageLimitSourceError({ detail: "claude-swap's output was too large." }),
            ),
        }),
        Effect.mapError((error) =>
          isUsageLimitSourceError(error)
            ? error
            : new UsageLimitSourceError({ detail: "Could not read claude-swap's output." }),
        ),
      );
    if (output.code !== 0) {
      return yield* new UsageLimitSourceError({
        detail: `claude-swap exited with code ${output.code ?? "unknown"}.`,
      });
    }
    const list = yield* decodeCswapList(output.stdout).pipe(
      Effect.mapError(
        () =>
          new UsageLimitSourceError({
            detail: "claude-swap returned output this version cannot read.",
          }),
      ),
    );
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return list.accounts.map((account) => cswapAccountToSource({ account, checkedAt }));
  });

  return { readAccounts };
});

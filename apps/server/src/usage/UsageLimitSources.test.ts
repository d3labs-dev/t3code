import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { ServerConfigStreamEvent, UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CSWAP_LIST_SAMPLE, fakeCswapRunner } from "./cswapTestHelpers.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";

const sourceId = UsageLimitSourceId.make("cswap");

function layer(output: { readonly stdout: string; readonly code: number }) {
  const settings = ServerSettings.layerTest({
    usageLimitSources: { [sourceId]: { kind: "cswap", binaryPath: "cswap", enabled: true } },
  });
  return Layer.effect(UsageLimitSources.UsageLimitSources, UsageLimitSources.make).pipe(
    Layer.provide(
      Layer.mergeAll(
        fakeCswapRunner(output).layer,
        settings,
        BackgroundPolicy.layer.pipe(
          Layer.provide(Layer.effect(HostPowerMonitor.HostPowerMonitor, HostPowerMonitor.make())),
          Layer.provide(settings),
        ),
        NodeCrypto.layer,
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("cswap sources never call HTTP")),
        ),
      ),
    ),
  );
}

const readSnapshots = Effect.gen(function* () {
  const sources = yield* UsageLimitSources.UsageLimitSources;
  yield* sources.refresh;
  return yield* sources.current;
});

describe("UsageLimitSources with claude-swap", () => {
  it.effect("publishes every cswap account under the claude-swap label", () =>
    readSnapshots.pipe(
      Effect.map((snapshots) => {
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toMatchObject({ id: sourceId, kind: "cswap", label: "claude-swap" });
        expect(snapshots[0]?.error).toBeUndefined();
        expect(snapshots[0]?.accounts.map((account) => account.email)).toEqual([
          "work@example.com",
          "personal@example.com",
        ]);
      }),
      Effect.provide(layer({ stdout: JSON.stringify(CSWAP_LIST_SAMPLE), code: 0 })),
    ),
  );

  it.effect("keeps a failing cswap source as a row with its error", () =>
    Effect.gen(function* () {
      const failedExit = yield* readSnapshots.pipe(Effect.provide(layer({ stdout: "", code: 2 })));
      expect(failedExit).toMatchObject([
        { id: sourceId, accounts: [], error: "claude-swap exited with code 2." },
      ]);
      const badJson = yield* readSnapshots.pipe(Effect.provide(layer({ stdout: "{", code: 0 })));
      expect(badJson).toMatchObject([
        { accounts: [], error: "claude-swap returned output this version cannot read." },
      ]);
    }),
  );

  it.effect("refuses reset-credit redemption on a cswap source", () =>
    Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      const error = yield* sources
        .consumeResetCredit({ sourceId, accountId: "1", creditId: "credit" })
        .pipe(Effect.flip);
      expect(error.detail).toBe("claude-swap accounts cannot redeem reset credits.");
    }).pipe(Effect.provide(layer({ stdout: JSON.stringify(CSWAP_LIST_SAMPLE), code: 0 }))),
  );
});

const encodeConfigEvent = Schema.encodeSync(ServerConfigStreamEvent);

it.effect("keeps malformed source URLs encodable for config subscribers", () =>
  Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    const snapshots = yield* sources.current;
    expect(snapshots.map((source) => source.label)).toEqual([
      "local-hub",
      "opaque-hub",
      "Named hub",
      "hub.test:8317",
      "Usage limit source",
    ]);
    expect(() =>
      encodeConfigEvent({
        version: 1,
        type: "usageLimitSourcesUpdated",
        payload: { sources: snapshots },
      }),
    ).not.toThrow();
    expect(snapshots.every((source) => source.error === "No management key configured.")).toBe(
      true,
    );
  }).pipe(
    Effect.provide([
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("local-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("opaque-hub")]: {
            kind: "cliproxy",
            url: "file:///tmp/hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("named-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            label: "Named hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("valid-hub")]: {
            kind: "cliproxy",
            url: "https://hub.test:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make(" ")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("Unexpected network request")),
      ),
      fakeCswapRunner({ stdout: "", code: 0 }).layer,
      NodeCrypto.layer,
    ]),
    Effect.scoped,
  ),
);

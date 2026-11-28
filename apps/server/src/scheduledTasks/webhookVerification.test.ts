// @effect-diagnostics-next-line nodeBuiltinImport:off -- Node's HMAC is an independent oracle for the Effect implementation.
import * as NodeCrypto from "node:crypto";

import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { verifyStandardWebhook, verifyWebhookSignature } from "./webhookVerification.ts";

const body = new TextEncoder().encode('{"action":"opened"}');
const secret = "shared-secret";
const hmac = () => NodeCrypto.createHmac("sha256", secret).update(body);

describe("verifyWebhookSignature", () => {
  const github = { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" } as const;

  it.effect("rejects a tampered body, a wrong secret, a missing header and a missing prefix", () =>
    Effect.gen(function* () {
      const valid = `sha256=${hmac().digest("hex")}`;
      const tampered = new TextEncoder().encode('{"action":"closed"}');
      assert.isFalse(
        yield* verifyWebhookSignature({
          signature: github,
          secret,
          headers: { "x-hub-signature-256": valid },
          body: tampered,
        }),
      );
      assert.isFalse(
        yield* verifyWebhookSignature({
          signature: github,
          secret: "other",
          headers: { "x-hub-signature-256": valid },
          body,
        }),
      );
      assert.isFalse(
        yield* verifyWebhookSignature({ signature: github, secret, headers: {}, body }),
      );
      assert.isFalse(
        yield* verifyWebhookSignature({
          signature: github,
          secret,
          headers: { "x-hub-signature-256": hmac().digest("hex") },
          body,
        }),
      );
    }).pipe(Effect.provide(PlatformNodeCrypto.layerMac)),
  );

  it.effect("accepts a hex signature with its prefix and a base64 signature without one", () =>
    Effect.gen(function* () {
      assert.isTrue(
        yield* verifyWebhookSignature({
          signature: github,
          secret,
          headers: { "x-hub-signature-256": `sha256=${hmac().digest("hex").toUpperCase()}` },
          body,
        }),
      );
      assert.isTrue(
        yield* verifyWebhookSignature({
          signature: { header: "X-Signature", encoding: "base64", prefix: "" },
          secret,
          headers: { "x-signature": hmac().digest("base64") },
          body,
        }),
      );
    }).pipe(Effect.provide(PlatformNodeCrypto.layerMac)),
  );
});

describe("verifyStandardWebhook", () => {
  const key = Buffer.alloc(32, 1);
  const secret = `whsec_${key.toString("base64")}`;
  const sign = (signingKey: Buffer, id: string, timestamp: number) =>
    `v1,${NodeCrypto.createHmac("sha256", signingKey).update(`${id}.${timestamp}.`).update(body).digest("base64")}`;
  const headers = (signature: string, timestamp = 1_000) => ({
    "webhook-id": "evt_1",
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signature,
  });
  const verify = (requestHeaders: Record<string, string>, receivedAtSeconds = 1_000) =>
    verifyStandardWebhook({ secret, headers: requestHeaders, body, receivedAtSeconds }).pipe(
      Effect.provide(PlatformNodeCrypto.layerMac),
    );

  it.effect("accepts a signature from the secret, also among several", () =>
    Effect.gen(function* () {
      assert.equal(yield* verify(headers(sign(key, "evt_1", 1_000))), "verified");
      const rotated = `${sign(Buffer.alloc(32, 2), "evt_1", 1_000)} ${sign(key, "evt_1", 1_000)}`;
      assert.equal(yield* verify(headers(rotated)), "verified");
    }),
  );

  it.effect("rejects another secret, another id, and a timestamp over five minutes off", () =>
    Effect.gen(function* () {
      assert.equal(yield* verify(headers(sign(Buffer.alloc(32, 2), "evt_1", 1_000))), "invalid");
      assert.equal(yield* verify(headers(sign(key, "evt_2", 1_000))), "invalid");
      assert.equal(yield* verify(headers(sign(key, "evt_1", 1_000)), 1_301), "stale");
      assert.equal(yield* verify(headers(sign(key, "evt_1", 1_000)), 699), "stale");
      assert.equal(yield* verify(headers(sign(key, "evt_1", 1_000)), 1_300), "verified");
    }),
  );
});

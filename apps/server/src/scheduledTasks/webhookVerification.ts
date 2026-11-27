import type { ScheduledTaskWebhookSignature } from "@t3tools/contracts";
import * as Digest from "effect/crypto/Digest";
import * as Mac from "effect/crypto/Mac";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Hex from "effect/encoding/Hex";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

const utf8 = (value: string) => new TextEncoder().encode(value);

/** Compares hashes so the comparison does not leak either string's length. */
export const constantTimeEquals = Effect.fn("webhookVerification.constantTimeEquals")(function* (
  a: string,
  b: string,
) {
  const digest = yield* Digest.Digest;
  const [left, right] = yield* Effect.all([
    digest.digest(Digest.sha256, utf8(a)),
    digest.digest(Digest.sha256, utf8(b)),
  ]);
  return Mac.timingSafeEqual(left, right);
});

export const verifyWebhookSignature = Effect.fn("webhookVerification.verifyWebhookSignature")(
  function* (input: {
    readonly signature: ScheduledTaskWebhookSignature;
    readonly secret: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
  }) {
    const received = input.headers[input.signature.header.toLowerCase()];
    if (received === undefined) return false;
    const value = received.trim();
    const prefix = input.signature.prefix;
    if (prefix !== "" && !value.toLowerCase().startsWith(prefix.toLowerCase())) return false;
    const candidate = value.slice(prefix.length);
    const tag =
      input.signature.encoding === "hex"
        ? Hex.decode(candidate.toLowerCase())
        : Base64.decode(candidate);
    if (Result.isFailure(tag)) return false;
    const mac = yield* Mac.Mac;
    return yield* Mac.key(Mac.hmacSha256, utf8(input.secret)).pipe(
      Effect.flatMap((key) => mac.verify(key, tag.success, input.body)),
      Effect.orElseSucceed(() => false),
    );
  },
);

export const STANDARD_WEBHOOK_SECRET_PREFIX = "whsec_";
const STANDARD_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Standard Webhooks: `webhook-signature` lists `v1,<base64 HMAC-SHA256>` entries over
 * `<webhook-id>.<webhook-timestamp>.<body>`, keyed with the bytes after `whsec_`. Any entry may
 * match, so a sender can sign with an old and a new key during rotation.
 */
export const verifyStandardWebhook = Effect.fn("webhookVerification.verifyStandardWebhook")(
  function* (input: {
    readonly secret: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly receivedAtSeconds: number;
  }) {
    const id = input.headers["webhook-id"];
    const timestamp = input.headers["webhook-timestamp"];
    const signatures = input.headers["webhook-signature"];
    if (id === undefined || timestamp === undefined || signatures === undefined) {
      return "invalid" as const;
    }
    if (!input.secret.startsWith(STANDARD_WEBHOOK_SECRET_PREFIX)) return "invalid" as const;
    const keyBytes = Base64.decode(input.secret.slice(STANDARD_WEBHOOK_SECRET_PREFIX.length));
    if (Result.isFailure(keyBytes) || !/^\d{1,12}$/.test(timestamp)) return "invalid" as const;
    const prefix = utf8(`${id}.${timestamp}.`);
    const signed = new Uint8Array(prefix.byteLength + input.body.byteLength);
    signed.set(prefix);
    signed.set(input.body, prefix.byteLength);
    const mac = yield* Mac.Mac;
    const key = yield* Mac.key(Mac.hmacSha256, keyBytes.success).pipe(Effect.option);
    if (Option.isNone(key)) return "invalid" as const;
    let verified = false;
    for (const entry of signatures.trim().split(/\s+/)) {
      const [version, encoded] = entry.split(",", 2);
      if (version !== "v1" || encoded === undefined) continue;
      const tag = Base64.decode(encoded);
      if (Result.isFailure(tag)) continue;
      if (yield* mac.verify(key.value, tag.success, signed).pipe(Effect.orElseSucceed(() => false)))
        verified = true;
    }
    if (!verified) return "invalid" as const;
    return Math.abs(input.receivedAtSeconds - Number(timestamp)) >
      STANDARD_WEBHOOK_TOLERANCE_SECONDS
      ? ("stale" as const)
      : ("verified" as const);
  },
);

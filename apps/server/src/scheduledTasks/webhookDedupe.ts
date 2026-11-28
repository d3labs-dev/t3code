// @effect-diagnostics-next-line nodeBuiltinImport:off -- Keys need a deterministic digest, not random bytes.
import * as NodeCrypto from "node:crypto";
import {
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ScheduledTask,
  ScheduledTaskError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  renderWebhookPrompt,
  renderWebhookPrompts,
  type WebhookRequest,
} from "./webhookTemplate.ts";

function key(template: string | undefined, request: WebhookRequest): string {
  if (template === undefined) return "";
  const rendered = renderWebhookPrompt(template, request, "", true);
  return rendered.missing.length > 0 || rendered.prompt === ""
    ? ""
    : NodeCrypto.createHash("sha256").update(rendered.prompt).digest("hex");
}

// Standard Webhooks retries repeat the `webhook-id` an MCP server signed. All of a task's events
// share one coalesce key, so the events that wait behind a running turn fold into one delivery.
const MCP_EVENT_DEDUPE: WebhookDedupe = {
  replayKey: "{{headers.webhook-id}}",
  coalesceKey: "events",
  coalesceWindowSeconds: 0,
};
const MAX_FOLDED_EVENTS = 20;
// Frame ids are 12 hex characters, so any such id measures a prompt's real length.
const SAMPLE_FRAME_ID = "000000000000";

type WebhookDedupe = NonNullable<
  Extract<ScheduledTask["schedule"], { readonly type: "webhook" }>["dedupe"]
>;

export const webhookDedupe = (schedule: ScheduledTask["schedule"]): WebhookDedupe | undefined =>
  schedule.type === "webhook"
    ? schedule.dedupe
    : schedule.type === "mcp_event"
      ? MCP_EVENT_DEDUPE
      : undefined;

export const releaseWebhookReplay = Effect.fn("ScheduledTaskService.releaseWebhookReplay")(
  function* (deliveryId: string) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM scheduled_task_webhook_replay_keys WHERE delivery_id = ${deliveryId}`;
  },
);

const hasReplayKey = Effect.fn(function* (taskId: string, replayKey: string, now: number) {
  const sql = yield* SqlClient.SqlClient;
  return (
    replayKey !== "" &&
    (yield* sql`SELECT 1 FROM scheduled_task_webhook_replay_keys
    WHERE task_id = ${taskId} AND replay_key = ${replayKey} AND expires_at > ${now}`).length > 0
  );
});
const claimReplayKey = Effect.fn(function* (
  taskId: string,
  replayKey: string,
  deliveryId: string,
  now: number,
) {
  if (replayKey === "") return;
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM scheduled_task_webhook_replay_keys WHERE expires_at <= ${now}`;
  yield* sql`INSERT INTO scheduled_task_webhook_replay_keys (task_id, replay_key, delivery_id, expires_at)
    VALUES (${taskId}, ${replayKey}, ${deliveryId}, ${now + 7 * 24 * 60 * 60 * 1000})`;
});

export const acceptWebhookDedupe = Effect.fn("ScheduledTaskService.acceptWebhookDedupe")(function* (
  task: ScheduledTask,
  request: WebhookRequest,
  deliveryId: string,
  now: number,
  reserve: Effect.Effect<void, "first_rejected" | "rejected">,
  reserveCoalescedLog: Effect.Effect<boolean>,
  checkCapacity: Effect.Effect<void, "queue_full" | ScheduledTaskError>,
  replaceDeliveryRequest: (ownerId: string) => Effect.Effect<void, ScheduledTaskError>,
) {
  const sql = yield* SqlClient.SqlClient;
  const dedupe = webhookDedupe(task.schedule);
  if (dedupe === undefined) return "run" as const;
  const replayKey = key(dedupe.replayKey, request);
  if (yield* hasReplayKey(task.id, replayKey, now)) return "duplicate" as const;
  const coalesceKey = key(dedupe.coalesceKey, request);
  if (coalesceKey === "") return "run" as const;
  // Event deliveries wait until their task's worker takes them; webhook windows close at due_at.
  const folds = task.schedule.type === "mcp_event";
  const [open] = yield* sql<{
    delivery_id: string;
    due_at: number;
    request_json: string;
  }>`SELECT delivery_id, due_at, request_json FROM scheduled_task_webhook_pending
    WHERE task_id = ${task.id} AND coalesce_key = ${coalesceKey} AND state = 'pending'`;
  const joins =
    open !== undefined &&
    (folds ? yield* foldFits(task.prompt, open.request_json, request) : open.due_at > now);
  if (!joins) {
    yield* checkCapacity;
    yield* reserve;
  }
  // Coalesced requests retain their validation slot, bounding writes without dropping accepted payloads.
  yield* claimReplayKey(task.id, replayKey, joins ? open.delivery_id : deliveryId, now);
  const requestJson = yield* encodePendingRequest({
    method: request.method,
    path: request.path,
    query: request.query,
    headers: request.headers,
    bodyText: request.bodyText,
  });
  if (joins && folds) {
    yield* sql`UPDATE scheduled_task_webhook_pending SET request_json = json_insert(request_json, '$[#]', json(${requestJson})),
      delivery_ids_json = json_insert(delivery_ids_json, '$[#]', ${deliveryId}) WHERE delivery_id = ${open.delivery_id}`;
    return "coalesced" as const;
  }
  if (joins) {
    yield* sql`UPDATE scheduled_task_webhook_pending SET request_json = ${requestJson},
      delivery_ids_json = json_insert(delivery_ids_json, '$[#]', ${deliveryId}) WHERE delivery_id = ${open.delivery_id}`;
    yield* replaceDeliveryRequest(open.delivery_id);
    return (yield* reserveCoalescedLog) ? ("coalesced" as const) : ("coalesced_unlogged" as const);
  }
  // Expired windows and full folds are immutable, even if the scheduler has not dispatched them yet.
  if (open !== undefined)
    yield* sql`UPDATE scheduled_task_webhook_pending SET state = 'dispatching' WHERE delivery_id = ${open.delivery_id}`;
  yield* sql`INSERT INTO scheduled_task_webhook_pending (delivery_id, task_id, coalesce_key, due_at, task_json, request_json, delivery_ids_json)
    VALUES (${deliveryId}, ${task.id}, ${coalesceKey}, ${now + (dedupe.coalesceWindowSeconds ?? 120) * 1000}, ${yield* encodePendingTask(task)}, ${folds ? `[${requestJson}]` : requestJson}, json_array(${deliveryId}))`;
  return "pending" as const;
});

export const acceptImmediateWebhookDedupe = Effect.fn(
  "ScheduledTaskService.acceptImmediateWebhookDedupe",
)(function* (
  task: ScheduledTask,
  request: WebhookRequest,
  deliveryId: string,
  now: number,
  reserve: Effect.Effect<void, "first_rejected" | "rejected" | "queue_full" | ScheduledTaskError>,
) {
  const replayKey = key(webhookDedupe(task.schedule)?.replayKey, request);
  if (yield* hasReplayKey(task.id, replayKey, now)) return "duplicate" as const;
  yield* reserve;
  yield* claimReplayKey(task.id, replayKey, deliveryId, now);
  return "run" as const;
});

const PendingTaskJson = Schema.fromJsonString(ScheduledTask);
export const encodePendingTask = Schema.encodeEffect(PendingTaskJson);
export const decodePendingTask = Schema.decodeUnknownEffect(PendingTaskJson);
const PendingRequest = Schema.Struct({
  method: Schema.String,
  path: Schema.String,
  query: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  bodyText: Schema.String,
});
const encodePendingRequest = Schema.encodeEffect(Schema.fromJsonString(PendingRequest));
// A webhook delivery holds one request; an event delivery holds every event folded into it.
const decodeStoredRequests = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Union([PendingRequest, Schema.NonEmptyArray(PendingRequest)])),
);
export const decodePendingRequests = (json: string) =>
  decodeStoredRequests(json).pipe(Effect.map((stored) => ("method" in stored ? [stored] : stored)));

/** Whether one more event still fits the waiting delivery's turn. */
const foldFits = (template: string, stored: string, request: WebhookRequest) =>
  decodePendingRequests(stored).pipe(
    Effect.map((requests) => {
      const folded = [...requests, request];
      return (
        folded.length <= MAX_FOLDED_EVENTS &&
        renderWebhookPrompts(template, folded, SAMPLE_FRAME_ID).prompt.trim().length <=
          PROVIDER_SEND_TURN_MAX_INPUT_CHARS
      );
    }),
    Effect.orElseSucceed(() => false),
  );
export const dedupeError = (cause: unknown) =>
  new ScheduledTaskError({ message: "Could not persist webhook dedupe state.", cause });

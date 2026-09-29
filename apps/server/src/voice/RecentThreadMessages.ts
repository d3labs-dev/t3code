import { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

const RecentThreadMessagesRequest = Schema.Struct({ threadId: ThreadId, limit: Schema.Int });
const RecentThreadMessage = Schema.Struct({ text: Schema.String });

/** Reads the text of a thread's latest messages for dictation context. */
export class RecentThreadMessages extends Context.Service<
  RecentThreadMessages,
  {
    /** The last `limit` messages of the thread, oldest first. */
    readonly list: (
      input: typeof RecentThreadMessagesRequest.Type,
    ) => Effect.Effect<
      ReadonlyArray<typeof RecentThreadMessage.Type>,
      SqlError | Schema.SchemaError
    >;
  }
>()("t3/voice/RecentThreadMessages") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const list = SqlSchema.findAll({
    Request: RecentThreadMessagesRequest,
    Result: RecentThreadMessage,
    execute: ({ threadId, limit }) => sql`
      SELECT text FROM (
        SELECT
          json_extract(payload_json, '$.text') AS text,
          created_at,
          message_id
        FROM orchestration_v2_projection_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC, message_id DESC
        LIMIT ${limit}
      )
      ORDER BY created_at ASC, message_id ASC
    `,
  });
  return RecentThreadMessages.of({ list });
});

export const layer = Layer.effect(RecentThreadMessages, make);

import type { ScheduledTaskMcpEventArguments, ThreadId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import packageJson from "../../package.json" with { type: "json" };

/** The MCP revision that carries the Events extension (SEP-3415). */
const PROTOCOL_VERSION = "2026-07-28";
// A subscribe waits for the server to verify the delivery URL against this server's hook.
const REQUEST_TIMEOUT = Duration.seconds(30);

/** A streamable HTTP MCP server and the headers its config sends, credentials included. */
export interface McpEventServer {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What the server holds a subscription for: an event, its arguments and where it delivers. */
export interface McpEventTarget {
  readonly event: string;
  readonly arguments: ScheduledTaskMcpEventArguments;
  readonly url: string;
}

export class McpEventRequestError extends Schema.TaggedError<McpEventRequestError>()(
  "McpEventRequestError",
  { message: Schema.String },
) {}

/** Reaches the MCP servers that event tasks subscribe to. */
export interface McpEventPublisher {
  /** The named server of the Bot whose thread this is, if it can deliver events. */
  readonly resolve: (input: {
    readonly threadId: ThreadId;
    readonly server: string;
  }) => Effect.Effect<McpEventServer, McpEventRequestError>;
  readonly subscribe: (input: {
    readonly server: McpEventServer;
    readonly target: McpEventTarget;
    readonly secret: string;
  }) => Effect.Effect<
    { readonly id: string; readonly refreshBefore: string | null },
    McpEventRequestError
  >;
  readonly unsubscribe: (input: {
    readonly server: McpEventServer;
    readonly target: McpEventTarget;
  }) => Effect.Effect<void, McpEventRequestError>;
}

const JsonRpcResponse = Schema.Union([
  Schema.Struct({ result: Schema.Record(Schema.String, Schema.Unknown) }),
  Schema.Struct({
    error: Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
      data: Schema.optional(Schema.Unknown),
    }),
  }),
]);
const decodeResponse = Schema.decodeUnknownOption(Schema.fromJsonString(JsonRpcResponse));
const SubscribeResult = Schema.Struct({
  id: Schema.String,
  refreshBefore: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeSubscribeResult = Schema.decodeUnknownOption(SubscribeResult);

/** A streamable HTTP server may answer with one JSON body or with SSE `data:` lines. */
const responseMessage = (contentType: string, text: string) => {
  if (!contentType.includes("text/event-stream")) return decodeResponse(text);
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    const message = decodeResponse(data);
    if (Option.isSome(message)) return message;
  }
  return Option.none();
};

const reason = (data: unknown) =>
  typeof data === "object" && data !== null && "reason" in data && typeof data.reason === "string"
    ? ` (${data.reason})`
    : "";

export const make = Effect.fn("McpEventClient.make")(function* (
  resolve: McpEventPublisher["resolve"],
) {
  const client = yield* HttpClient.HttpClient;

  const call = Effect.fn("McpEventClient.call")(
    function* (server: McpEventServer, method: string, params: Record<string, unknown>) {
      yield* Effect.annotateCurrentSpan({ "mcp.method": method });
      const request = HttpClientRequest.post(server.url).pipe(
        HttpClientRequest.setHeaders({
          ...server.headers,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": PROTOCOL_VERSION,
          // Must equal the JSON-RPC method, or the server refuses the request.
          "mcp-method": method,
        }),
        HttpClientRequest.bodyJsonUnsafe({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
              "io.modelcontextprotocol/clientInfo": {
                name: "t3code",
                version: packageJson.version,
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      );
      const response = yield* client.execute(request);
      const text = yield* response.text;
      const message = responseMessage(response.headers["content-type"] ?? "", text);
      if (Option.isNone(message)) {
        return yield* new McpEventRequestError({
          message: `The MCP server answered ${method} with HTTP ${response.status} and no JSON-RPC reply.`,
        });
      }
      if ("error" in message.value) {
        const { error } = message.value;
        return yield* new McpEventRequestError({
          message: `${error.message}${reason(error.data)} [${error.code}]`,
        });
      }
      return message.value.result;
    },
    (effect, _server, method) =>
      effect.pipe(
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: REQUEST_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new McpEventRequestError({ message: `The MCP server timed out on ${method}.` }),
            ),
        }),
        Effect.catchTags({
          HttpClientError: (error) =>
            Effect.fail(
              new McpEventRequestError({
                message: `Could not reach the MCP server: ${error.reason._tag}.`,
              }),
            ),
        }),
      ),
  );

  const subscribe: McpEventPublisher["subscribe"] = ({ server, target, secret }) =>
    call(server, "events/subscribe", {
      name: target.event,
      arguments: target.arguments,
      delivery: { mode: "webhook", url: target.url, secret },
    }).pipe(
      Effect.flatMap((result) =>
        Option.match(decodeSubscribeResult(result), {
          onNone: () =>
            Effect.fail(
              new McpEventRequestError({
                message: "The MCP server's subscribe reply has no subscription id.",
              }),
            ),
          onSome: ({ id, refreshBefore }) =>
            Effect.succeed({ id, refreshBefore: refreshBefore ?? null }),
        }),
      ),
    );

  // Identified by name, arguments and URL, as the subscription id is the server's own.
  const unsubscribe: McpEventPublisher["unsubscribe"] = ({ server, target }) =>
    call(server, "events/unsubscribe", {
      name: target.event,
      arguments: target.arguments,
      delivery: { mode: "webhook", url: target.url },
    }).pipe(Effect.asVoid);

  return { resolve, subscribe, unsubscribe } satisfies McpEventPublisher;
});

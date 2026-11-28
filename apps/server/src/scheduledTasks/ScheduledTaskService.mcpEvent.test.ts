// @effect-diagnostics-next-line nodeBuiltinImport:off -- Node's HMAC signs as an outside MCP server would.
import * as NodeCrypto from "node:crypto";

import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput, type ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as McpEventClient from "./McpEventClient.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

type Service = ScheduledTaskService.ScheduledTaskService["Service"];
type SendInput = Parameters<
  ThreadManagementService.ThreadManagementService["Service"]["sendToThread"]
>[0];

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);
const SERVER_URL = "https://events.example/mcp";
const LOCAL_ORIGIN = "http://127.0.0.1:4100";

const eventTaskInput = (overrides: Record<string, unknown> = {}) =>
  decodeUpsertInput({
    id: "scheduled-task:events",
    title: "Group messages",
    prompt: "New message: {{body.data.text}}",
    enabled: true,
    schedule: {
      type: "mcp_event",
      server: "events",
      event: "chat.message.received",
      arguments: { chatType: "group" },
    },
    projectId: "project-bots",
    threadId: "thread-bot",
    threadMode: "continue",
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    ...overrides,
  });

interface ServerCall {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly params: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly delivery: { readonly url: string; readonly secret?: string };
    readonly _meta: Record<string, unknown>;
  };
}

/** An MCP server with the Events extension: it verifies the hook before it subscribes. */
const makeFakeServer = (unsubscribes: Queue.Queue<ServerCall>) => {
  const calls: Array<ServerCall> = [];
  const state = {
    service: undefined as Service | undefined,
    subscribeError: null as { code: number; message: string } | null,
    /** Why the Bot can no longer hold the subscription, while it cannot. */
    resolveError: null as string | null,
    /** Holds every unsubscribe until it completes. */
    unsubscribeGate: null as Deferred.Deferred<void> | null,
    secret: "",
    deliveries: 0,
  };

  const subscriptionId = (params: ServerCall["params"]) =>
    `evs_${NodeCrypto.createHash("sha256")
      .update(JSON.stringify([params.name, params.arguments, params.delivery.url]))
      .digest("hex")
      .slice(0, 16)}`;

  /** Posts to a hook as the server does, signed with `secret` unless told otherwise. */
  const post = (
    url: string,
    body: unknown,
    options: {
      readonly webhookId: string;
      readonly subscriptionId: string;
      readonly secret?: string;
    },
  ) =>
    Effect.gen(function* () {
      const [hookId, token] = url.slice(`${LOCAL_ORIGIN}/api/hooks/`.length).split("/");
      const bodyText = JSON.stringify(body);
      const timestamp = String(Math.floor((yield* Clock.currentTimeMillis) / 1000));
      const key = Buffer.from((options.secret ?? state.secret).slice("whsec_".length), "base64");
      const signature = NodeCrypto.createHmac("sha256", key)
        .update(`${options.webhookId}.${timestamp}.${bodyText}`)
        .digest("base64");
      return yield* state.service!.triggerWebhook({
        hookId: decodeURIComponent(hookId!),
        token: token!,
        method: "POST",
        path: `/api/hooks/${hookId}`,
        query: "",
        headers: {
          "content-type": "application/json",
          "webhook-id": options.webhookId,
          "webhook-timestamp": timestamp,
          "webhook-signature": `v1,${signature}`,
          "x-mcp-subscription-id": options.subscriptionId,
        },
        body: new TextEncoder().encode(bodyText),
        bodyText,
      });
    });

  const respond = (request: Parameters<Parameters<typeof HttpClient.make>[0]>[0], body: unknown) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...body! }), {
        headers: { "content-type": "application/json" },
      }),
    );

  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const message =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : {};
      const call: ServerCall = {
        method: message.method,
        headers: request.headers,
        params: message.params,
      };
      calls.push(call);
      if (call.method === "events/unsubscribe") {
        yield* Queue.offer(unsubscribes, call);
        if (state.unsubscribeGate !== null) yield* Deferred.await(state.unsubscribeGate);
        return respond(request, { result: {} });
      }
      if (state.subscribeError !== null) {
        const error = state.subscribeError;
        state.subscribeError = null;
        return respond(request, { error });
      }
      state.secret = call.params.delivery.secret!;
      const challenge = `challenge-${calls.length}`;
      const answer = yield* post(
        call.params.delivery.url,
        { type: "verification", challenge },
        {
          webhookId: `msg_verification_${calls.length}`,
          subscriptionId: subscriptionId(call.params),
        },
      ).pipe(Effect.orDie);
      if (answer._tag !== "challenge" || answer.challenge !== challenge) {
        return respond(request, {
          error: { code: -32015, message: "The callback endpoint failed verification" },
        });
      }
      const now = yield* Clock.currentTimeMillis;
      return respond(request, {
        result: {
          id: subscriptionId(call.params),
          refreshBefore: DateTime.formatIso(DateTime.makeUnsafe(now + 24 * 60 * 60_000)),
          cursor: null,
        },
      });
    }),
  );

  const lastSubscribe = () => calls.findLast((call) => call.method === "events/subscribe")!;

  /** A notice about the subscription itself, such as that the server ended it. */
  const notify = (body: unknown) =>
    post(lastSubscribe().params.delivery.url, body, {
      webhookId: `msg_control_${calls.length}`,
      subscriptionId: subscriptionId(lastSubscribe().params),
    });

  /** An event delivery from the subscription the last subscribe made. */
  const deliver = (
    text: string,
    options: {
      readonly webhookId?: string;
      readonly subscriptionId?: string;
      readonly secret?: string;
    } = {},
  ) => {
    state.deliveries += 1;
    const last = lastSubscribe();
    return post(
      last.params.delivery.url,
      {
        eventId: `evt_${state.deliveries}`,
        name: last.params.name,
        timestamp: "1970-01-01T00:00:00.000Z",
        data: { chatType: "group", text },
        cursor: String(state.deliveries),
      },
      {
        webhookId: options.webhookId ?? `evt_${state.deliveries}`,
        subscriptionId: options.subscriptionId ?? subscriptionId(last.params),
        ...(options.secret === undefined ? {} : { secret: options.secret }),
      },
    );
  };

  return { calls, unsubscribes, state, client, deliver, notify, subscriptionId };
};

/** Runs `work`, then waits for a span named `name` that it started, even in a forked fiber, to end. */
const awaitingSpan = <A, E, R>(name: string, work: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const ended = yield* Deferred.make<void>();
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (...args) => {
          end(...args);
          if (span.name === name) Deferred.doneUnsafe(ended, Effect.void);
        };
        return span;
      },
    });
    const result = yield* work.pipe(Effect.withTracer(tracer));
    yield* Deferred.await(ended);
    return result;
  });

const withService = <A, E>(
  body: (input: {
    readonly service: Service;
    readonly server: ReturnType<typeof makeFakeServer>;
    readonly sends: Queue.Queue<SendInput>;
    readonly refresh: Effect.Effect<void>;
  }) => Effect.Effect<A, E, never>,
) =>
  Effect.gen(function* () {
    const server = makeFakeServer(yield* Queue.unbounded<ServerCall>());
    const sends = yield* Queue.unbounded<SendInput>();
    const workers = new Map<string, Effect.Effect<void>>();
    const layerPublisher = Layer.effect(
      ScheduledTaskService.ScheduledTaskMcpEventPublisher,
      McpEventClient.make(({ threadId, server: name }) =>
        server.state.resolveError !== null
          ? Effect.fail(
              new McpEventClient.McpEventRequestError({ message: server.state.resolveError }),
            )
          : threadId === ("thread-bot" as ThreadId) && name === "events"
            ? Effect.succeed({ url: SERVER_URL, headers: { authorization: "Bearer server-token" } })
            : Effect.fail(
                new McpEventClient.McpEventRequestError({ message: `No MCP server ${name}.` }),
              ),
      ),
    ).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, server.client)));
    const layerDependencies = Layer.mergeAll(
      NodePlatformCrypto.layer,
      Layer.succeed(Scheduler.Scheduler, {
        register: <E, R>(name: string, work: Effect.Effect<void, E, R>) =>
          Effect.gen(function* () {
            const context = yield* Effect.context<R>();
            workers.set(name, work.pipe(Effect.provideContext(context), Effect.orDie));
          }),
      }),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/projects" }),
      Layer.mock(SecretRequests.SecretRequests)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.succeed({ projectId: "project-bots", archivedAt: null, deletedAt: null } as never),
        sendToThread: (input) => Queue.offer(sends, input).pipe(Effect.as({} as never)),
        getProjectThreadRecords: () => Effect.succeed({ runs: [] } as never),
      }),
      Layer.succeed(
        ScheduledTaskService.ScheduledTaskWebhookOrigin,
        Effect.succeed({ relayHookBaseUrl: null, localOrigin: LOCAL_ORIGIN }),
      ),
      layerPublisher,
      ManagedPolicy.layerTest(),
    );
    return yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      server.state.service = service;
      return yield* body({
        service,
        server,
        sends,
        refresh: Effect.suspend(() => workers.get("mcp-event-subscriptions")!),
      });
    }).pipe(
      Effect.provide(
        Layer.fresh(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))),
      ),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory));

it.effect(
  "subscribes an event task, answers the server's verification without a run, and runs each signed event once",
  () =>
    withService(({ service, server, sends }) =>
      Effect.gen(function* () {
        const { task } = yield* service.upsert(yield* eventTaskInput());
        const [subscribe] = server.calls;
        assert.equal(subscribe?.method, "events/subscribe");
        assert.equal(subscribe?.headers["authorization"], "Bearer server-token");
        assert.equal(subscribe?.headers["mcp-method"], "events/subscribe");
        assert.equal(subscribe?.headers["mcp-protocol-version"], "2026-07-28");
        assert.deepEqual(subscribe?.params.arguments, { chatType: "group" });
        assert.isTrue(
          subscribe?.params.delivery.url.startsWith(
            `${LOCAL_ORIGIN}/api/hooks/${encodeURIComponent(task.id)}/`,
          ),
        );
        assert.match(subscribe?.params.delivery.secret ?? "", /^whsec_[A-Za-z0-9+/]{43}=$/);
        assert.containsAllKeys(subscribe?.params._meta ?? {}, [
          "io.modelcontextprotocol/protocolVersion",
          "io.modelcontextprotocol/clientInfo",
          "io.modelcontextprotocol/clientCapabilities",
        ]);
        assert.deepEqual(task.subscription, {
          status: "active",
          refreshBefore: "1970-01-02T00:00:00.000Z",
          lastError: null,
        });
        assert.isUndefined(task.webhook);
        assert.equal(yield* Queue.size(sends), 0);

        const accepted = yield* server.deliver("hello there");
        assert.equal(accepted._tag === "accepted" && accepted.outcome, "accepted");
        const sent = yield* Queue.take(sends);
        assert.equal(sent.threadId, "thread-bot");
        assert.include(sent.text, "hello there");

        const retried = yield* server.deliver("hello there", { webhookId: "evt_1" });
        assert.equal(retried._tag === "accepted" && retried.outcome, "duplicate");
        const forged = yield* server.deliver("forged", {
          secret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
        });
        assert.equal(forged._tag, "rejected_signature");
        assert.equal(yield* Queue.size(sends), 0);

        const unknown = yield* Effect.flip(
          service.upsert(
            yield* eventTaskInput({
              id: "scheduled-task:unknown",
              schedule: { type: "mcp_event", server: "missing", event: "chat.message.received" },
            }),
          ),
        );
        assert.equal(unknown.message, "No MCP server missing.");
        const unbound = yield* Effect.flip(
          service.upsert(
            yield* eventTaskInput({ id: "scheduled-task:unbound", threadMode: "new_thread" }),
          ),
        );
        assert.include(unbound.message, "Bot's thread");
      }),
    ),
);

it.effect(
  "refreshes before the deadline, retries failures, and ends the old subscription on edit, pause and delete",
  () =>
    withService(({ service, server, refresh }) =>
      Effect.gen(function* () {
        const subscribes = () => server.calls.filter((call) => call.method === "events/subscribe");
        const { task } = yield* service.upsert(yield* eventTaskInput());
        const firstId = server.subscriptionId(subscribes()[0]!.params);
        // The first pass after start subscribes every enabled task again.
        yield* refresh;
        assert.equal(subscribes().length, 2);
        yield* refresh;
        assert.equal(subscribes().length, 2);
        yield* TestClock.adjust("61 minutes");
        yield* refresh;
        assert.equal(subscribes().length, 3);

        server.state.subscribeError = { code: -32011, message: "No event with this name" };
        yield* TestClock.adjust("61 minutes");
        yield* refresh;
        const failed = (yield* service.list()).tasks[0]!;
        assert.equal(failed.subscription?.status, "failed");
        assert.equal(failed.subscription?.lastError, "No event with this name [-32011]");
        yield* TestClock.adjust("31 seconds");
        yield* refresh;
        assert.equal((yield* service.list()).tasks[0]!.subscription?.status, "active");

        const ended = yield* server.notify({
          type: "terminated",
          error: { message: "The server restarted." },
        });
        assert.equal(ended._tag, "acknowledged");
        assert.equal(
          (yield* service.list()).tasks[0]!.subscription?.lastError,
          "The MCP server ended the subscription: The server restarted.",
        );
        yield* TestClock.adjust("31 seconds");
        yield* refresh;
        assert.equal((yield* service.list()).tasks[0]!.subscription?.status, "active");

        const callsBeforeEdit = server.calls.length;
        yield* service.upsert(
          yield* eventTaskInput({
            schedule: {
              type: "mcp_event",
              server: "events",
              event: "chat.message.received",
              arguments: { chatId: "team@g.us" },
            },
          }),
        );
        const [unsubscribe, resubscribe] = server.calls.slice(callsBeforeEdit);
        assert.equal(unsubscribe?.method, "events/unsubscribe");
        assert.equal(yield* Queue.take(server.unsubscribes), unsubscribe);
        assert.deepEqual(unsubscribe?.params.arguments, { chatType: "group" });
        assert.isUndefined(unsubscribe?.params.delivery.secret);
        assert.equal(resubscribe?.method, "events/subscribe");
        assert.deepEqual(resubscribe?.params.arguments, { chatId: "team@g.us" });
        const replaced = yield* server.deliver("from the old subscription", {
          subscriptionId: firstId,
        });
        assert.equal(replaced._tag, "gone");

        yield* service.setEnabled({ id: task.id, enabled: false });
        const paused = yield* Queue.take(server.unsubscribes);
        assert.deepEqual(paused.params.arguments, { chatId: "team@g.us" });
        assert.isUndefined((yield* service.list()).tasks[0]!.subscription);

        yield* service.setEnabled({ id: task.id, enabled: true });
        const callsBeforeDelete = server.calls.length;
        yield* service.delete({ id: task.id });
        yield* Queue.take(server.unsubscribes);
        assert.deepEqual(
          server.calls.slice(callsBeforeDelete).map((call) => call.method),
          ["events/unsubscribe"],
        );
        yield* TestClock.adjust("2 hours");
        yield* refresh;
        assert.equal(server.calls.length, callsBeforeDelete + 1);
      }),
    ),
);

it.effect(
  "ends the subscription once its Bot can no longer hold it, and subscribes again when it can",
  () =>
    withService(({ service, server, refresh }) =>
      Effect.gen(function* () {
        yield* service.upsert(yield* eventTaskInput());
        const subscribed = server.calls.at(-1)!;
        server.state.resolveError = "An MCP event task runs in a Bot's thread.";
        yield* refresh;
        const ended = server.calls.at(-1)!;
        assert.equal(ended.method, "events/unsubscribe");
        assert.equal(ended.headers["authorization"], "Bearer server-token");
        assert.deepEqual(ended.params.arguments, subscribed.params.arguments);
        assert.equal(ended.params.delivery.url, subscribed.params.delivery.url);
        const failed = (yield* service.list()).tasks[0]!.subscription;
        assert.equal(failed?.status, "failed");
        assert.equal(failed?.lastError, "An MCP event task runs in a Bot's thread.");

        server.state.resolveError = null;
        yield* TestClock.adjust("31 seconds");
        yield* refresh;
        assert.equal(server.calls.at(-1)?.method, "events/subscribe");
        assert.equal((yield* service.list()).tasks[0]!.subscription?.status, "active");
      }),
    ),
);

it.effect("skips a queued event whose Bot can no longer hold the subscription", () =>
  withService(({ service, server, sends }) =>
    Effect.gen(function* () {
      const { task } = yield* service.upsert(yield* eventTaskInput());
      server.state.resolveError =
        'MCP server "events" uses stdio; events need a streamable HTTP server.';
      const accepted = yield* awaitingSpan(
        "ScheduledTaskService.runWebhookDelivery",
        server.deliver("after the server changed"),
      );
      assert.equal(accepted._tag === "accepted" && accepted.outcome, "accepted");
      assert.equal(yield* Queue.size(sends), 0);
      const [delivery] = (yield* service.listWebhookDeliveries({ id: task.id })).deliveries;
      assert.equal(delivery?.outcome, "dispatch_failed");
      assert.equal(delivery?.error, server.state.resolveError);
    }),
  ),
);

it.effect("deletes a task while its MCP server has not answered the unsubscribe", () =>
  withService(({ service, server }) =>
    Effect.gen(function* () {
      const { task } = yield* service.upsert(yield* eventTaskInput());
      const unsubscribeGate = yield* Deferred.make<void>();
      server.state.unsubscribeGate = unsubscribeGate;
      yield* service.delete({ id: task.id });
      assert.deepEqual((yield* service.list()).tasks, []);
      const ended = yield* Queue.take(server.unsubscribes);
      assert.deepEqual(ended.params.arguments, { chatType: "group" });
      yield* Deferred.succeed(unsubscribeGate, undefined);
    }),
  ),
);

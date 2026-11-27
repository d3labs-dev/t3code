import type {
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskMcpEventSubscription,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";

import type { McpEventPublisher, McpEventServer, McpEventTarget } from "./McpEventClient.ts";

const MIN_REFRESH_MS = 30_000;
// Publishers keep subscriptions in memory, so this also bounds what one restart of theirs loses.
const MAX_REFRESH_MS = 60 * 60_000;
const FIRST_RETRY_MS = 30_000;

export type McpEventSchedule = Extract<ScheduledTask["schedule"], { readonly type: "mcp_event" }>;

/** An enabled event task, where its deliveries go and the secret that signs them. */
export interface McpEventDesired {
  readonly task: Pick<ScheduledTask, "id" | "createdAt" | "threadId"> & {
    readonly schedule: McpEventSchedule;
  };
  /** Null while this server has no address to receive deliveries at. */
  readonly url: string | null;
  readonly secret: string;
}

interface Entry {
  readonly createdAt: string;
  readonly serverName: string;
  // Kept from the last resolve, so a subscription can still end after its Bot is gone.
  readonly server: McpEventServer | null;
  readonly target: McpEventTarget | null;
  /** Null until the server names it; any subscription id is accepted until then. */
  readonly subscriptionId: string | null;
  readonly state: ScheduledTaskMcpEventSubscription;
  readonly failures: number;
  readonly nextAttemptAt: number;
}

const PENDING: ScheduledTaskMcpEventSubscription = {
  status: "pending",
  refreshBefore: null,
  lastError: null,
};

const sameTarget = (a: McpEventTarget | null, b: McpEventTarget | null) =>
  a !== null &&
  b !== null &&
  a.event === b.event &&
  a.url === b.url &&
  JSON.stringify(Object.entries(a.arguments).toSorted()) ===
    JSON.stringify(Object.entries(b.arguments).toSorted());

const refreshAt = (now: number, refreshBefore: string | null) => {
  const deadline = Option.fromNullishOr(refreshBefore).pipe(
    Option.flatMap(DateTime.make),
    Option.map(DateTime.toEpochMillis),
  );
  const half = Option.isSome(deadline) ? (deadline.value - now) / 2 : MAX_REFRESH_MS;
  return now + Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, half));
};

const retryAt = (now: number, failures: number) =>
  now + Math.min(MAX_REFRESH_MS, FIRST_RETRY_MS * 2 ** (failures - 1));

/**
 * Keeps event tasks subscribed at their MCP servers. State lives in memory: the server's own
 * subscriptions are finite and in memory too, so after a restart every enabled task subscribes
 * again, which the server treats as a refresh.
 */
export const make = Effect.fnUntraced(function* (input: {
  readonly publisher: McpEventPublisher;
  readonly notifyChanged: Effect.Effect<void>;
}) {
  const { publisher, notifyChanged } = input;
  const scope = yield* Effect.scope;
  const entries = yield* Ref.make<ReadonlyMap<ScheduledTaskId, Entry>>(new Map());
  const locks = yield* Ref.make<ReadonlyMap<ScheduledTaskId, Semaphore.Semaphore>>(new Map());

  const setEntry = (id: ScheduledTaskId, entry: Entry | undefined) =>
    Ref.update(entries, (current) => {
      const next = new Map(current);
      if (entry === undefined) next.delete(id);
      else next.set(id, entry);
      return next;
    }).pipe(Effect.andThen(notifyChanged));

  // One operation per task at a time. Forked into the service scope, so a caller that goes away
  // cannot stop a subscribe between the server's answer and the record of it.
  const exclusive = <A, E>(id: ScheduledTaskId, effect: Effect.Effect<A, E>) =>
    Ref.modify(locks, (current) => {
      const existing = current.get(id);
      if (existing !== undefined) return [existing, current] as const;
      const created = Semaphore.makeUnsafe(1);
      return [created, new Map(current).set(id, created)] as const;
    }).pipe(
      Effect.flatMap((lock) => lock.withPermits(1)(effect)),
      Effect.forkIn(scope),
      Effect.flatMap(Fiber.join),
    );

  const end = (entry: Entry) =>
    entry.server === null || entry.target === null
      ? Effect.void
      : publisher.unsubscribe({ server: entry.server, target: entry.target }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not end an MCP event subscription.", {
              event: entry.target?.event,
              error: error.message,
            }),
          ),
        );

  // `ensure` and `drop` run only inside `sync`, which owns the span.
  const ensure = Effect.fnUntraced(function* (desired: McpEventDesired) {
    const { task } = desired;
    const target: McpEventTarget | null =
      desired.url === null
        ? null
        : { event: task.schedule.event, arguments: task.schedule.arguments, url: desired.url };
    const previous = (yield* Ref.get(entries)).get(task.id);
    const same =
      previous !== undefined &&
      previous.createdAt === task.createdAt &&
      previous.serverName === task.schedule.server &&
      sameTarget(previous.target, target);
    if (previous !== undefined && !same) {
      yield* end(previous);
      yield* setEntry(task.id, undefined);
    }
    const resolved =
      task.threadId === null
        ? Result.fail("An MCP event task needs a Bot's thread.")
        : yield* publisher.resolve({ threadId: task.threadId, server: task.schedule.server }).pipe(
            Effect.mapError((error) => error.message),
            Effect.result,
          );
    const subscribed: Result.Result<
      { readonly id: string; readonly refreshBefore: string | null },
      string
    > =
      target === null
        ? Result.fail("This server has no address for event deliveries yet.")
        : Result.isFailure(resolved)
          ? Result.fail(resolved.failure)
          : yield* publisher
              .subscribe({ server: resolved.success, target, secret: desired.secret })
              .pipe(
                Effect.mapError((error) => error.message),
                Effect.result,
              );
    const now = yield* Clock.currentTimeMillis;
    const base = {
      createdAt: task.createdAt,
      serverName: task.schedule.server,
      server: Result.isSuccess(resolved) ? resolved.success : same ? previous.server : null,
      target,
    };
    if (Result.isSuccess(subscribed)) {
      return yield* setEntry(task.id, {
        ...base,
        subscriptionId: subscribed.success.id,
        state: {
          status: "active",
          refreshBefore: subscribed.success.refreshBefore,
          lastError: null,
        },
        failures: 0,
        nextAttemptAt: refreshAt(now, subscribed.success.refreshBefore),
      });
    }
    const failures = (same ? previous.failures : 0) + 1;
    yield* setEntry(task.id, {
      ...base,
      subscriptionId: same ? previous.subscriptionId : null,
      state: {
        status: "failed",
        refreshBefore: same ? previous.state.refreshBefore : null,
        lastError: subscribed.failure,
      },
      failures,
      nextAttemptAt: retryAt(now, failures),
    });
  });

  const drop = Effect.fnUntraced(function* (id: ScheduledTaskId) {
    const entry = (yield* Ref.get(entries)).get(id);
    if (entry === undefined) return;
    yield* setEntry(id, undefined);
    yield* end(entry);
  });

  /**
   * Subscribes, refreshes or unsubscribes to match the task as `load` reads it under the task's
   * lock, so a refresh that read the task before a pause cannot subscribe it again.
   */
  const sync = Effect.fn("McpEventSubscriptions.sync")(function* <E>(
    id: ScheduledTaskId,
    load: Effect.Effect<McpEventDesired | null, E>,
  ) {
    yield* exclusive(
      id,
      Effect.flatMap(load, (desired) => (desired === null ? drop(id) : ensure(desired))),
    );
  });

  /** The server ended the subscription itself; subscribe again with backoff. */
  const terminated = Effect.fn("McpEventSubscriptions.terminated")(function* (
    id: ScheduledTaskId,
    message: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const entry = (yield* Ref.get(entries)).get(id);
    if (entry === undefined) return;
    const failures = entry.failures + 1;
    yield* setEntry(id, {
      ...entry,
      state: { ...entry.state, status: "failed", lastError: message },
      failures,
      nextAttemptAt: retryAt(now, failures),
    });
  });

  return {
    sync,
    terminated,
    /** Tasks whose refresh or retry is due. */
    due: (now: number) =>
      Ref.get(entries).pipe(
        Effect.map((current) =>
          [...current].flatMap(([id, entry]) => (entry.nextAttemptAt <= now ? [id] : [])),
        ),
      ),
    /** The subscription state of an enabled event task, pending until it first answers. */
    state: (task: Pick<ScheduledTask, "id" | "createdAt">) =>
      Ref.get(entries).pipe(
        Effect.map((current) => {
          const entry = current.get(task.id);
          return entry?.createdAt === task.createdAt ? entry.state : PENDING;
        }),
      ),
    /**
     * Whether a delivery comes from the task's current subscription. One replaced by an edit,
     * or left at a URL this server no longer uses, can live on at the server until it expires.
     */
    isCurrent: (id: ScheduledTaskId, subscriptionId: string | undefined) =>
      Ref.get(entries).pipe(
        Effect.map((current) => {
          const known = current.get(id)?.subscriptionId ?? null;
          return known === null || subscriptionId === undefined || subscriptionId === known;
        }),
      ),
  };
});

import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as RecentThreadMessages from "./RecentThreadMessages.ts";

const TestLayer = Layer.mergeAll(RecentThreadMessages.layer, ProjectionStore.layer).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 29, 0, minute));

const thread = (threadId: ThreadId): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project:voice"),
    title: threadId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  },
});

const message = (
  threadId: ThreadId,
  id: string,
  role: "user" | "assistant",
  text: string,
  minute: number,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`message:${id}`),
  type: "message.updated",
  threadId,
  providerInstanceId,
  occurredAt: at(minute),
  payload: {
    createdBy: role === "user" ? "user" : "agent",
    creationSource: role === "user" ? "web" : "provider",
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: false,
    createdAt: at(minute),
    updatedAt: at(minute),
  },
});

it.layer(TestLayer)("RecentThreadMessages", (it) => {
  it.effect("returns the thread's latest messages oldest first", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const recent = yield* RecentThreadMessages.RecentThreadMessages;
      const dictated = ThreadId.make("thread:dictated");
      const other = ThreadId.make("thread:other");
      yield* Effect.forEach(
        [
          thread(dictated),
          thread(other),
          message(dictated, "first", "user", "Wire dictation into the composer.", 1),
          message(dictated, "third", "user", "Now read the thread.", 3),
          message(dictated, "second", "assistant", "Added `useComposerVoiceInput`.", 2),
          message(other, "elsewhere", "user", "Unrelated thread.", 4),
        ],
        projections.apply,
        { discard: true },
      );

      assert.deepEqual(yield* recent.list({ threadId: dictated, limit: 2 }), [
        { text: "Added `useComposerVoiceInput`." },
        { text: "Now read the thread." },
      ]);
      assert.deepEqual(
        yield* recent.list({ threadId: ThreadId.make("thread:none"), limit: 6 }),
        [],
      );
    }),
  );
});

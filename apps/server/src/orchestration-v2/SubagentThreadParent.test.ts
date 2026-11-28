import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  isListedThreadLineage,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { SubagentThreadParent } from "./SubagentThreadParent.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for metadata commands"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(NodeCrypto.layerDigest), Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "subagent-thread-parent" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const createThread = (threadId: ThreadId, projectId = ProjectId.make("project:bots")) =>
  Orchestrator.OrchestratorV2.pipe(
    Effect.flatMap((orchestrator) =>
      orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`create:${threadId}`),
        threadId,
        projectId,
        title: threadId,
        modelSelection: { instanceId, model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "agent",
        creationSource: "server",
      }),
    ),
  );

it.layer(layerTest)("SubagentThreadParent", (it) => {
  it.effect("creates a hidden subagent of the parent, and only under its project", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const parentId = ThreadId.make("thread:bot");
      const scoutId = ThreadId.make("thread:bot-scout");
      yield* createThread(parentId);
      yield* createThread(scoutId).pipe(Effect.provideService(SubagentThreadParent, parentId));

      assert.deepStrictEqual((yield* projections.findThread(scoutId))?.lineage, {
        parentThreadId: parentId,
        relationshipToParent: "subagent",
        rootThreadId: parentId,
      });
      const listed = (yield* projections.getShellSnapshot()).threads
        .filter((thread) => isListedThreadLineage(thread.lineage))
        .map((thread) => thread.id);
      assert.include(listed, parentId);
      assert.notInclude(listed, scoutId);

      const refusedUnder = (parent: ThreadId, child: ThreadId, projectId?: ProjectId) =>
        createThread(child, projectId).pipe(
          Effect.provideService(SubagentThreadParent, parent),
          Effect.flip,
          Effect.flatMap((error) =>
            Effect.map(projections.findThread(child), (created) => ({
              error: error._tag,
              created,
            })),
          ),
        );
      const refusal = { error: "OrchestratorDispatchError", created: null } as const;
      assert.deepStrictEqual(
        yield* refusedUnder(
          parentId,
          ThreadId.make("thread:bot-scout-elsewhere"),
          ProjectId.make("project:other"),
        ),
        refusal,
      );
      assert.deepStrictEqual(
        yield* refusedUnder(ThreadId.make("thread:missing"), ThreadId.make("thread:orphan")),
        refusal,
      );

      const deletedId = ThreadId.make("thread:deleted-bot");
      yield* createThread(deletedId);
      yield* Orchestrator.OrchestratorV2.pipe(
        Effect.flatMap((orchestrator) =>
          orchestrator.dispatch({
            type: "thread.delete",
            commandId: CommandId.make(`delete:${deletedId}`),
            threadId: deletedId,
          }),
        ),
      );
      assert.deepStrictEqual(
        yield* refusedUnder(deletedId, ThreadId.make("thread:deleted-bot-scout")),
        refusal,
      );
    }),
  );
});

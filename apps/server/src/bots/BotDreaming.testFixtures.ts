import {
  MessageId,
  NodeId,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { BOT_DREAMING_PROMPT } from "@t3tools/shared/botDreaming";
import * as DateTime from "effect/DateTime";

import type { BotDreamingRecords } from "./BotDreaming.ts";

export const NOW_MS = Date.parse("2026-10-19T12:00:00.000Z");
export const MINUTE_MS = 60_000;
export const at = (offset = 0) => DateTime.makeUnsafe(NOW_MS + offset);
export const botThreadId = ThreadId.make("bot-thread");
const providerThreadId = ProviderThreadId.make("bot-provider-thread");
const nodeId = NodeId.make("bot-root-node");

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

export interface BotRunFixture {
  readonly text: string;
  readonly status?: BotDreamingRecords["runs"][number]["status"];
  readonly sentByServer?: boolean;
}

export const serverDreamRun: BotRunFixture = { text: BOT_DREAMING_PROMPT, sentByServer: true };

/** A Bot thread whose runs completed in order, the last one now. */
export function botRecords(
  options: {
    readonly driver?: string;
    readonly usedTokens?: number;
    readonly cacheExpiresInMs?: number;
    readonly runs?: ReadonlyArray<BotRunFixture>;
  } = {},
): Mutable<BotDreamingRecords> {
  const driver = ProviderDriverKind.make(options.driver ?? "claudeAgent");
  const instanceId = ProviderInstanceId.make(options.driver ?? "claudeAgent");
  const modelSelection = { instanceId, model: "model" };
  const runFixtures = options.runs ?? [{ text: "Plan the release" }];
  const runs = runFixtures.map((fixture, index) => ({
    id: RunId.make(`run-${index + 1}`),
    threadId: botThreadId,
    ordinal: index + 1,
    providerInstanceId: instanceId,
    modelSelection,
    providerThreadId,
    userMessageId: MessageId.make(`message-${index + 1}`),
    rootNodeId: nodeId,
    activeAttemptId: null,
    status: fixture.status ?? ("completed" as const),
    requestedAt: at(-MINUTE_MS),
    startedAt: at(-MINUTE_MS),
    completedAt: at(),
    checkpointId: null,
    contextHandoffId: null,
  }));
  return {
    thread: {
      id: botThreadId,
      projectId: ProjectId.make("bots"),
      title: "Bot",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { rootThreadId: botThreadId, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdAt: at(-MINUTE_MS),
      updatedAt: at(),
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: at(),
      deletedAt: null,
    },
    runs,
    messages: runs.map((run, index) => ({
      id: run.userMessageId,
      threadId: botThreadId,
      runId: run.id,
      nodeId,
      role: "user" as const,
      text: runFixtures[index]!.text,
      attachments: [],
      streaming: false,
      ...(runFixtures[index]!.sentByServer === true
        ? { createdBy: "agent" as const, creationSource: "server" as const }
        : { createdBy: "user" as const, creationSource: "web" as const }),
      createdAt: at(-MINUTE_MS),
      updatedAt: at(-MINUTE_MS),
    })),
    providerThreads: [
      {
        id: providerThreadId,
        driver,
        providerInstanceId: instanceId,
        providerSessionId: null,
        appThreadId: botThreadId,
        ownerNodeId: nodeId,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: 1,
        lastRunOrdinal: runs.length,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        createdAt: at(-MINUTE_MS),
        updatedAt: at(),
      },
    ],
    providerTurns: [
      {
        id: ProviderTurnId.make("provider-turn"),
        providerThreadId,
        nodeId,
        runAttemptId: null,
        nativeTurnRef: null,
        ordinal: runs.length,
        status: "completed",
        startedAt: at(-MINUTE_MS),
        completedAt: at(),
        tokenUsage: {
          usedTokens: options.usedTokens ?? 120_000,
          ...(options.cacheExpiresInMs === undefined
            ? {}
            : { promptCacheExpiresAt: DateTime.formatIso(at(options.cacheExpiresInMs)) }),
          updatedAt: DateTime.formatIso(at()),
        },
      },
    ],
    runtimeRequests: [],
    turnItems: [],
    contextTransfers: [],
  };
}

export function botProjection(records: BotDreamingRecords): OrchestrationV2ThreadProjection {
  return {
    ...records,
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    plans: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    visibleTurnItems: [],
    updatedAt: at(),
  };
}

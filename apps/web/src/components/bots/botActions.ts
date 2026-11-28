import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedBotEntry } from "@t3tools/client-runtime/state/bots";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type BotUpdateInput,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import { botsEnvironment } from "../../state/bots";
import { useConnectedEnvironmentIds, usePrimaryEnvironmentId } from "../../state/environments";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useBotsUiStore } from "./botsUiStore";

const NO_PERMISSION_ATOM = Atom.make(false).pipe(Atom.withLabel("web-bots:no-permission"));

/** New Bots land on the primary environment while it's connected, else the first connected one. */
export function useDefaultBotEnvironmentId(): EnvironmentId | null {
  const connectedIds = useConnectedEnvironmentIds();
  const primaryId = usePrimaryEnvironmentId();
  return primaryId !== null && connectedIds.includes(primaryId)
    ? primaryId
    : (connectedIds[0] ?? null);
}

export function useCanCreateBot(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(
    environmentId === null
      ? NO_PERMISSION_ATOM
      : botsEnvironment.createBot.permissionAtom(environmentId),
  );
}

export function reportBotFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** Bot threads live in Bots mode, coding threads in Threads mode; opening one moves the sidebar. */
export function useOpenThreadInMode() {
  const navigate = useNavigate();
  const setSidebarMode = useBotsUiStore((state) => state.setSidebarMode);
  return (mode: "threads" | "bots", environmentId: EnvironmentId, threadId: ThreadId) => {
    setSidebarMode(mode);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };
}

export function useUpdateBot() {
  const updateBot = useAtomCommand(botsEnvironment.updateBot, {
    label: "bot update",
    reportFailure: false,
  });
  return async (
    environmentId: EnvironmentId,
    input: BotUpdateInput,
    failureTitle = m(msg("Could not update Bot")),
  ): Promise<boolean> => {
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
    const result = await updateBot({ environmentId, input });
    reportBotFailure(failureTitle, result);
    return result._tag === "Success";
  };
}

export function useToggleBotMuted() {
  const update = useUpdateBot();
  return ({ environmentId, bot }: ScopedBotEntry) =>
    update(
      environmentId,
      { botId: bot.id, muted: !bot.muted },
      bot.muted ? m(msg("Could not unmute Bot")) : m(msg("Could not mute Bot")),
    );
}

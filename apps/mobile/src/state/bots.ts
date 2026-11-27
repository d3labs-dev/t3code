import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type BotsIndex,
  type ScopedBotEntry,
  type ScopedCodingThreadSupervisor,
  createBotsEnvironmentAtoms,
  indexBotsAcrossEnvironments,
} from "@t3tools/client-runtime/state/bots";
import type { BotId, BotListResult, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { connectedEnvironmentIdsAtom } from "./presentation";
import { useEnvironmentQuery } from "./query";

export const botsEnvironment = createBotsEnvironmentAtoms(connectionAtomRuntime);

const EMPTY_BOTS_INDEX: BotsIndex = indexBotsAcrossEnvironments([]);

// Every emission decodes fresh objects, so equal rosters must compare structurally to keep the index.
const botListResultsAtom = Atom.make((get) => {
  const entries: Array<readonly [EnvironmentId, BotListResult]> = [];
  for (const environmentId of get(connectedEnvironmentIdsAtom)) {
    const result = AsyncResult.getOrElse(
      get(botsEnvironment.botsLive({ environmentId, input: { includeArchived: true } })),
      () => null,
    );
    if (result !== null) entries.push([environmentId, result]);
  }
  return entries;
}).pipe(Atom.withEquality(Equal.equals), Atom.withLabel("mobile-bots:list-results"));

export const botsIndexAtom = Atom.make((get): BotsIndex => {
  const entries = get(botListResultsAtom);
  return entries.length === 0 ? EMPTY_BOTS_INDEX : indexBotsAcrossEnvironments(entries);
}).pipe(Atom.withLabel("mobile-bots:index"));

const NULL_ATOM = Atom.make(null).pipe(Atom.withLabel("mobile-bots:null"));

const botByThreadKeyAtom = Atom.family((threadKey: string) =>
  Atom.make(
    (get): ScopedBotEntry | null => get(botsIndexAtom).botByThreadKey.get(threadKey) ?? null,
  ).pipe(Atom.withEquality(Equal.equals), Atom.withLabel(`mobile-bots:by-thread:${threadKey}`)),
);

const supervisorByThreadKeyAtom = Atom.family((threadKey: string) =>
  Atom.make(
    (get): ScopedCodingThreadSupervisor | null =>
      get(botsIndexAtom).supervisorByCodingThreadKey.get(threadKey) ?? null,
  ).pipe(Atom.withEquality(Equal.equals), Atom.withLabel(`mobile-bots:supervisor:${threadKey}`)),
);

export function useBotsIndex(): BotsIndex {
  return useAtomValue(botsIndexAtom);
}

export function useBotForThread(ref: ScopedThreadRef | null): ScopedBotEntry | null {
  return useAtomValue(ref === null ? NULL_ATOM : botByThreadKeyAtom(scopedThreadKey(ref)));
}

export function useSupervisorForThread(
  ref: ScopedThreadRef | null,
): ScopedCodingThreadSupervisor | null {
  return useAtomValue(ref === null ? NULL_ATOM : supervisorByThreadKeyAtom(scopedThreadKey(ref)));
}

export function useBotDetail(environmentId: EnvironmentId, botId: BotId) {
  return useEnvironmentQuery(botsEnvironment.botDetail({ environmentId, input: { botId } }));
}

export function useBotExchanges(environmentId: EnvironmentId, botId: BotId) {
  return useEnvironmentQuery(botsEnvironment.botExchanges({ environmentId, input: { botId } }));
}

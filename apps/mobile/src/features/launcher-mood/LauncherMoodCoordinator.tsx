import { useAtomValue } from "@effect/atom-react";
import type { NavigationState } from "@react-navigation/native";
import { resolveMascotMood } from "@t3tools/client-runtime/state/mascot-mood";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEffect, useMemo, useRef, useState } from "react";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { useThreadShells } from "../../state/entities";
import { environmentShellSummaryAtom } from "../../state/shell";
import { activeThreadRef } from "../shortcuts/appShortcuts";
import { launcherMoodModule } from "./launcherMood";
import { lastVisitedAt, recordVisit } from "./launcherMoodVisits";

// Idle, stuck, and snooze wakes depend on the clock, not on any thread update.
const CLOCK_TICK_MS = 60_000;

/** Keeps the Android launcher icon's cat in step with the threads. */
export function LauncherMoodCoordinator(props: { readonly navigationState: NavigationState }) {
  if (launcherMoodModule === null) return null;
  const openThread = activeThreadRef(props.navigationState);
  return (
    <LauncherMood
      openThreadKey={
        openThread === null ? null : scopedThreadKey(openThread.environmentId, openThread.threadId)
      }
    />
  );
}

function LauncherMood(props: { readonly openThreadKey: string | null }) {
  const { openThreadKey } = props;
  const hasSnapshot = useAtomValue(environmentShellSummaryAtom).hasSnapshot;
  const shells = useThreadShells();
  const [nowMs, setNowMs] = useState(Date.now);
  const sentMood = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const openShell = useMemo(
    () =>
      openThreadKey === null
        ? undefined
        : shells.find((shell) => threadKey(shell) === openThreadKey),
    [shells, openThreadKey],
  );

  // Each update the open thread shows is seen, so the visit left behind covers all of them.
  useEffect(() => {
    if (openThreadKey === null || openShell === undefined) return;
    recordVisit({ threadKey: openThreadKey, visitedAt: new Date().toISOString() });
  }, [openThreadKey, openShell]);

  // The open thread is on screen, so it is seen as of now. Stored visits change only for the
  // open thread, and leaving it changes openThreadKey, so the stored ones read here are current.
  const mood = useMemo(() => {
    const seenNow = new Date().toISOString();
    return resolveMascotMood({
      threads: shells.map((shell) => {
        const key = threadKey(shell);
        return { ...shell, lastVisitedAt: key === openThreadKey ? seenNow : lastVisitedAt(key) };
      }),
      nowMs,
    });
  }, [shells, openThreadKey, nowMs]);

  useEffect(() => {
    if (!hasSnapshot || sentMood.current === mood) return;
    sentMood.current = mood;
    launcherMoodModule?.setLauncherMood(mood);
  }, [hasSnapshot, mood]);

  return null;
}

function threadKey(shell: EnvironmentThreadShell): string {
  return scopedThreadKey(shell.environmentId, shell.id);
}

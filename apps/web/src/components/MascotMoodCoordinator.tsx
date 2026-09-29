import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useMemo, useRef, useState } from "react";

import { resolveMascotMood } from "../mascotMood";
import { resolveThreadLastVisitedAt } from "./Sidebar.logic";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";

// Idle, stuck, and snooze wakes depend on the clock, not on any thread update.
const CLOCK_TICK_MS = 60_000;

/** Keeps the macOS Dock mascot in step with the threads. */
export function MascotMoodCoordinator() {
  if (window.desktopBridge?.setDockMood === undefined) return null;
  return <DockMood />;
}

function DockMood() {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const shells = useThreadShells();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const [nowMs, setNowMs] = useState(Date.now);
  const sentMood = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const mood = useMemo(
    () =>
      resolveMascotMood({
        threads: shells.map((shell) => ({
          ...shell,
          lastVisitedAt: resolveThreadLastVisitedAt(
            shell.lastVisitedAt,
            lastVisitedAtById[scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))],
          ),
        })),
        nowMs,
      }),
    [shells, lastVisitedAtById, nowMs],
  );

  useEffect(() => {
    if (!bootstrapped || sentMood.current === mood) return;
    sentMood.current = mood;
    void window.desktopBridge?.setDockMood?.(mood).catch(() => undefined);
  }, [bootstrapped, mood]);

  return null;
}

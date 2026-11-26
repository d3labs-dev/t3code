import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import type { BotVisualStyle } from "./botAvatars";

export type BotsSidebarMode = "threads" | "bots";

interface BotsUiState {
  sidebarMode: BotsSidebarMode;
  visualStyle: BotVisualStyle;
  collapsedGroups: Record<string, boolean>;
  expandedBotThreads: Record<string, boolean>;
  newBotDialogOpen: boolean;
  setSidebarMode: (mode: BotsSidebarMode) => void;
  toggleSidebarMode: () => void;
  setVisualStyle: (style: BotVisualStyle) => void;
  toggleGroupCollapsed: (groupKey: string) => void;
  toggleBotThreadsExpanded: (botKey: string) => void;
  openNewBotDialog: () => void;
  closeNewBotDialog: () => void;
}

function toggleKey(record: Record<string, boolean>, key: string): Record<string, boolean> {
  if (record[key] === true) {
    const { [key]: _removed, ...rest } = record;
    return rest;
  }
  return { ...record, [key]: true };
}

export const useBotsUiStore = create<BotsUiState>()(
  persist(
    (set) => ({
      sidebarMode: "threads",
      visualStyle: "playful",
      collapsedGroups: {},
      expandedBotThreads: {},
      newBotDialogOpen: false,
      setSidebarMode: (sidebarMode) => set({ sidebarMode }),
      toggleSidebarMode: () =>
        set((state) => ({ sidebarMode: state.sidebarMode === "bots" ? "threads" : "bots" })),
      setVisualStyle: (visualStyle) => set({ visualStyle }),
      toggleGroupCollapsed: (groupKey) =>
        set((state) => ({ collapsedGroups: toggleKey(state.collapsedGroups, groupKey) })),
      toggleBotThreadsExpanded: (botKey) =>
        set((state) => ({ expandedBotThreads: toggleKey(state.expandedBotThreads, botKey) })),
      openNewBotDialog: () => set({ newBotDialogOpen: true }),
      closeNewBotDialog: () => set({ newBotDialogOpen: false }),
    }),
    {
      name: "t3code:bots-ui:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        sidebarMode: state.sidebarMode,
        visualStyle: state.visualStyle,
        collapsedGroups: state.collapsedGroups,
        expandedBotThreads: state.expandedBotThreads,
      }),
    },
  ),
);

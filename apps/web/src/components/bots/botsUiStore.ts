import type { BotId, EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { type BotVisualStyle, parseBotVisualStyle } from "./botAvatars";

export type BotsSidebarMode = "threads" | "bots";

export type BotSettingsTab = "profile" | "soul" | "capabilities";

export interface BotSettingsTarget {
  readonly environmentId: EnvironmentId;
  readonly botId: BotId;
  readonly tab: BotSettingsTab;
}

interface BotsUiState {
  sidebarMode: BotsSidebarMode;
  visualStyle: BotVisualStyle;
  collapsedGroups: Record<string, boolean>;
  expandedBotThreads: Record<string, boolean>;
  newBotDialogOpen: boolean;
  /** Kept through the close animation; botSettingsOpen drives the dialog. */
  botSettings: BotSettingsTarget | null;
  botSettingsOpen: boolean;
  setSidebarMode: (mode: BotsSidebarMode) => void;
  toggleSidebarMode: () => void;
  setVisualStyle: (style: BotVisualStyle) => void;
  toggleGroupCollapsed: (groupKey: string) => void;
  toggleBotThreadsExpanded: (botKey: string) => void;
  openNewBotDialog: () => void;
  closeNewBotDialog: () => void;
  openBotSettings: (
    target: Omit<BotSettingsTarget, "tab"> & { readonly tab?: BotSettingsTab },
  ) => void;
  closeBotSettings: () => void;
  clearBotSettings: () => void;
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
      visualStyle: parseBotVisualStyle(undefined),
      collapsedGroups: {},
      expandedBotThreads: {},
      newBotDialogOpen: false,
      botSettings: null,
      botSettingsOpen: false,
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
      openBotSettings: ({ environmentId, botId, tab = "profile" }) =>
        set({ botSettings: { environmentId, botId, tab }, botSettingsOpen: true }),
      closeBotSettings: () => set({ botSettingsOpen: false }),
      clearBotSettings: () => set((state) => (state.botSettingsOpen ? {} : { botSettings: null })),
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
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<BotsUiState>;
        return { ...current, ...stored, visualStyle: parseBotVisualStyle(stored.visualStyle) };
      },
    },
  ),
);

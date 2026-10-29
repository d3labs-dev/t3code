import { create } from "zustand";

/** A panel that replaces the sidebar's normal contents while it is open. */
export type SidebarPanel = "background";

type SidebarPanelStore = {
  panel: SidebarPanel | null;
  openSidebarPanel: (panel: SidebarPanel) => void;
  closeSidebarPanel: () => void;
};

/**
 * Which panel the sidebar is showing, if any. One slot rather than a flag per
 * panel: the sidebar can only show one, and opening a second has to close the
 * first rather than leave both believing they are visible.
 */
export const useSidebarPanelStore = create<SidebarPanelStore>((set) => ({
  panel: null,
  openSidebarPanel: (panel) => set({ panel }),
  closeSidebarPanel: () => set({ panel: null }),
}));

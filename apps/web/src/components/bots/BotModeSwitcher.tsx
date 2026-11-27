import { cn } from "../../lib/utils";
import { useBotsIndex } from "../../state/bots";
import { type BotsSidebarMode, useBotsUiStore } from "./botsUiStore";

const MODES = [
  { id: "bots", label: "Bots" },
  { id: "threads", label: "Threads" },
] as const satisfies ReadonlyArray<{ id: BotsSidebarMode; label: string }>;

function useActiveBotWork(): number {
  const index = useBotsIndex();
  let busyBots = 0;
  for (const { bot, status } of index.bots) {
    if (bot.archivedAt === null && (status === "working" || status === "waiting")) busyBots++;
  }
  return busyBots + index.activeCodingThreadCount;
}

export function BotModeSwitcher() {
  const mode = useBotsUiStore((state) => state.sidebarMode);
  const setMode = useBotsUiStore((state) => state.setSidebarMode);
  const activeWork = useActiveBotWork();
  return (
    <div
      role="tablist"
      aria-label="Sidebar mode"
      className="flex h-8 min-w-0 items-center gap-0.5 rounded-lg border border-sidebar-border/60 bg-sidebar-control-surface/45 p-0.5"
    >
      {MODES.map((option) => {
        const selected = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setMode(option.id)}
            className={cn(
              "flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
              selected
                ? "bg-sidebar-row-active text-sidebar-foreground shadow-xs ring-1 ring-inset ring-sidebar-border/80"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
            )}
          >
            <span className="truncate">{option.label}</span>
            {option.id === "bots" && activeWork > 0 ? (
              <span
                className="inline-flex h-4 shrink-0 items-center gap-1 rounded-full bg-info/15 px-1.5 text-2xs font-semibold tabular-nums text-info-foreground"
                aria-label={`${activeWork} active`}
              >
                <span className="size-1.5 rounded-full bg-info" aria-hidden />
                {activeWork}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

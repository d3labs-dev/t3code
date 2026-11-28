import {
  BOT_EXCHANGE_STATUS_LABEL,
  type ScopedCodingThreadSupervisor,
} from "@t3tools/client-runtime/state/bots";
import { ArrowUpRightIcon } from "lucide-react";

import { Button } from "../ui/button";
import { BotAvatar } from "./BotAvatar";
import { useOpenThreadInMode } from "./botActions";

export function BotSupervisedBanner({
  supervisor,
}: {
  readonly supervisor: ScopedCodingThreadSupervisor;
}) {
  const openThread = useOpenThreadInMode();
  const { botEntry, link } = supervisor;
  const { bot } = botEntry;
  const watching = link.status === "pending";
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[min(36rem,calc(100%-2rem))] pt-3">
      <div
        className="surface-glass flex min-w-0 items-center gap-2 rounded-full border border-border/50 py-1 ps-1.5 pe-1 text-xs shadow-xs"
        data-bot-supervised-banner
      >
        <BotAvatar icon={bot.icon} color={bot.color} size="xs" status={botEntry.status} />
        <span className="min-w-0 truncate text-muted-foreground">
          Supervised by <span className="font-medium text-foreground">{bot.name}</span>
        </span>
        <span
          className={
            watching
              ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-info/12 px-1.5 py-0.5 text-2xs font-medium text-info-foreground"
              : "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground"
          }
        >
          <span
            className={
              watching
                ? "size-1.5 rounded-full bg-info"
                : "size-1.5 rounded-full bg-muted-foreground/50"
            }
            aria-hidden
          />
          {BOT_EXCHANGE_STATUS_LABEL.coding_thread[link.status]}
        </span>
        <Button
          size="xs"
          variant="ghost-muted"
          className="ms-auto shrink-0"
          onClick={() => openThread("bots", botEntry.environmentId, bot.threadId)}
        >
          Open {bot.name}
          <ArrowUpRightIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

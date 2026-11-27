import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ArrowUpRightIcon, ChevronDownIcon, CodeXmlIcon } from "lucide-react";
import { use, useState } from "react";

import { cn } from "../../lib/utils";
import { useBotsIndex } from "../../state/bots";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { findRevealRef } from "../chat/markdownFindContext";
import { TimelineRowCtx, type TimelineRow } from "../chat/timelineRowContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar } from "./BotAvatar";
import { useOpenThreadInMode } from "./botActions";
import { type BotHandoffMessage, botHandoffPreviewLine } from "./botHandoffMessage";
import { BOT_THEME_COLOR, DEFAULT_BOT_AVATAR_SHAPE } from "./botAvatars";

const STATUS_BADGE: Readonly<
  Record<
    string,
    { readonly label: string; readonly variant: "success" | "warning" | "error" | "secondary" }
  >
> = {
  completed: { label: "Completed", variant: "success" },
  waiting: { label: "Needs input", variant: "warning" },
  failed: { label: "Failed", variant: "error" },
  interrupted: { label: "Interrupted", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export function BotHandoffMessageCard({
  row,
  handoff,
}: {
  readonly row: Extract<TimelineRow, { kind: "message" }>;
  readonly handoff: BotHandoffMessage;
}) {
  const ctx = use(TimelineRowCtx);
  const index = useBotsIndex();
  const openThreadInMode = useOpenThreadInMode();
  const [expanded, setExpanded] = useState(false);
  const revealRef = findRevealRef(() => setExpanded(true));

  const environmentId = ctx.activeThreadEnvironmentId;
  const senderThreadId = row.message.senderThreadId;
  const peerBot =
    handoff.kind === "coding_thread_update"
      ? null
      : ((senderThreadId !== undefined
          ? index.botByThreadKey.get(scopedThreadKey(scopeThreadRef(environmentId, senderThreadId)))
          : undefined) ??
        index.bots.find(
          (candidate) =>
            candidate.environmentId === environmentId && candidate.bot.slug === handoff.botSlug,
        ) ??
        null);

  const targetMode = handoff.kind === "coding_thread_update" ? "threads" : "bots";
  const targetThreadId =
    handoff.kind === "coding_thread_update"
      ? handoff.threadId
      : (peerBot?.bot.threadId ?? senderThreadId ?? null);

  const heading =
    handoff.kind === "from_bot"
      ? `From ${peerBot?.bot.name ?? handoff.botName}`
      : handoff.kind === "bot_reply"
        ? `Reply from ${peerBot?.bot.name ?? handoff.botName}`
        : handoff.title;

  const statusBadge =
    handoff.kind === "from_bot"
      ? null
      : handoff.kind === "bot_reply" && handoff.status === "completed"
        ? null
        : (STATUS_BADGE[handoff.status] ?? {
            label: handoff.status,
            variant: "secondary" as const,
          });

  const preview = botHandoffPreviewLine(handoff.body);
  const hasMultipleLines = handoff.body.includes("\n") || handoff.body.length > 110;
  const timestamp = formatDayAwareTimestamp(row.message.createdAt, ctx.timestampFormat);
  const timestampTooltip = formatChatTimestampTooltip(row.message.createdAt, ctx.timestampFormat);

  return (
    <div
      ref={revealRef}
      data-bot-handoff-card={handoff.kind}
      className="min-w-0 max-w-full rounded-xl border border-border/60 bg-card/55 transition-colors hover:border-border/80"
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {handoff.kind === "coding_thread_update" ? (
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
              <CodeXmlIcon className="size-3.5" aria-hidden />
            </span>
          ) : (
            <BotAvatar
              icon={peerBot?.bot.icon ?? DEFAULT_BOT_AVATAR_SHAPE.id}
              color={peerBot?.bot.color ?? BOT_THEME_COLOR}
              size="sm"
            />
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-medium text-foreground">{heading}</span>
              {handoff.kind === "coding_thread_update" ? (
                <span className="shrink-0 text-2xs text-muted-foreground">Coding thread</span>
              ) : null}
              {statusBadge ? (
                <Badge size="sm" variant={statusBadge.variant}>
                  {statusBadge.label}
                </Badge>
              ) : null}
            </span>
            {!expanded && preview !== "" ? (
              <span className="truncate text-xs text-muted-foreground">{preview}</span>
            ) : null}
          </span>
          {hasMultipleLines || expanded ? (
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
              aria-hidden
            />
          ) : null}
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="hidden shrink-0 text-2xs text-muted-foreground tabular-nums sm:inline" />
            }
          >
            {timestamp}
          </TooltipTrigger>
          <TooltipPopup>{timestampTooltip}</TooltipPopup>
        </Tooltip>
        {targetThreadId !== null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={
                    handoff.kind === "coding_thread_update"
                      ? `Open coding thread ${handoff.title}`
                      : `Open ${peerBot?.bot.name ?? handoff.botName}`
                  }
                  onClick={() => openThreadInMode(targetMode, environmentId, targetThreadId)}
                />
              }
            >
              <ArrowUpRightIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup>
              {handoff.kind === "coding_thread_update"
                ? "Open coding thread"
                : `Open ${peerBot?.bot.name ?? handoff.botName}`}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {expanded && handoff.body !== "" ? (
        <div className="border-t border-border/50 px-3 py-2.5 text-sm">
          <ChatMarkdown
            text={handoff.body}
            cwd={ctx.markdownCwd}
            environmentId={environmentId}
            isStreaming={false}
          />
        </div>
      ) : null}
    </div>
  );
}

import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type ScopedBotEntry,
  type ScopedCodingThreadLink,
  botKey,
} from "@t3tools/client-runtime/state/bots";
import {
  BOT_MAX_HOPS,
  type BotExchange,
  type BotExchangeStatus,
  type BotStatus,
} from "@t3tools/contracts";
import {
  BellIcon,
  BellOffIcon,
  CodeXmlIcon,
  CornerDownRightIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  StarIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { botsEnvironment, useBotExchanges, useBotsIndex } from "../../state/bots";
import { useQuietThreadShell } from "../../state/entities";
import { ThreadAutomationsPanel } from "../chat/ThreadAutomationsPanel";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "../chat/threadDetailsPanelStyles";
import { RelativeTime } from "../RelativeTime";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BOT_STATUS_LABEL, BotAvatar } from "./BotAvatar";
import { useOpenThreadInMode, useToggleBotMuted } from "./botActions";
import { BotConfigTab } from "./BotConfigTab";
import { BotSoulTab } from "./BotSoulTab";

const TABS = [
  { id: "activity", label: "Activity" },
  { id: "soul", label: "Soul" },
  { id: "config", label: "Config" },
] as const;
type BotDetailsTab = (typeof TABS)[number]["id"];

const MAX_LISTED_EXCHANGES = 12;

const STATUS_BADGE_VARIANT: Record<BotStatus, "secondary" | "info" | "warning" | "error"> = {
  idle: "secondary",
  working: "info",
  waiting: "warning",
  error: "error",
};

const LINK_STATUS_LABEL: Record<BotExchangeStatus, string> = {
  pending: "Watching",
  woken: "Notified",
  replied: "Replied",
  cancelled: "Stopped",
};

const MESSAGE_STATUS_LABEL: Record<BotExchangeStatus, string> = {
  pending: "Pending",
  woken: "Delivered",
  replied: "Replied",
  cancelled: "Cancelled",
};

const EXCHANGE_STATUS_VARIANT: Record<BotExchangeStatus, "info" | "success" | "secondary"> = {
  pending: "info",
  woken: "success",
  replied: "success",
  cancelled: "secondary",
};

export function BotDetailsPanel({ entry }: { readonly entry: ScopedBotEntry }) {
  const [tab, setTab] = useState<BotDetailsTab>("activity");
  return (
    <div className="flex min-w-0 flex-col" data-bot-details-panel>
      <BotDetailsHeader entry={entry} />
      <div
        role="tablist"
        aria-label="Bot details"
        className="mx-4 mb-1 flex h-7 items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5"
      >
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={tab === option.id}
            onClick={() => setTab(option.id)}
            className={cn(
              "flex h-full flex-1 cursor-pointer items-center justify-center rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
              tab === option.id
                ? "bg-background/70 text-foreground shadow-xs ring-1 ring-inset ring-border/70"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find((option) => option.id === tab)?.label}>
        {tab === "activity" ? (
          <BotActivityTab entry={entry} />
        ) : tab === "soul" ? (
          <BotSoulTab key={`${entry.environmentId}:${entry.bot.id}`} entry={entry} />
        ) : (
          <BotConfigTab key={`${entry.environmentId}:${entry.bot.id}`} entry={entry} />
        )}
      </div>
    </div>
  );
}

function BotDetailsHeader({ entry }: { readonly entry: ScopedBotEntry }) {
  const { bot, status, environmentId } = entry;
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const toggleMuted = useToggleBotMuted();
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-4 pt-3 pb-2.5">
      <BotAvatar icon={bot.icon} color={bot.color} size="md" status={status} muted={bot.muted} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm font-semibold text-foreground">{bot.name}</span>
          {bot.isPrimary ? (
            <StarIcon
              className="size-3 shrink-0 fill-current text-warning"
              aria-label="Primary Bot"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-2xs text-muted-foreground">@{bot.slug}</span>
          <Badge size="sm" variant={STATUS_BADGE_VARIANT[status]}>
            {BOT_STATUS_LABEL[status]}
          </Badge>
          {bot.archivedAt !== null ? (
            <Badge size="sm" variant="outline">
              Archived
            </Badge>
          ) : null}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              size="icon-xs"
              variant="ghost"
              part="icon"
              aria-label={bot.muted ? `Unmute ${bot.name}` : `Mute ${bot.name}`}
              disabled={!canUpdate}
              onClick={() => void toggleMuted(entry)}
            >
              {bot.muted ? (
                <BellOffIcon className="size-3.5" aria-hidden />
              ) : (
                <BellIcon className="size-3.5" aria-hidden />
              )}
            </ThreadDetailsControl>
          }
        />
        <TooltipPopup>{bot.muted ? "Unmute" : "Mute"}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function BotActivityTab({ entry }: { readonly entry: ScopedBotEntry }) {
  const index = useBotsIndex();
  const links = index.codingThreadsByBotKey.get(botKey(entry.environmentId, entry.bot.id)) ?? [];
  return (
    <>
      <ThreadDetailsSection
        headingId="bot-details-coding-threads-heading"
        title="Coding threads"
        separated={false}
      >
        {links.length === 0 ? (
          <p className="px-2.5 text-2xs text-muted-foreground">
            Threads this Bot starts or messages show up here while it watches them.
          </p>
        ) : (
          <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
            {links.map((scoped) => (
              <li key={`${scoped.environmentId}:${scoped.link.threadId}`}>
                <CodingThreadLinkRow scoped={scoped} />
              </li>
            ))}
          </ul>
        )}
      </ThreadDetailsSection>
      <BotExchangesSection entry={entry} />
      <ThreadAutomationsPanel environmentId={entry.environmentId} threadId={entry.bot.threadId} />
    </>
  );
}

function CodingThreadLinkRow({ scoped }: { readonly scoped: ScopedCodingThreadLink }) {
  const { environmentId, link } = scoped;
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, link.threadId));
  const openThread = useOpenThreadInMode();
  return (
    <ThreadDetailsControl
      variant="ghost"
      onClick={() => openThread("threads", environmentId, link.threadId)}
    >
      <CornerDownRightIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{shell?.title ?? "Thread not loaded"}</span>
      <Badge size="sm" variant={EXCHANGE_STATUS_VARIANT[link.status]}>
        {LINK_STATUS_LABEL[link.status]}
      </Badge>
    </ThreadDetailsControl>
  );
}

function BotExchangesSection({ entry }: { readonly entry: ScopedBotEntry }) {
  const exchanges = useBotExchanges(entry.environmentId, entry.bot.id);
  const index = useBotsIndex();
  const nameOf = (botId: BotExchange["fromBotId"] | null) =>
    botId === null
      ? null
      : (index.bots.find(
          (candidate) =>
            candidate.environmentId === entry.environmentId && candidate.bot.id === botId,
        )?.bot.name ?? null);
  const listed = exchanges.data?.exchanges.slice(0, MAX_LISTED_EXCHANGES) ?? [];
  return (
    <ThreadDetailsSection
      headingId="bot-details-exchanges-heading"
      title="Bot exchanges"
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label="Refresh exchanges"
                disabled={exchanges.isPending}
                onClick={exchanges.refresh}
              >
                <RefreshCwIcon className="size-3.5" aria-hidden />
              </ThreadDetailsControl>
            }
          />
          <TooltipPopup>Refresh</TooltipPopup>
        </Tooltip>
      }
    >
      {exchanges.error !== null ? (
        <p className="px-2.5 text-2xs text-destructive">
          Could not load exchanges: {exchanges.error}
        </p>
      ) : listed.length === 0 ? (
        <p className="px-2.5 text-2xs text-muted-foreground">
          {exchanges.data === null ? "Loading exchanges…" : "No messages or coding threads yet."}
        </p>
      ) : (
        <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0">
          {listed.map((exchange) => {
            const outgoing = exchange.fromBotId === entry.bot.id;
            const peer = nameOf(outgoing ? exchange.toBotId : exchange.fromBotId);
            const title =
              exchange.kind === "coding_thread"
                ? "Coding thread"
                : outgoing
                  ? `To ${peer ?? "another Bot"}`
                  : `From ${peer ?? "another Bot"}`;
            return (
              <li key={exchange.id} className="flex min-w-0 gap-2.5 rounded-lg px-2.5 py-1.5">
                {exchange.kind === "coding_thread" ? (
                  <CodeXmlIcon
                    className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, "mt-0.5")}
                    aria-hidden
                  />
                ) : (
                  <MessagesSquareIcon
                    className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, "mt-0.5")}
                    aria-hidden
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-xs font-medium text-foreground/80">
                      {title}
                    </span>
                    <Badge size="sm" variant={EXCHANGE_STATUS_VARIANT[exchange.status]}>
                      {exchange.kind === "coding_thread"
                        ? LINK_STATUS_LABEL[exchange.status]
                        : MESSAGE_STATUS_LABEL[exchange.status]}
                    </Badge>
                  </span>
                  {exchange.summary ? (
                    <p className="line-clamp-2 text-2xs text-muted-foreground">
                      {exchange.summary}
                    </p>
                  ) : null}
                  <span className="flex items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
                    <span>
                      hop {exchange.hopCount}/{BOT_MAX_HOPS}
                    </span>
                    <span aria-hidden>·</span>
                    <RelativeTime timestamp={exchange.createdAt} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ThreadDetailsSection>
  );
}

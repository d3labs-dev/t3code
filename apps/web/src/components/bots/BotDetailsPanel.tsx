import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  BOT_EXCHANGE_STATUS_LABEL,
  type ScopedBotEntry,
  type ScopedCodingThreadLink,
  botKey,
} from "@t3tools/client-runtime/state/bots";
import {
  BOT_MAX_HOPS,
  type BotExchange,
  type BotExchangeStatus,
  type BotStatus,
  type EditorId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { T, useGT, useMessages, Var } from "gt-react";
import {
  BellIcon,
  BellOffIcon,
  CodeXmlIcon,
  CornerDownRightIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  Settings2Icon,
  SettingsIcon,
  StarIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { botsEnvironment, useBotExchanges, useBotsIndex } from "../../state/bots";
import { useQuietThreadShell } from "../../state/entities";
import { OpenInPicker } from "../chat/OpenInPicker";
import { ThreadAutomationsPanel } from "../chat/ThreadAutomationsPanel";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { RelativeTime } from "../RelativeTime";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BOT_STATUS_LABEL, BotAvatar } from "./BotAvatar";
import { useOpenThreadInMode, useToggleBotMuted } from "./botActions";
import { useBotsUiStore } from "./botsUiStore";

const MAX_LISTED_EXCHANGES = 12;

const STATUS_TEXT_CLASS: Record<Exclude<BotStatus, "idle">, string> = {
  working: "text-info-foreground",
  waiting: "text-warning-foreground",
  error: "text-destructive",
};

const STATUS_DOT_CLASS: Record<Exclude<BotStatus, "idle">, string> = {
  working: "bg-info",
  waiting: "bg-warning",
  error: "bg-destructive",
};

const EXCHANGE_STATUS_VARIANT: Record<BotExchangeStatus, "info" | "success" | "secondary"> = {
  pending: "info",
  woken: "success",
  replied: "success",
  cancelled: "secondary",
};

export function BotDetailsPanel({
  entry,
  keybindings,
  availableEditors,
  showOpenInPicker,
  openInShortcutEnabled,
}: {
  readonly entry: ScopedBotEntry;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly showOpenInPicker: boolean;
  readonly openInShortcutEnabled: boolean;
}) {
  const gt = useGT();
  const index = useBotsIndex();
  const openBotSettings = useBotsUiStore((state) => state.openBotSettings);
  const links = index.codingThreadsByBotKey.get(botKey(entry.environmentId, entry.bot.id)) ?? [];
  const openSettings = () =>
    openBotSettings({ environmentId: entry.environmentId, botId: entry.bot.id });
  return (
    <div className="flex min-w-0 flex-col" data-bot-details-panel>
      <BotDetailsHeader entry={entry} onOpenSettings={openSettings} />
      <ThreadDetailsSection
        headingId="bot-details-workspace-heading"
        title={gt("Workspace")}
        separated={false}
        showHeading={false}
      >
        <div className="flex flex-col">
          {showOpenInPicker ? (
            <OpenInPicker
              keybindings={keybindings}
              environmentId={entry.environmentId}
              availableEditors={availableEditors}
              openInCwd={entry.bot.folderPath}
              enableShortcut={openInShortcutEnabled}
              displayMode="panel"
            />
          ) : null}
          <ThreadDetailsControl variant="ghost" onClick={openSettings}>
            <Settings2Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
            <span className={cn("min-w-0 flex-1 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
              <T>Bot settings</T>
            </span>
          </ThreadDetailsControl>
        </div>
      </ThreadDetailsSection>
      {links.length > 0 ? (
        <ThreadDetailsSection
          headingId="bot-details-coding-threads-heading"
          title={gt("Coding threads")}
        >
          <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
            {links.map((scoped) => (
              <li key={`${scoped.environmentId}:${scoped.link.threadId}`}>
                <CodingThreadLinkRow scoped={scoped} />
              </li>
            ))}
          </ul>
        </ThreadDetailsSection>
      ) : null}
      <BotExchangesSection entry={entry} />
      <ThreadAutomationsPanel environmentId={entry.environmentId} threadId={entry.bot.threadId} />
    </div>
  );
}

function BotDetailsHeader(props: {
  readonly entry: ScopedBotEntry;
  readonly onOpenSettings: () => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const { entry } = props;
  const { bot, status, environmentId } = entry;
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const toggleMuted = useToggleBotMuted();
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-4 pt-3 pb-2">
      <BotAvatar
        icon={bot.icon}
        color={bot.color}
        owner={entry}
        size="md"
        status={status}
        muted={bot.muted}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm font-semibold text-foreground">{bot.name}</span>
          {bot.isPrimary ? (
            <StarIcon
              className="size-3 shrink-0 fill-current text-muted-foreground/70"
              aria-label={gt("Primary Bot")}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-2xs">
          {bot.role.trim() !== "" ? (
            <>
              <span className="truncate text-muted-foreground">{bot.role.trim()}</span>
              <span className="text-muted-foreground/50" aria-hidden>
                ·
              </span>
            </>
          ) : null}
          {bot.archivedAt !== null ? (
            <span className="shrink-0 text-muted-foreground">
              <T>Archived</T>
            </span>
          ) : status === "idle" ? (
            <span className="shrink-0 text-muted-foreground">
              {bot.muted
                ? gt("Muted", { $context: "Bot notifications are off" })
                : resolve(BOT_STATUS_LABEL.idle)}
            </span>
          ) : (
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 font-medium",
                STATUS_TEXT_CLASS[status],
              )}
            >
              <span className={cn("size-1.5 rounded-full", STATUS_DOT_CLASS[status])} aria-hidden />
              {resolve(BOT_STATUS_LABEL[status])}
            </span>
          )}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              size="icon-xs"
              variant="ghost"
              part="icon"
              aria-label={
                bot.muted
                  ? gt("Unmute {name}", { name: bot.name })
                  : gt("Mute {name}", { name: bot.name })
              }
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
        <TooltipPopup>
          {bot.muted
            ? gt("Unmute", { $context: "Bot notifications" })
            : gt("Mute", { $context: "Bot notifications" })}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              size="icon-xs"
              variant="ghost"
              part="icon"
              aria-label={gt("Bot settings")}
              onClick={props.onOpenSettings}
            >
              <SettingsIcon className="size-3.5" aria-hidden />
            </ThreadDetailsControl>
          }
        />
        <TooltipPopup>
          <T>Bot settings</T>
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function CodingThreadLinkRow({ scoped }: { readonly scoped: ScopedCodingThreadLink }) {
  const gt = useGT();
  const { environmentId, link } = scoped;
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, link.threadId));
  const openThread = useOpenThreadInMode();
  return (
    <ThreadDetailsControl
      variant="ghost"
      onClick={() => openThread("threads", environmentId, link.threadId)}
    >
      <CornerDownRightIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{shell?.title ?? gt("Thread not loaded")}</span>
      <Badge size="sm" variant={EXCHANGE_STATUS_VARIANT[link.status]}>
        {BOT_EXCHANGE_STATUS_LABEL.coding_thread[link.status]}
      </Badge>
    </ThreadDetailsControl>
  );
}

function BotExchangesSection({ entry }: { readonly entry: ScopedBotEntry }) {
  const gt = useGT();
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
  if (exchanges.error === null && listed.length === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="bot-details-exchanges-heading"
      title={gt("Bot exchanges")}
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label={gt("Refresh exchanges")}
                disabled={exchanges.isPending}
                onClick={exchanges.refresh}
              >
                <RefreshCwIcon className="size-3.5" aria-hidden />
              </ThreadDetailsControl>
            }
          />
          <TooltipPopup>
            <T>Refresh</T>
          </TooltipPopup>
        </Tooltip>
      }
    >
      {exchanges.error !== null ? (
        <p className="px-2.5 text-2xs text-destructive">
          <T>
            Could not load exchanges: <Var>{exchanges.error}</Var>
          </T>
        </p>
      ) : (
        <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0">
          {listed.map((exchange) => {
            const outgoing = exchange.fromBotId === entry.bot.id;
            const peer = nameOf(outgoing ? exchange.toBotId : exchange.fromBotId);
            const title =
              exchange.kind === "coding_thread"
                ? gt("Coding thread")
                : outgoing
                  ? peer === null
                    ? gt("To another Bot")
                    : gt("To {name}", { name: peer })
                  : peer === null
                    ? gt("From another Bot")
                    : gt("From {name}", { name: peer });
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
                      {BOT_EXCHANGE_STATUS_LABEL[exchange.kind][exchange.status]}
                    </Badge>
                  </span>
                  {exchange.summary ? (
                    <p className="line-clamp-2 text-2xs text-muted-foreground">
                      {exchange.summary}
                    </p>
                  ) : null}
                  <span className="flex items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
                    <span>
                      {gt("hop {hop}/{maxHops}", { hop: exchange.hopCount, maxHops: BOT_MAX_HOPS })}
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

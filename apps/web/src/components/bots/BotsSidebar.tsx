import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type ScopedBotEntry,
  type ScopedCodingThreadLink,
  botKey,
  groupBotsForSidebar,
} from "@t3tools/client-runtime/state/bots";
import type { BotExchangeStatus, ScopedThreadRef } from "@t3tools/contracts";
import {
  ArchiveRestoreIcon,
  BellIcon,
  BellOffIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  PaletteIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  StarIcon,
} from "lucide-react";
import { useState } from "react";

import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { botsEnvironment, useBotsIndex } from "../../state/bots";
import { useQuietThreadShell } from "../../state/entities";
import { SidebarChromeFooter } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { SidebarContent, SidebarGroup, SidebarInput } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BOT_STATUS_LABEL, BotAvatar } from "./BotAvatar";
import {
  useCanCreateBot,
  useDefaultBotEnvironmentId,
  useOpenThreadInMode,
  useToggleBotMuted,
  useUpdateBot,
} from "./botActions";
import { BOT_VISUAL_STYLES, DEFAULT_BOT_AVATAR_SHAPE } from "./botAvatars";
import { BotModeSwitcher } from "./BotModeSwitcher";
import { useBotsUiStore } from "./botsUiStore";

const MAX_LISTED_CODING_THREADS = 8;
const UNGROUPED_KEY = "ungrouped";

const CODING_LINK_DOT_CLASS: Record<BotExchangeStatus, string> = {
  pending: "bg-info",
  woken: "bg-success",
  replied: "bg-success",
  cancelled: "bg-muted-foreground/40",
};

const ROW_CLASS =
  "flex w-full min-w-0 cursor-pointer items-center text-left outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-selected motion-reduce:transition-none";

function matchesQuery({ bot }: ScopedBotEntry, query: string): boolean {
  if (query === "") return true;
  return [bot.name, bot.role, bot.slug, bot.groupName ?? ""].some((field) =>
    field.toLowerCase().includes(query),
  );
}

function isSameThread(left: ScopedThreadRef | null, right: ScopedThreadRef): boolean {
  return left?.environmentId === right.environmentId && left.threadId === right.threadId;
}

export function BotsSidebar() {
  const [query, setQuery] = useState("");
  return (
    <>
      <SidebarContent fixedHeader={<BotsSidebarHeader query={query} onQueryChange={setQuery} />}>
        <BotsSidebarBody query={query.trim().toLowerCase()} />
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

function BotsSidebarHeader(props: {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}) {
  const visualStyle = useBotsUiStore((state) => state.visualStyle);
  const setVisualStyle = useBotsUiStore((state) => state.setVisualStyle);
  const openNewBotDialog = useBotsUiStore((state) => state.openNewBotDialog);
  return (
    <SidebarGroup className="z-[1]">
      <div className="flex min-w-0 flex-col gap-2">
        <BotModeSwitcher />
        <div className="flex min-w-0 items-center gap-1">
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-sidebar-border/60 bg-sidebar-control-surface/35 px-2">
            <SearchIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" aria-hidden />
            <SidebarInput
              aria-label="Filter Bots"
              placeholder="Filter Bots"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.currentTarget.value)}
            />
          </div>
          <Menu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={<Button size="icon-xs" variant="ghost-muted" aria-label="Bot finish" />}
                  />
                }
              >
                <PaletteIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>Bot finish</TooltipPopup>
            </Tooltip>
            <MenuPopup align="end">
              <MenuGroup>
                <MenuGroupLabel>Finish</MenuGroupLabel>
                <MenuRadioGroup
                  value={visualStyle}
                  onValueChange={(value) => {
                    const next = BOT_VISUAL_STYLES.find((style) => style.id === value);
                    if (next) setVisualStyle(next.id);
                  }}
                >
                  {BOT_VISUAL_STYLES.map((style) => (
                    <MenuRadioItem key={style.id} value={style.id}>
                      <span className="flex items-center gap-2">
                        <BotAvatar
                          icon={DEFAULT_BOT_AVATAR_SHAPE.id}
                          color="theme"
                          size="sm"
                          visualStyle={style.id}
                        />
                        {style.label}
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuPopup>
          </Menu>
          <NewBotIconButton onClick={openNewBotDialog} />
        </div>
      </div>
    </SidebarGroup>
  );
}

function NewBotIconButton(props: { readonly onClick: () => void }) {
  const canCreate = useCanCreateBot(useDefaultBotEnvironmentId());
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="New Bot"
            disabled={!canCreate}
            onClick={props.onClick}
          />
        }
      >
        <PlusIcon aria-hidden />
      </TooltipTrigger>
      <TooltipPopup>New Bot</TooltipPopup>
    </Tooltip>
  );
}

function BotsSidebarBody(props: { readonly query: string }) {
  const index = useBotsIndex();
  const openNewBotDialog = useBotsUiStore((state) => state.openNewBotDialog);
  const canCreate = useCanCreateBot(useDefaultBotEnvironmentId());
  const activeBots = index.bots.filter(({ bot }) => bot.archivedAt === null);
  const archivedBots = index.bots.filter(({ bot }) => bot.archivedAt !== null);
  const archivedSection =
    archivedBots.length > 0 ? <ArchivedBotsSection bots={archivedBots} /> : null;
  if (activeBots.length === 0) {
    return (
      <SidebarGroup>
        <div className="flex min-w-0 flex-col gap-3">
          <BotsEmptyState canCreate={canCreate} onCreate={openNewBotDialog} />
          {archivedSection}
        </div>
      </SidebarGroup>
    );
  }
  const { primary, groups } = groupBotsForSidebar(
    activeBots.filter((entry) => matchesQuery(entry, props.query)),
  );
  const showGroupHeaders = groups.some((group) => group.name !== null);
  return (
    <SidebarGroup>
      <div className="flex min-w-0 flex-col gap-3">
        {primary ? <BotEntry entry={primary} links={index.codingThreadsByBotKey} featured /> : null}
        {groups.map((group) => (
          <BotGroup
            key={group.name ?? UNGROUPED_KEY}
            name={group.name}
            bots={group.bots}
            showHeader={showGroupHeaders}
            links={index.codingThreadsByBotKey}
          />
        ))}
        {primary === null && groups.length === 0 ? (
          <p className="px-2 text-xs text-sidebar-muted-foreground">No Bots match this filter.</p>
        ) : null}
        <Button
          size="sm"
          variant="ghost-muted"
          className="w-full justify-start"
          disabled={!canCreate}
          onClick={openNewBotDialog}
        >
          <PlusIcon aria-hidden />
          New Bot
        </Button>
        {archivedSection}
      </div>
    </SidebarGroup>
  );
}

function ArchivedBotsSection(props: { readonly bots: ReadonlyArray<ScopedBotEntry> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-2xs font-medium text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <span className="min-w-0 truncate">Archived</span>
        <span className="tabular-nums opacity-70">{props.bots.length}</span>
      </button>
      {expanded ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {props.bots.map((entry) => (
            <li key={botKey(entry.environmentId, entry.bot.id)}>
              <ArchivedBotRow entry={entry} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ArchivedBotRow({ entry }: { readonly entry: ScopedBotEntry }) {
  const { bot, environmentId } = entry;
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const update = useUpdateBot();
  const openThread = useOpenThreadInMode();
  const routeRef = useThreadRouteRef();
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    setRestoring(true);
    await update(environmentId, { botId: bot.id, archived: false }, "Could not restore Bot");
    setRestoring(false);
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        data-active={isSameThread(routeRef, scopeThreadRef(environmentId, bot.threadId))}
        onClick={() => openThread("bots", environmentId, bot.threadId)}
        className={cn(ROW_CLASS, "h-7 min-w-0 flex-1 gap-2 rounded-md px-2")}
      >
        <BotAvatar icon={bot.icon} color={bot.color} size="sm" muted />
        <span className="min-w-0 flex-1 truncate text-xs text-sidebar-muted-foreground">
          {bot.name}
        </span>
      </button>
      <Button
        size="xs"
        variant="ghost-muted"
        aria-label={`Restore ${bot.name}`}
        disabled={!canUpdate || restoring}
        onClick={() => void restore()}
      >
        <ArchiveRestoreIcon aria-hidden />
        Restore
      </Button>
    </div>
  );
}

function BotsEmptyState(props: { readonly canCreate: boolean; readonly onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-sidebar-border/60 bg-sidebar-control-surface/35 px-4 py-6 text-center">
      <div className="flex items-end gap-1.5" aria-hidden>
        <BotAvatar icon="droplet" color="#d6629f" size="md" />
        <BotAvatar icon="squircle" color="theme" size="lg" />
        <BotAvatar icon="cat" color="#e68940" size="md" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-sidebar-foreground">Meet your Bots</p>
        <p className="text-xs text-sidebar-muted-foreground">
          Bots are agents with a soul, a memory and their own folder. They take on work, start
          coding threads and keep watch while those run.
        </p>
      </div>
      <Button size="sm" disabled={!props.canCreate} onClick={props.onCreate}>
        <PlusIcon aria-hidden />
        Create your first Bot
      </Button>
    </div>
  );
}

function BotGroup(props: {
  readonly name: string | null;
  readonly bots: ReadonlyArray<ScopedBotEntry>;
  readonly showHeader: boolean;
  readonly links: ReadonlyMap<string, ReadonlyArray<ScopedCodingThreadLink>>;
}) {
  const groupKey = props.name === null ? UNGROUPED_KEY : `group:${props.name}`;
  const collapsed = useBotsUiStore((state) => state.collapsedGroups[groupKey] === true);
  const toggleGroupCollapsed = useBotsUiStore((state) => state.toggleGroupCollapsed);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {props.showHeader ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => toggleGroupCollapsed(groupKey)}
          className="flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-2xs font-medium text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
              !collapsed && "rotate-90",
            )}
            aria-hidden
          />
          <span className="min-w-0 truncate">{props.name ?? "Ungrouped"}</span>
          <span className="tabular-nums opacity-70">{props.bots.length}</span>
        </button>
      ) : null}
      {collapsed && props.showHeader ? null : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {props.bots.map((entry) => (
            <li key={botKey(entry.environmentId, entry.bot.id)}>
              <BotEntry entry={entry} links={props.links} featured={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BotEntry(props: {
  readonly entry: ScopedBotEntry;
  readonly links: ReadonlyMap<string, ReadonlyArray<ScopedCodingThreadLink>>;
  readonly featured: boolean;
}) {
  const { entry, featured } = props;
  const { bot, status, environmentId } = entry;
  const key = botKey(environmentId, bot.id);
  const links = props.links.get(key) ?? [];
  const pendingCount = links.filter(({ link }) => link.status === "pending").length;
  const expanded = useBotsUiStore((state) => state.expandedBotThreads[key] === true);
  const toggleExpanded = useBotsUiStore((state) => state.toggleBotThreadsExpanded);
  const openBotSettings = useBotsUiStore((state) => state.openBotSettings);
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const toggleMuted = useToggleBotMuted();
  const openThread = useOpenThreadInMode();
  const routeRef = useThreadRouteRef();
  const active = isSameThread(routeRef, scopeThreadRef(environmentId, bot.threadId));
  const subtitle =
    status === "idle"
      ? bot.role || "No role yet"
      : bot.role
        ? `${BOT_STATUS_LABEL[status]} · ${bot.role}`
        : BOT_STATUS_LABEL[status];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="group/bot-row relative min-w-0">
        <button
          type="button"
          data-active={active}
          onClick={() => openThread("bots", environmentId, bot.threadId)}
          className={cn(
            ROW_CLASS,
            featured
              ? "gap-3 rounded-xl border border-sidebar-border/60 bg-sidebar-control-surface/40 p-2.5"
              : "gap-2.5 rounded-lg px-2 py-1.5",
            links.length > 0 ? "pe-24" : "pe-14",
          )}
        >
          <BotAvatar
            icon={bot.icon}
            color={bot.color}
            size={featured ? "lg" : "md"}
            status={status}
            muted={bot.muted}
            interactive
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate text-sm font-medium text-sidebar-foreground">
                {bot.name}
              </span>
              {bot.isPrimary ? (
                <StarIcon
                  className="size-3 shrink-0 fill-current text-warning"
                  aria-label="Primary Bot"
                />
              ) : null}
              {bot.muted ? (
                <BellOffIcon
                  className="size-3 shrink-0 text-sidebar-muted-foreground"
                  aria-label="Muted"
                />
              ) : null}
            </span>
            <span className="truncate text-2xs text-sidebar-muted-foreground">{subtitle}</span>
          </span>
        </button>
        <div className="absolute inset-y-0 end-1.5 flex items-center gap-0.5">
          <span className="flex items-center opacity-0 transition-opacity group-focus-within/bot-row:opacity-100 group-hover/bot-row:opacity-100 motion-reduce:transition-none">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label={`${bot.name} settings`}
                    onClick={() => openBotSettings({ environmentId, botId: bot.id })}
                  />
                }
              >
                <Settings2Icon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>Bot settings</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label={bot.muted ? `Unmute ${bot.name}` : `Mute ${bot.name}`}
                    disabled={!canUpdate}
                    onClick={() => void toggleMuted(entry)}
                  />
                }
              >
                {bot.muted ? <BellIcon aria-hidden /> : <BellOffIcon aria-hidden />}
              </TooltipTrigger>
              <TooltipPopup>{bot.muted ? "Unmute" : "Mute"}</TooltipPopup>
            </Tooltip>
          </span>
          {links.length > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} coding threads for ${bot.name}`}
              onClick={() => toggleExpanded(key)}
              className={cn(
                "inline-flex h-5 cursor-pointer items-center gap-0.5 rounded-full px-1.5 text-2xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                pendingCount > 0
                  ? "bg-info/12 text-info-foreground hover:bg-info/20"
                  : "bg-sidebar-control-surface/60 text-sidebar-muted-foreground hover:text-sidebar-foreground",
              )}
            >
              {pendingCount > 0 ? `${pendingCount} active` : links.length}
              <ChevronRightIcon
                className={cn(
                  "size-3 transition-transform duration-150 motion-reduce:transition-none",
                  expanded && "rotate-90",
                )}
                aria-hidden
              />
            </button>
          ) : null}
        </div>
      </div>
      {expanded && links.length > 0 ? (
        <ul className="m-0 ms-5 flex list-none flex-col gap-0.5 border-s border-sidebar-border/70 p-0 ps-1.5">
          {links.slice(0, MAX_LISTED_CODING_THREADS).map((scoped) => (
            <li key={`${scoped.environmentId}:${scoped.link.threadId}`}>
              <CodingThreadRow
                scoped={scoped}
                active={isSameThread(
                  routeRef,
                  scopeThreadRef(scoped.environmentId, scoped.link.threadId),
                )}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CodingThreadRow(props: {
  readonly scoped: ScopedCodingThreadLink;
  readonly active: boolean;
}) {
  const { environmentId, link } = props.scoped;
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, link.threadId));
  const openThread = useOpenThreadInMode();
  return (
    <button
      type="button"
      data-active={props.active}
      onClick={() => openThread("threads", environmentId, link.threadId)}
      className={cn(ROW_CLASS, "h-7 gap-1.5 rounded-md px-1.5 text-xs")}
    >
      <CornerDownRightIcon className="size-3 shrink-0 text-sidebar-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
        {shell?.title ?? "Thread not loaded"}
      </span>
      {shell?.branch ? (
        <span className="max-w-20 shrink-0 truncate font-mono text-2xs text-sidebar-muted-foreground">
          {shell.branch}
        </span>
      ) : null}
      <span
        className={cn("size-1.5 shrink-0 rounded-full", CODING_LINK_DOT_CLASS[link.status])}
        aria-hidden
      />
    </button>
  );
}

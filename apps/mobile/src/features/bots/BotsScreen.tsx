import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type ScopedBotEntry,
  type ScopedCodingThreadLink,
  botKey,
  groupBotsForSidebar,
} from "@t3tools/client-runtime/state/bots";
import type { BotExchangeStatus, EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { FloatingActionButton } from "../../components/ui/FloatingActionButton";
import { IconButton } from "../../components/ui/IconButton";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { m, type MessageResolver } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import {
  ANDROID_READING_MAX_WIDTH,
  deriveCenteredContentHorizontalPadding,
} from "../../lib/layout";
import { botsEnvironment, useBotsIndex } from "../../state/bots";
import { useQuietThreadShell } from "../../state/entities";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceState } from "../../state/workspace";
import { androidHomeFabPosition } from "../home/AndroidHomeFab.shared";
import { FLOATING_TABS } from "../layout/workspace/floating-workspace-tabs";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { WorkspaceBrandTitle } from "../layout/workspace/WorkspaceBrandTitle";
import { useWorkspaceListEmptyTopInset } from "../layout/workspace/workspace-list-insets";
import { useAndroidFloatingTabs } from "../settings/appearance/AppearancePreferencesProvider";
import { openSettings } from "../settings/settings-navigation";
import { BOT_STATUS_LABEL, BotAvatar } from "./BotAvatar";
import { reportBotCommandFailure } from "./botFormHelpers";

const MAX_LISTED_CODING_THREADS = 8;

const CODING_STATUS_DOT_CLASS: Record<BotExchangeStatus, string> = {
  pending: "bg-primary",
  woken: "bg-success",
  replied: "bg-success",
  cancelled: "bg-foreground-muted/40",
};

function matchesBotSearch(entry: ScopedBotEntry, normalizedQuery: string): boolean {
  if (normalizedQuery === "") return true;
  const { bot } = entry;
  return (
    bot.name.toLowerCase().includes(normalizedQuery) ||
    bot.role.toLowerCase().includes(normalizedQuery) ||
    (bot.groupName?.toLowerCase().includes(normalizedQuery) ?? false)
  );
}

function botSubtitle(entry: ScopedBotEntry, resolve: MessageResolver): string | null {
  const role = entry.bot.role.trim();
  if (entry.status === "idle") return role || null;
  const statusLabel = resolve(BOT_STATUS_LABEL[entry.status]);
  return role ? `${statusLabel} · ${role}` : statusLabel;
}

export function BotsScreen(props: { readonly sidebar?: boolean } = {}) {
  const navigation = useNavigation();
  const gt = useGT();
  const selectDetail = useSelectWorkspaceDetail();
  const workspace = useWorkspaceTabs();
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const emptyTopInset = useWorkspaceListEmptyTopInset();
  const { width: windowWidth } = useWindowDimensions();
  const { state: catalogState } = useWorkspaceState();
  const connectedEnvironmentIds = useAtomValue(connectedEnvironmentIdsAtom);
  const index = useBotsIndex();
  const [expandedBots, setExpandedBots] = useState<Readonly<Record<string, boolean>>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Readonly<Record<string, boolean>>>({});
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const tabState = workspace?.state.tabs.bots;
  const searchQuery = tabState?.query ?? "";
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searching = (tabState?.searchMode ?? "resting") !== "resting";

  const activeBots = index.bots.filter(
    (entry) => entry.bot.archivedAt === null && matchesBotSearch(entry, normalizedQuery),
  );
  const archivedBots = index.bots.filter(
    (entry) => entry.bot.archivedAt !== null && matchesBotSearch(entry, normalizedQuery),
  );
  const hasAnyActiveBots = index.bots.some((entry) => entry.bot.archivedAt === null);

  const defaultEnvironmentId: EnvironmentId | null = connectedEnvironmentIds[0] ?? null;
  const canCreate = defaultEnvironmentId !== null;

  const openNewBot = () => {
    void Haptics.selectionAsync();
    navigation.navigate("NewBot", {
      environmentId: defaultEnvironmentId ? String(defaultEnvironmentId) : undefined,
    });
  };

  const openBotThread = (entry: ScopedBotEntry) => {
    void Haptics.selectionAsync();
    selectDetail({
      name: "Thread",
      params: {
        environmentId: String(entry.environmentId),
        threadId: String(entry.bot.threadId),
      },
    });
  };

  const openCodingThread = (scoped: ScopedCodingThreadLink) => {
    void Haptics.selectionAsync();
    selectDetail({
      name: "Thread",
      params: {
        environmentId: String(scoped.environmentId),
        threadId: String(scoped.link.threadId),
      },
    });
  };

  const openBotSettings = (entry: ScopedBotEntry) => {
    void Haptics.selectionAsync();
    navigation.navigate("BotSettings", {
      environmentId: String(entry.environmentId),
      botId: String(entry.bot.id),
    });
  };

  const toggleExpandedBot = (key: string) => {
    void Haptics.selectionAsync();
    setExpandedBots((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggleGroupCollapsed = (groupKey: string) => {
    void Haptics.selectionAsync();
    setCollapsedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }));
  };

  const { primary, groups } = groupBotsForSidebar(activeBots);
  const showGroupHeaders = groups.some((group) => group.name !== null);

  const horizontalPadding =
    Platform.OS === "android" && !props.sidebar
      ? Math.max(
          16,
          deriveCenteredContentHorizontalPadding({
            viewportWidth: windowWidth,
            maxContentWidth: ANDROID_READING_MAX_WIDTH,
            minimumPadding: 16,
          }),
        )
      : 16;

  const bottomPadding =
    Platform.OS === "ios"
      ? Math.max(insets.bottom, workspace?.bottomClearance ?? 0, 24) + 16
      : Math.max(workspace?.bottomClearance ?? 16, insets.bottom + 16) + 72;

  const header =
    Platform.OS === "android" ? (
      <AppBar
        title="T3 Code"
        titleContent={
          <WorkspaceBrandTitle
            accessibilityLabel={gt("{product}, {title}", {
              product: "T3 Code",
              title: gt("Bots", { $context: "navigation tab, persistent named agents" }),
            })}
            onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
          />
        }
        search={{
          value: searchQuery,
          onChangeText: (query) => workspace?.dispatch({ type: "query", query, tab: "bots" }),
          placeholder: gt("Search bots"),
          accessibilityLabel: gt("Search bots"),
          active: searching,
          onOpen: () => workspace?.dispatch({ type: "search", tab: "bots" }),
          onClose: () => workspace?.cancelSearch("bots"),
        }}
      />
    ) : null;

  const emptyContent = !catalogState.hasConnections ? (
    <EmptyState
      title={gt("No environments connected")}
      detail={gt("Connect an environment to create and chat with your Bots.")}
      actionLabel={gt("Add environment")}
      onAction={() => openSettings(navigation, "SettingsEnvironmentNew")}
      variant="plain"
    />
  ) : normalizedQuery !== "" ? (
    <EmptyState
      title={gt("No matching Bots")}
      detail={gt('No Bots match "{query}".', { query: searchQuery.trim() })}
      variant="plain"
    />
  ) : (
    <View className="items-center px-6 py-8">
      <View className="mb-4 flex-row items-end gap-2">
        <BotAvatar icon="droplet" color="#d6629f" size="md" />
        <BotAvatar icon="squircle" color="theme" size="lg" />
        <BotAvatar icon="cat" color="#e68940" size="md" />
      </View>
      <Text textRole="title" className="text-center font-t3-bold text-foreground">
        <T>Meet your Bots</T>
      </Text>
      <Text
        textRole="body"
        className="mt-2 max-w-[320px] text-center leading-normal text-foreground-muted"
      >
        <T>
          Bots are agents with a soul, a memory and their own folder. They take on work, start
          coding threads and keep watch while those run.
        </T>
      </Text>
      <View className="mt-5">
        <Button
          tone="primary"
          icon="plus"
          label={gt("Create your first Bot")}
          disabled={!canCreate}
          onPress={openNewBot}
        />
      </View>
    </View>
  );

  const showAndroidFab =
    Platform.OS === "android" &&
    canCreate &&
    hasAnyActiveBots &&
    (!props.sidebar || floatingTabsEnabled);

  return (
    <View className={cn("flex-1", Platform.OS === "android" ? "bg-header" : "bg-screen")}>
      {header}
      <ScreenContent surface={props.sidebar ? "drawer" : "screen"}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop:
              activeBots.length === 0 && archivedBots.length === 0
                ? emptyTopInset
                : 12 + (Platform.OS === "ios" ? 0 : contentTopInset),
            paddingBottom: bottomPadding,
            paddingHorizontal: horizontalPadding,
            gap: 16,
          }}
        >
          {activeBots.length === 0 ? (
            <View className="flex-1 justify-center">
              {emptyContent}
              {archivedBots.length > 0 ? (
                <View className="mt-4">
                  <ArchivedBotsSection
                    bots={archivedBots}
                    expanded={archivedExpanded}
                    onToggle={() => setArchivedExpanded((value) => !value)}
                    onOpenThread={openBotThread}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <>
              {primary ? (
                <PrimaryBotHeroCard
                  entry={primary}
                  links={
                    index.codingThreadsByBotKey.get(
                      botKey(primary.environmentId, primary.bot.id),
                    ) ?? []
                  }
                  expanded={expandedBots[botKey(primary.environmentId, primary.bot.id)] === true}
                  onOpen={() => openBotThread(primary)}
                  onOpenSettings={() => openBotSettings(primary)}
                  onToggleExpanded={() =>
                    toggleExpandedBot(botKey(primary.environmentId, primary.bot.id))
                  }
                  onOpenCodingThread={openCodingThread}
                />
              ) : null}

              {groups.map((group) => {
                const groupKey = group.name === null ? "ungrouped" : `group:${group.name}`;
                const collapsed = collapsedGroups[groupKey] === true;
                return (
                  <View key={groupKey} className="gap-1.5">
                    {showGroupHeaders ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: !collapsed }}
                        onPress={() => toggleGroupCollapsed(groupKey)}
                        className="flex-row items-center gap-1.5 px-2 py-1 active:opacity-70"
                      >
                        <SymbolView
                          name={collapsed ? "chevron.right" : "chevron.down"}
                          size={11}
                          tintColorClassName="accent-foreground-muted"
                        />
                        <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
                          {group.name ?? gt("Ungrouped")}
                        </Text>
                        <Text textRole="caption" className="tabular-nums text-foreground-muted/70">
                          {group.bots.length}
                        </Text>
                      </Pressable>
                    ) : null}
                    {showGroupHeaders && collapsed ? null : (
                      <ListSection>
                        {group.bots.map((entry, idx) => {
                          const key = botKey(entry.environmentId, entry.bot.id);
                          return (
                            <BotListRow
                              key={key}
                              entry={entry}
                              links={index.codingThreadsByBotKey.get(key) ?? []}
                              expanded={expandedBots[key] === true}
                              showDivider={idx < group.bots.length - 1}
                              onOpen={() => openBotThread(entry)}
                              onOpenSettings={() => openBotSettings(entry)}
                              onToggleExpanded={() => toggleExpandedBot(key)}
                              onOpenCodingThread={openCodingThread}
                            />
                          );
                        })}
                      </ListSection>
                    )}
                  </View>
                );
              })}

              {!showAndroidFab && canCreate ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={gt("New Bot")}
                  onPress={openNewBot}
                  className="flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-grouped-card/70 px-4 py-3 active:opacity-75"
                >
                  <SymbolView name="plus" size={16} tintColorClassName="accent-primary-text" />
                  <Text className="text-sm font-t3-semibold text-primary-text">
                    <T>New Bot</T>
                  </Text>
                </Pressable>
              ) : null}

              {archivedBots.length > 0 ? (
                <ArchivedBotsSection
                  bots={archivedBots}
                  expanded={archivedExpanded}
                  onToggle={() => setArchivedExpanded((value) => !value)}
                  onOpenThread={openBotThread}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </ScreenContent>

      {showAndroidFab ? (
        <View
          pointerEvents="box-none"
          className="absolute"
          style={
            floatingTabsEnabled
              ? {
                  right: FLOATING_TABS.edge,
                  bottom: insets.bottom + FLOATING_TABS.bottom,
                }
              : androidHomeFabPosition(insets.bottom, props.sidebar)
          }
        >
          <FloatingActionButton
            label={gt("New Bot")}
            icon="plus"
            variant="extended"
            expanded={!floatingTabsEnabled}
            tone="primary"
            onPress={openNewBot}
          />
        </View>
      ) : null}
    </View>
  );
}

function PrimaryBotHeroCard(props: {
  readonly entry: ScopedBotEntry;
  readonly links: ReadonlyArray<ScopedCodingThreadLink>;
  readonly expanded: boolean;
  readonly onOpen: () => void;
  readonly onOpenSettings: () => void;
  readonly onToggleExpanded: () => void;
  readonly onOpenCodingThread: (scoped: ScopedCodingThreadLink) => void;
}) {
  const { bot, status } = props.entry;
  const gt = useGT();
  const resolve = useMessages();
  const subtitle = botSubtitle(props.entry, resolve);
  const pendingCount = props.links.filter(({ link }) => link.status === "pending").length;

  return (
    <View className="overflow-hidden rounded-[22px] border border-border bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("{name}, Primary Bot", { name: bot.name })}
        onPress={props.onOpen}
        className="flex-row items-center gap-3.5 px-4 py-4 active:opacity-80"
      >
        <BotAvatar icon={bot.icon} color={bot.color} size="lg" status={status} muted={bot.muted} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <Text className="shrink text-base font-t3-bold text-foreground" numberOfLines={1}>
              {bot.name}
            </Text>
            <SymbolView name="star.fill" size={13} tintColorClassName="accent-warning-foreground" />
            {bot.muted ? (
              <SymbolView name="eye.slash" size={13} tintColorClassName="accent-foreground-muted" />
            ) : null}
          </View>
          {subtitle ? (
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : (
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              <T>Primary Bot</T>
            </Text>
          )}
        </View>
        <View className="flex-row items-center gap-1">
          {props.links.length > 0 ? (
            <CodingThreadsPill
              totalCount={props.links.length}
              pendingCount={pendingCount}
              expanded={props.expanded}
              botName={bot.name}
              onPress={props.onToggleExpanded}
            />
          ) : null}
          <IconButton
            icon="slider.horizontal.3"
            accessibilityLabel={gt("{name} settings", { name: bot.name })}
            onPress={props.onOpenSettings}
          />
        </View>
      </Pressable>
      {props.expanded && props.links.length > 0 ? (
        <View className="border-t border-border-subtle bg-grouped-card/50 px-4 py-1.5">
          {props.links.slice(0, MAX_LISTED_CODING_THREADS).map((scoped) => (
            <CodingThreadLinkRow
              key={`${scoped.environmentId}:${scoped.link.threadId}`}
              scoped={scoped}
              onPress={() => props.onOpenCodingThread(scoped)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BotListRow(props: {
  readonly entry: ScopedBotEntry;
  readonly links: ReadonlyArray<ScopedCodingThreadLink>;
  readonly expanded: boolean;
  readonly showDivider: boolean;
  readonly onOpen: () => void;
  readonly onOpenSettings: () => void;
  readonly onToggleExpanded: () => void;
  readonly onOpenCodingThread: (scoped: ScopedCodingThreadLink) => void;
}) {
  const { bot, status } = props.entry;
  const gt = useGT();
  const resolve = useMessages();
  const subtitle = botSubtitle(props.entry, resolve);
  const pendingCount = props.links.filter(({ link }) => link.status === "pending").length;

  return (
    <View className={props.showDivider ? "border-b border-border-subtle" : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bot.name}
        onPress={props.onOpen}
        className="flex-row items-center gap-3 px-4 py-3 active:opacity-75"
      >
        <BotAvatar icon={bot.icon} color={bot.color} size="md" status={status} muted={bot.muted} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <Text className="shrink text-base font-t3-medium text-foreground" numberOfLines={1}>
              {bot.name}
            </Text>
            {bot.muted ? (
              <SymbolView name="eye.slash" size={12} tintColorClassName="accent-foreground-muted" />
            ) : null}
          </View>
          {subtitle ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center gap-1">
          {props.links.length > 0 ? (
            <CodingThreadsPill
              totalCount={props.links.length}
              pendingCount={pendingCount}
              expanded={props.expanded}
              botName={bot.name}
              onPress={props.onToggleExpanded}
            />
          ) : null}
          <IconButton
            icon="slider.horizontal.3"
            accessibilityLabel={gt("{name} settings", { name: bot.name })}
            onPress={props.onOpenSettings}
          />
        </View>
      </Pressable>
      {props.expanded && props.links.length > 0 ? (
        <View className="border-t border-border-subtle bg-screen/40 px-4 py-1.5 pl-12">
          {props.links.slice(0, MAX_LISTED_CODING_THREADS).map((scoped) => (
            <CodingThreadLinkRow
              key={`${scoped.environmentId}:${scoped.link.threadId}`}
              scoped={scoped}
              onPress={() => props.onOpenCodingThread(scoped)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CodingThreadsPill(props: {
  readonly totalCount: number;
  readonly pendingCount: number;
  readonly expanded: boolean;
  readonly botName: string;
  readonly onPress: () => void;
}) {
  const gt = useGT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: props.expanded }}
      accessibilityLabel={
        props.expanded
          ? gt("Hide coding threads for {name}", { name: props.botName })
          : gt("Show coding threads for {name}", { name: props.botName })
      }
      onPress={props.onPress}
      hitSlop={6}
      className={cn(
        "flex-row items-center gap-1 rounded-full px-2.5 py-1 active:opacity-75",
        props.pendingCount > 0 ? "bg-primary/14" : "bg-subtle",
      )}
    >
      <Text
        className={cn(
          "text-xs font-t3-medium tabular-nums",
          props.pendingCount > 0 ? "text-primary-text" : "text-foreground-muted",
        )}
      >
        {props.pendingCount > 0
          ? gt("{count} active", { count: props.pendingCount })
          : props.totalCount}
      </Text>
      <SymbolView
        name={props.expanded ? "chevron.down" : "chevron.right"}
        size={10}
        tintColorClassName={
          props.pendingCount > 0 ? "accent-primary-text" : "accent-foreground-muted"
        }
      />
    </Pressable>
  );
}

function CodingThreadLinkRow(props: {
  readonly scoped: ScopedCodingThreadLink;
  readonly onPress: () => void;
}) {
  const { environmentId, link } = props.scoped;
  const gt = useGT();
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, link.threadId));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shell?.title ?? gt("Open coding thread")}
      onPress={props.onPress}
      className="flex-row items-center gap-2 py-2 active:opacity-70"
    >
      <View className={cn("size-2 shrink-0 rounded-full", CODING_STATUS_DOT_CLASS[link.status])} />
      <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
        {shell?.title ?? gt("Thread not loaded")}
      </Text>
      {shell?.branch ? (
        <Text
          className="max-w-24 shrink-0 font-mono text-2xs text-foreground-muted"
          numberOfLines={1}
        >
          {shell.branch}
        </Text>
      ) : null}
      <SymbolView name="chevron.right" size={11} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}

function ArchivedBotsSection(props: {
  readonly bots: ReadonlyArray<ScopedBotEntry>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onOpenThread: (entry: ScopedBotEntry) => void;
}) {
  return (
    <View className="gap-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
        onPress={props.onToggle}
        className="flex-row items-center gap-1.5 px-2 py-1 active:opacity-70"
      >
        <SymbolView
          name={props.expanded ? "chevron.down" : "chevron.right"}
          size={11}
          tintColorClassName="accent-foreground-muted"
        />
        <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
          <T>Archived</T>
        </Text>
        <Text textRole="caption" className="tabular-nums text-foreground-muted/70">
          {props.bots.length}
        </Text>
      </Pressable>
      {props.expanded ? (
        <ListSection>
          {props.bots.map((entry, idx) => (
            <ArchivedBotRow
              key={botKey(entry.environmentId, entry.bot.id)}
              entry={entry}
              showDivider={idx < props.bots.length - 1}
              onOpenThread={() => props.onOpenThread(entry)}
            />
          ))}
        </ListSection>
      ) : null}
    </View>
  );
}

function ArchivedBotRow(props: {
  readonly entry: ScopedBotEntry;
  readonly showDivider: boolean;
  readonly onOpenThread: () => void;
}) {
  const { bot, environmentId } = props.entry;
  const gt = useGT();
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const updateBot = useAtomCommand(botsEnvironment.updateBot, {
    label: "restore bot",
    reportFailure: false,
  });
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async () => {
    if (!canUpdate || restoring) return;
    void Haptics.selectionAsync();
    setRestoring(true);
    const result = await updateBot({
      environmentId,
      input: { botId: bot.id, archived: false },
    });
    setRestoring(false);
    reportBotCommandFailure(m(msg("Could not restore Bot")), result);
  };

  return (
    <View
      className={cn(
        "flex-row items-center gap-2 px-4 py-2.5",
        props.showDivider && "border-b border-border-subtle",
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Open archived Bot {name}", { name: bot.name })}
        onPress={props.onOpenThread}
        className="min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70"
      >
        <BotAvatar icon={bot.icon} color={bot.color} size="sm" muted />
        <Text className="min-w-0 flex-1 text-sm text-foreground-muted" numberOfLines={1}>
          {bot.name}
        </Text>
      </Pressable>
      <Button
        label={gt("Restore", { $context: "verb, unarchives the Bot" })}
        tone="text"
        size="compact"
        loading={restoring}
        disabled={!canUpdate || restoring}
        onPress={() => void handleRestore()}
      />
    </View>
  );
}

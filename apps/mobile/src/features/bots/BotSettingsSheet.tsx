import { useAtomValue } from "@effect/atom-react";
import {
  type BotDocumentDrafts,
  type BotSettingsPatch,
  botDocumentFields,
  botGroupSuggestions,
  botSettingsForm,
} from "@t3tools/client-runtime/bot-form";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  BOT_EXCHANGE_STATUS_LABEL,
  type ScopedBotEntry,
  type ScopedCodingThreadLink,
  botKey,
} from "@t3tools/client-runtime/state/bots";
import {
  BOT_CLOCK_TIME,
  BotId,
  type BotExchange,
  type BotProactiveConfig,
  EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListSection } from "../../components/ui/ListSection";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { cn } from "../../lib/cn";
import { botsEnvironment, useBotDetail, useBotExchanges, useBotsIndex } from "../../state/bots";
import { useQuietThreadShell } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatar } from "./BotAvatar";
import {
  reportBotCommandFailure,
  useBotModelChoice,
  useBotVisualStyle,
  useSetBotVisualStyle,
} from "./botFormHelpers";
import { BotIdentityPicker } from "./BotIdentityPicker";

type BotSettingsTab = "profile" | "soul" | "activity";

const PROACTIVE_INTERVALS = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
  { value: 120, label: "2h" },
] as const;

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const formatKilobytes = (bytes: number) => String(Math.ceil((bytes * 10) / 1024) / 10);

export function BotSettingsSheet(
  props: StaticScreenProps<{
    readonly environmentId: string;
    readonly botId: string;
    readonly initialTab?: BotSettingsTab;
  }>,
) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const botId = BotId.make(props.route.params.botId);
  const index = useBotsIndex();
  const entry =
    index.bots.find(
      (candidate) => candidate.environmentId === environmentId && candidate.bot.id === botId,
    ) ?? null;

  if (entry === null) {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <SheetHeader title="Bot settings" onClose={() => navigation.goBack()} />
        <ScreenContent>
          <View className="flex-1 items-center justify-center px-6">
            <EmptyState
              title="Bot unavailable"
              detail="This Bot is not available in the current roster."
              variant="plain"
            />
          </View>
        </ScreenContent>
      </View>
    );
  }

  return (
    <BotSettingsSheetBody
      key={botKey(entry.environmentId, entry.bot.id)}
      entry={entry}
      links={index.codingThreadsByBotKey.get(botKey(entry.environmentId, entry.bot.id)) ?? []}
      initialTab={props.route.params.initialTab ?? "profile"}
    />
  );
}

function BotSettingsSheetBody(props: {
  readonly entry: ScopedBotEntry;
  readonly links: ReadonlyArray<ScopedCodingThreadLink>;
  readonly initialTab: BotSettingsTab;
}) {
  const { bot, status, environmentId } = props.entry;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const visualStyle = useBotVisualStyle();
  const setVisualStyle = useSetBotVisualStyle();
  const index = useBotsIndex();

  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const canDelete = useAtomValue(botsEnvironment.deleteBot.permissionAtom(environmentId));
  const updateBot = useAtomCommand(botsEnvironment.updateBot, {
    label: "update bot",
    reportFailure: false,
  });
  const deleteBot = useAtomCommand(botsEnvironment.deleteBot, {
    label: "delete bot",
    reportFailure: false,
  });

  const detail = useBotDetail(environmentId, bot.id);
  const exchanges = useBotExchanges(environmentId, bot.id);

  const [tab, setTab] = useState<BotSettingsTab>(props.initialTab);
  const [patch, setPatch] = useState<BotSettingsPatch>({});
  const [documentDrafts, setDocumentDrafts] = useState<BotDocumentDrafts>({});
  const [showModelList, setShowModelList] = useState(false);
  const [busy, setBusy] = useState(false);

  const savedDocuments = detail.data?.documents ?? null;
  const { shown, nameMissing, changeCount, dirtyDocuments, pendingDrafts, saveInput } =
    botSettingsForm(bot, patch, savedDocuments, documentDrafts);
  if (pendingDrafts !== documentDrafts) setDocumentDrafts(pendingDrafts);
  const editable = canUpdate && !busy;

  const model = useBotModelChoice(environmentId, shown.modelSelection);

  const groupSuggestions = botGroupSuggestions(index.bots, environmentId);

  const setField = (next: BotSettingsPatch) => setPatch((current) => ({ ...current, ...next }));

  const handleRequestClose = () => {
    if (changeCount === 0) {
      navigation.goBack();
      return;
    }
    Dialog.confirm({
      title: `Discard unsaved changes to ${bot.name}?`,
      message: "Your edits to this Bot have not been saved yet.",
      confirmText: "Discard",
      destructive: true,
      onConfirm: () => navigation.goBack(),
    });
  };

  const handleSave = async () => {
    if (saveInput === null || busy || !canUpdate) return;
    setBusy(true);
    const result = await updateBot({ environmentId, input: saveInput });
    setBusy(false);
    if (result._tag === "Failure") {
      reportBotCommandFailure("Could not save Bot settings", result);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPatch({});
  };

  const handleToggleArchive = async () => {
    if (!canUpdate || busy) return;
    const nextArchived = bot.archivedAt === null;
    setBusy(true);
    const result = await updateBot({
      environmentId,
      input: { botId: bot.id, archived: nextArchived },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      reportBotCommandFailure(
        nextArchived ? "Could not archive Bot" : "Could not restore Bot",
        result,
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleConfirmDelete = () => {
    if (!canDelete || busy) return;
    Dialog.confirm({
      title: `Delete ${bot.name}?`,
      message: "This removes the Bot and deletes its chat. Its files on disk stay untouched.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          const result = await deleteBot({ environmentId, input: { botId: bot.id } });
          setBusy(false);
          if (result._tag === "Failure") {
            reportBotCommandFailure("Could not delete Bot", result);
            return;
          }
          navigation.dispatch(StackActions.popToTop());
        })();
      },
    });
  };

  const openThread = (targetEnvironmentId: EnvironmentId, targetThreadId: string) => {
    void Haptics.selectionAsync();
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(targetEnvironmentId),
        threadId: targetThreadId,
      }),
    );
  };

  return (
    <KeyboardAvoidingView
      automaticOffset
      behavior="padding"
      collapsable={false}
      className="flex-1 bg-sheet"
    >
      <SheetHeader
        title={shown.name.trim() || bot.name}
        subtitle={shown.role.trim() || "Bot settings"}
        onClose={handleRequestClose}
        dismissDisabled={busy}
        confirm={
          changeCount > 0
            ? {
                label: "Save",
                loading: busy,
                disabled: nameMissing || !canUpdate || busy,
                onPress: () => void handleSave(),
              }
            : undefined
        }
      />
      <ScreenContent>
        <View className="px-5 pt-2 pb-3">
          <SegmentedControl
            variant="card"
            size="compact"
            selected={tab}
            options={[
              { value: "profile", label: "Profile" },
              {
                value: "soul",
                label: dirtyDocuments.length > 0 ? "Soul •" : "Soul",
              },
              { value: "activity", label: "Activity" },
            ]}
            onSelect={(next) => {
              void Haptics.selectionAsync();
              setTab(next);
            }}
          />
        </View>
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="automatic"
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-2"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}
        >
          {tab === "profile" ? (
            <>
              <View className="items-center gap-3 rounded-[22px] border border-border bg-grouped-card px-4 py-5">
                <BotAvatar
                  icon={shown.icon}
                  color={shown.color}
                  owner={props.entry}
                  size="xl"
                  visualStyle={visualStyle}
                  status={status}
                  muted={shown.muted}
                />
                {bot.archivedAt !== null ? (
                  <View className="rounded-full bg-subtle px-2.5 py-0.5">
                    <Text className="text-2xs font-t3-medium text-foreground-muted">Archived</Text>
                  </View>
                ) : null}
                <View className="w-full gap-2">
                  <TextInput
                    accessibilityLabel="Bot name"
                    placeholder="Bot name"
                    value={shown.name}
                    editable={editable}
                    onChangeText={(value) => setField({ name: value })}
                    className="min-h-12 text-center text-base font-t3-semibold"
                  />
                  <TextInput
                    accessibilityLabel="Bot role"
                    placeholder="Role"
                    value={shown.role}
                    editable={editable}
                    onChangeText={(value) => setField({ role: value })}
                    className="min-h-11 text-center text-sm"
                  />
                </View>
              </View>

              <BotIdentityPicker
                icon={shown.icon}
                color={shown.color}
                visualStyle={visualStyle}
                disabled={!editable}
                onIconChange={(value) => setField({ icon: value })}
                onColorChange={(value) => setField({ color: value })}
                onVisualStyleChange={setVisualStyle}
              />

              <View className="gap-2">
                <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
                  Group
                </Text>
                <TextInput
                  accessibilityLabel="Group"
                  placeholder="Ungrouped"
                  value={shown.groupName ?? ""}
                  editable={editable}
                  onChangeText={(value) => setField({ groupName: value === "" ? null : value })}
                  className="min-h-11 text-sm"
                />
                <View className="flex-row flex-wrap gap-2">
                  {groupSuggestions.map((group) => {
                    const active = (shown.groupName ?? "").trim() === group;
                    return (
                      <Pressable
                        key={group}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        disabled={!editable}
                        onPress={() => {
                          void Haptics.selectionAsync();
                          setField({ groupName: active ? null : group });
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1.5 active:opacity-75",
                          active ? "border-primary bg-primary/14" : "border-border bg-grouped-card",
                        )}
                      >
                        <Text
                          className={cn(
                            "text-xs font-t3-medium",
                            active ? "text-primary-text" : "text-foreground-muted",
                          )}
                        >
                          {group}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <ListSection title="Model">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showModelList }}
                  disabled={!editable || model.options.length === 0}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setShowModelList((value) => !value);
                  }}
                  className="flex-row items-center justify-between gap-2 px-4 py-3 active:opacity-75"
                >
                  <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                    {model.label ?? shown.modelSelection.model}
                  </Text>
                  <SymbolView
                    name={showModelList ? "chevron.up" : "chevron.down"}
                    size={12}
                    tintColorClassName="accent-foreground-muted"
                  />
                </Pressable>
                {showModelList
                  ? model.options.map((option) => {
                      const selected =
                        shown.modelSelection.instanceId === option.selection.instanceId &&
                        shown.modelSelection.model === option.selection.model;
                      return (
                        <Pressable
                          key={option.key}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setField({ modelSelection: option.selection as ModelSelection });
                            setShowModelList(false);
                          }}
                          className="flex-row items-center justify-between gap-2 border-t border-border-subtle px-4 py-2.5 active:opacity-75"
                        >
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm text-foreground" numberOfLines={1}>
                              {option.label}
                            </Text>
                            <Text className="text-2xs text-foreground-muted" numberOfLines={1}>
                              {option.providerLabel}
                            </Text>
                          </View>
                          {selected ? (
                            <SymbolView
                              name="checkmark"
                              size={14}
                              tintColorClassName="accent-primary-text"
                            />
                          ) : null}
                        </Pressable>
                      );
                    })
                  : null}
              </ListSection>

              <ListSection title="Behavior">
                <ListToggleRow
                  label="Primary Bot"
                  description="Feature at the top of your Bots list."
                  value={shown.isPrimary}
                  disabled={!editable}
                  onValueChange={(value) => setField({ isPrimary: value })}
                />
                {shown.isPrimary ? (
                  <ProactiveCheckInRows
                    proactive={shown.proactive}
                    editable={editable}
                    onChange={(proactive) => setField({ proactive })}
                  />
                ) : null}
                <View className="h-px bg-border-subtle" />
                <ListToggleRow
                  label="Muted"
                  description="Pause notifications and sleep its avatar."
                  value={shown.muted}
                  disabled={!editable}
                  onValueChange={(value) => setField({ muted: value })}
                />
              </ListSection>

              <View className="gap-2.5 pt-2">
                <Button
                  fullWidth
                  tone="secondary"
                  icon="archivebox"
                  label={bot.archivedAt === null ? "Archive Bot" : "Restore Bot"}
                  disabled={!editable}
                  onPress={() => void handleToggleArchive()}
                />
                <Button
                  fullWidth
                  tone="danger"
                  icon="trash"
                  label="Delete Bot"
                  disabled={!canDelete || busy}
                  onPress={handleConfirmDelete}
                />
              </View>
            </>
          ) : tab === "soul" ? (
            <View className="gap-4">
              <View className="flex-row items-center gap-2 rounded-xl bg-grouped-card px-3.5 py-2.5">
                <SymbolView name="folder" size={15} tintColorClassName="accent-foreground-muted" />
                <Text
                  className="min-w-0 flex-1 font-mono text-xs text-foreground-muted"
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {bot.folderPath}
                </Text>
              </View>

              {savedDocuments === null ? (
                detail.error ? (
                  <EmptyState
                    title="Could not load Bot documents"
                    detail={detail.error}
                    actionLabel="Retry"
                    onAction={detail.refresh}
                  />
                ) : (
                  <View className="items-center py-8">
                    <AppActivityIndicator colorClassName="accent-foreground-muted" />
                  </View>
                )
              ) : (
                botDocumentFields(shown.isPrimary).map((doc) => {
                  const value = documentDrafts[doc.id] ?? savedDocuments[doc.id];
                  const isDirty = dirtyDocuments.includes(doc.id);
                  const bytes = new TextEncoder().encode(value).length;
                  return (
                    <View key={doc.id} className="gap-2">
                      <View className="flex-row items-center justify-between px-1">
                        <Text
                          textRole="footnote"
                          className="font-mono font-t3-medium text-foreground-muted"
                        >
                          {doc.file}
                        </Text>
                        <View className="flex-row items-center gap-2">
                          {doc.softCapBytes !== null && bytes > doc.softCapBytes ? (
                            <Text textRole="caption" className="font-mono text-warning-foreground">
                              {formatKilobytes(bytes)} / {formatKilobytes(doc.softCapBytes)} KB
                            </Text>
                          ) : null}
                          {isDirty ? (
                            <Text textRole="caption" className="text-warning-foreground">
                              Unsaved
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      <TextInput
                        accessibilityLabel={doc.file}
                        placeholder={doc.placeholder}
                        value={value}
                        editable={editable}
                        onChangeText={(next) =>
                          setDocumentDrafts((current) => ({ ...current, [doc.id]: next }))
                        }
                        multiline
                        textAlignVertical="top"
                        className="min-h-36 font-mono text-sm"
                      />
                    </View>
                  );
                })
              )}
            </View>
          ) : (
            <View className="gap-5">
              <ListSection title={`Coding threads (${props.links.length})`}>
                {props.links.length === 0 ? (
                  <View className="px-4 py-4">
                    <Text className="text-sm text-foreground-muted">
                      No coding threads launched by this Bot yet.
                    </Text>
                  </View>
                ) : (
                  props.links.map((scoped, idx) => (
                    <ActivityCodingThreadRow
                      key={`${scoped.environmentId}:${scoped.link.threadId}`}
                      scoped={scoped}
                      showDivider={idx < props.links.length - 1}
                      onOpen={() => openThread(scoped.environmentId, String(scoped.link.threadId))}
                    />
                  ))
                )}
              </ListSection>

              <ListSection title="Exchanges">
                {exchanges.isPending && exchanges.data === null ? (
                  <View className="items-center py-5">
                    <AppActivityIndicator colorClassName="accent-foreground-muted" />
                  </View>
                ) : exchanges.error && exchanges.data === null ? (
                  <View className="px-4 py-4">
                    <Text className="text-sm text-danger-foreground">{exchanges.error}</Text>
                  </View>
                ) : (exchanges.data?.exchanges.length ?? 0) === 0 ? (
                  <View className="px-4 py-4">
                    <Text className="text-sm text-foreground-muted">No exchanges yet.</Text>
                  </View>
                ) : (
                  exchanges.data!.exchanges.map((exchange, idx, list) => (
                    <BotExchangeRow
                      key={exchange.id}
                      exchange={exchange}
                      showDivider={idx < list.length - 1}
                      onOpen={() => openThread(environmentId, String(exchange.watchedThreadId))}
                    />
                  ))
                )}
              </ListSection>
            </View>
          )}
        </ScrollView>
      </ScreenContent>
    </KeyboardAvoidingView>
  );
}

function ProactiveCheckInRows(props: {
  readonly proactive: BotProactiveConfig;
  readonly editable: boolean;
  readonly onChange: (proactive: BotProactiveConfig) => void;
}) {
  const { proactive, editable, onChange } = props;
  return (
    <>
      <View className="h-px bg-border-subtle" />
      <ListToggleRow
        label="Proactive check-ins"
        description="Periodically check NOW.md and HEARTBEAT.md in the background and message you only when something needs attention."
        value={proactive.enabled}
        disabled={!editable}
        onValueChange={(enabled) =>
          onChange({
            ...proactive,
            enabled,
            timezone:
              enabled && proactive.timezone === "UTC" ? localTimeZone() : proactive.timezone,
          })
        }
      />
      {proactive.enabled ? (
        <View className="gap-3 border-t border-border-subtle px-4 py-3">
          <SegmentedControl
            variant="card"
            size="compact"
            selected={proactive.intervalMinutes}
            options={PROACTIVE_INTERVALS.map((option) => ({
              value: option.value,
              label: option.label,
              accessibilityLabel: `Check in every ${option.label}`,
            }))}
            onSelect={(intervalMinutes) => {
              if (editable) onChange({ ...proactive, intervalMinutes });
            }}
          />
          <View className="flex-row items-center gap-2">
            <Text className="text-sm text-foreground-muted">Active</Text>
            <ClockTimeInput
              label="Active hours start"
              value={proactive.activeHoursStart}
              editable={editable}
              onChange={(activeHoursStart) => onChange({ ...proactive, activeHoursStart })}
            />
            <Text className="text-sm text-foreground-muted">to</Text>
            <ClockTimeInput
              label="Active hours end"
              value={proactive.activeHoursEnd}
              editable={editable}
              onChange={(activeHoursEnd) => onChange({ ...proactive, activeHoursEnd })}
            />
          </View>
          <Text textRole="caption" className="text-foreground-muted">
            {proactive.timezone}
          </Text>
        </View>
      ) : null}
    </>
  );
}

function ClockTimeInput(props: {
  readonly label: string;
  readonly value: string;
  readonly editable: boolean;
  readonly onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<{ readonly base: string; readonly text: string } | null>(null);
  const text = draft !== null && draft.base === props.value ? draft.text : props.value;
  return (
    <TextInput
      accessibilityLabel={props.label}
      placeholder="HH:MM"
      value={text}
      editable={props.editable}
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      onChangeText={(next) => {
        if (BOT_CLOCK_TIME.test(next)) {
          setDraft(null);
          props.onChange(next);
        } else {
          setDraft({ base: props.value, text: next });
        }
      }}
      className="min-h-10 min-w-0 flex-1 text-center font-mono text-sm"
    />
  );
}

function ActivityCodingThreadRow(props: {
  readonly scoped: ScopedCodingThreadLink;
  readonly showDivider: boolean;
  readonly onOpen: () => void;
}) {
  const { environmentId, link } = props.scoped;
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, link.threadId));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onOpen}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3 active:opacity-75",
        props.showDivider && "border-b border-border-subtle",
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
          {shell?.title ?? "Thread not loaded"}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {BOT_EXCHANGE_STATUS_LABEL.coding_thread[link.status]}
          {shell?.branch ? ` · ${shell.branch}` : ""}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={12} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}

function BotExchangeRow(props: {
  readonly exchange: BotExchange;
  readonly showDivider: boolean;
  readonly onOpen: () => void;
}) {
  const { exchange } = props;
  const kindLabel = exchange.kind === "coding_thread" ? "Coding thread" : "Bot message";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onOpen}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3 active:opacity-75",
        props.showDivider && "border-b border-border-subtle",
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-t3-medium text-foreground">{kindLabel}</Text>
          <View className="rounded-full bg-subtle px-2 py-0.5">
            <Text className="text-2xs font-t3-medium text-foreground-muted">
              {BOT_EXCHANGE_STATUS_LABEL[exchange.kind][exchange.status]}
            </Text>
          </View>
        </View>
        {exchange.summary ? (
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            {exchange.summary}
          </Text>
        ) : null}
      </View>
      <SymbolView name="chevron.right" size={12} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}

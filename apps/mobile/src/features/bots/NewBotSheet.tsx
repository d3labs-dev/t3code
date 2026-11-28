import { useAtomValue } from "@effect/atom-react";
import { BOT_THEME_COLOR, DEFAULT_BOT_AVATAR_SHAPE } from "@t3tools/client-runtime/bot-avatar";
import { botGroupSuggestions, shuffleBotIdentity } from "@t3tools/client-runtime/bot-form";
import {
  AuthOrchestrationOperateScope,
  BOT_DOCUMENTS,
  type BotCreateInput,
  EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { msg, T, useGT, Var } from "gt-react-native";
import { useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { m } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { botsEnvironment, useBotsIndex } from "../../state/bots";
import { useEnvironments } from "../../state/environments";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatar } from "./BotAvatar";
import {
  reportBotCommandFailure,
  useBotModelChoice,
  useBotVisualStyle,
  useSetBotVisualStyle,
} from "./botFormHelpers";
import { BotIdentityPicker } from "./BotIdentityPicker";

export function NewBotSheet(
  props: StaticScreenProps<{ readonly environmentId?: string } | undefined>,
) {
  const navigation = useNavigation();
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const connectedIds = useAtomValue(connectedEnvironmentIdsAtom);
  const { environments } = useEnvironments();
  const index = useBotsIndex();
  const visualStyle = useBotVisualStyle();
  const setVisualStyle = useSetBotVisualStyle();

  const paramEnv = props.route.params?.environmentId
    ? EnvironmentId.make(props.route.params.environmentId)
    : null;
  const defaultEnvironmentId =
    (paramEnv !== null && connectedIds.includes(paramEnv) ? paramEnv : connectedIds[0]) ?? null;

  const [chosenEnvironmentId, setChosenEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    chosenEnvironmentId !== null && connectedIds.includes(chosenEnvironmentId)
      ? chosenEnvironmentId
      : defaultEnvironmentId;

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [groupName, setGroupName] = useState("");
  const [icon, setIcon] = useState<string>(DEFAULT_BOT_AVATAR_SHAPE.id);
  const [color, setColor] = useState<string>(BOT_THEME_COLOR);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const [soul, setSoul] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showModelList, setShowModelList] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const canCreatePermission = useAtomValue(
    environmentId !== null
      ? botsEnvironment.createBot.permissionAtom(environmentId)
      : botsEnvironment.createBot.permissionAtom(EnvironmentId.make("disconnected")),
  );
  const createBot = useAtomCommand(botsEnvironment.createBot, {
    label: "create bot",
    reportFailure: false,
  });

  const model = useBotModelChoice(environmentId, chosenModel);
  const trimmedName = name.trim();
  const canSubmit =
    environmentId !== null &&
    canCreatePermission &&
    !saving &&
    trimmedName.length > 0 &&
    model.selection !== null;

  const groupSuggestions = botGroupSuggestions(index.bots, environmentId);

  const handleRandomize = () => {
    void Haptics.selectionAsync();
    const next = shuffleBotIdentity({ icon, color }, Math.random);
    setIcon(next.icon);
    setColor(next.color);
  };

  const handleSubmit = async () => {
    if (
      submitting.current ||
      environmentId === null ||
      trimmedName === "" ||
      model.selection === null ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    ) {
      return;
    }
    const trimmedGroup = groupName.trim();
    const trimmedSoul = soul.trim();
    const input: BotCreateInput = {
      name: trimmedName,
      modelSelection: model.selection,
      role: role.trim(),
      groupName: trimmedGroup === "" ? null : trimmedGroup,
      icon,
      color,
      ...(trimmedSoul === "" ? {} : { documents: { soul } }),
    };
    submitting.current = true;
    setSaving(true);
    const result = await createBot({ environmentId, input });
    submitting.current = false;
    setSaving(false);
    if (result._tag === "Failure") {
      reportBotCommandFailure(m(msg("Could not create Bot")), result);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(environmentId),
        threadId: String(result.value.bot.threadId),
      }),
    );
  };

  if (environmentId === null) {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <SheetHeader title={gt("New Bot")} onCancel={() => navigation.goBack()} />
        <ScreenContent>
          <View className="flex-1 items-center justify-center px-6">
            <EmptyState
              title={gt("No environment connected")}
              detail={gt("Connect an environment before creating a Bot.")}
              variant="plain"
            />
          </View>
        </ScreenContent>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      automaticOffset
      behavior="padding"
      collapsable={false}
      className="flex-1 bg-sheet"
    >
      <SheetHeader
        title={gt("New Bot")}
        onCancel={() => navigation.goBack()}
        dismissDisabled={saving}
        confirm={{
          label: gt("Create", { $context: "verb, creates the Bot" }),
          loading: saving,
          disabled: !canSubmit,
          onPress: () => void handleSubmit(),
        }}
      />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="automatic"
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}
        >
          <View className="items-center gap-3 rounded-[22px] border border-border bg-grouped-card px-4 py-6">
            <View className="relative w-full items-center justify-center">
              <BotAvatar icon={icon} color={color} size="xl" visualStyle={visualStyle} />
              <View className="absolute right-0 bottom-0">
                <IconButton
                  icon="arrow.clockwise"
                  accessibilityLabel={gt("Randomize look")}
                  disabled={saving}
                  onPress={handleRandomize}
                />
              </View>
            </View>
            <View className="w-full gap-2 pt-1">
              <TextInput
                autoFocus
                accessibilityLabel={gt("Bot name")}
                placeholder={gt("Name your Bot")}
                value={name}
                editable={!saving}
                onChangeText={setName}
                returnKeyType="next"
                className="min-h-12 text-center text-lg font-t3-semibold"
              />
              <TextInput
                accessibilityLabel={gt("Bot role")}
                placeholder={gt("Role (e.g. Chief of Staff, Designer)")}
                value={role}
                editable={!saving}
                onChangeText={setRole}
                className="min-h-11 text-center text-sm"
              />
            </View>
          </View>

          <BotIdentityPicker
            icon={icon}
            color={color}
            visualStyle={visualStyle}
            disabled={saving}
            onIconChange={setIcon}
            onColorChange={setColor}
            onVisualStyleChange={setVisualStyle}
          />

          <View className="gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showMore }}
              onPress={() => {
                void Haptics.selectionAsync();
                setShowMore((value) => !value);
              }}
              className="flex-row items-center justify-between gap-2 rounded-2xl border border-border bg-grouped-card px-4 py-3.5 active:opacity-75"
            >
              <Text className="text-sm font-t3-medium text-foreground">
                <T>Group, model & soul</T>
              </Text>
              <View className="flex-row items-center gap-1.5">
                {model.label ? (
                  <Text className="max-w-44 text-xs text-foreground-muted" numberOfLines={1}>
                    {model.label}
                  </Text>
                ) : null}
                <SymbolView
                  name={showMore ? "chevron.down" : "chevron.right"}
                  size={12}
                  tintColorClassName="accent-foreground-muted"
                />
              </View>
            </Pressable>

            {showMore ? (
              <View className="gap-4">
                <View className="gap-2">
                  <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
                    <T>Group</T>
                  </Text>
                  <TextInput
                    accessibilityLabel={gt("Group", { $context: "noun, Bot group name" })}
                    placeholder={gt("Ungrouped")}
                    value={groupName}
                    editable={!saving}
                    onChangeText={setGroupName}
                    className="min-h-11 text-sm"
                  />
                  <View className="flex-row flex-wrap gap-2">
                    {groupSuggestions.map((group) => {
                      const active = groupName.trim() === group;
                      return (
                        <Pressable
                          key={group}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          disabled={saving}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setGroupName(active ? "" : group);
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1.5 active:opacity-75",
                            active
                              ? "border-primary bg-primary/14"
                              : "border-border bg-grouped-card",
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

                {connectedIds.length > 1 ? (
                  <ListSection title={gt("Environment")}>
                    {connectedIds.map((id, idx) => {
                      const selected = id === environmentId;
                      const label =
                        environments.find((env) => env.environmentId === id)?.label ?? String(id);
                      return (
                        <Pressable
                          key={id}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          disabled={saving}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setChosenEnvironmentId(id);
                            setChosenModel(null);
                          }}
                          className={cn(
                            "flex-row items-center justify-between px-4 py-3 active:opacity-75",
                            idx < connectedIds.length - 1 && "border-b border-border-subtle",
                          )}
                        >
                          <Text className="text-sm text-foreground">{label}</Text>
                          {selected ? (
                            <SymbolView
                              name="checkmark"
                              size={15}
                              tintColorClassName="accent-primary-text"
                            />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </ListSection>
                ) : null}

                <View className="gap-2">
                  <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
                    <T>Model</T>
                  </Text>
                  <ListSection>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showModelList }}
                      disabled={saving || model.options.length === 0}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setShowModelList((value) => !value);
                      }}
                      className="flex-row items-center justify-between gap-2 px-4 py-3 active:opacity-75"
                    >
                      <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                        {model.label ?? gt("No models available")}
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
                            model.selection?.instanceId === option.selection.instanceId &&
                            model.selection?.model === option.selection.model;
                          return (
                            <Pressable
                              key={option.key}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              onPress={() => {
                                void Haptics.selectionAsync();
                                setChosenModel(option.selection);
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
                </View>

                <View className="gap-2">
                  <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
                    <T>
                      Starter <Var>{BOT_DOCUMENTS.soul.file}</Var> (optional)
                    </T>
                  </Text>
                  <TextInput
                    accessibilityLabel={gt("Starter {file}", { file: BOT_DOCUMENTS.soul.file })}
                    placeholder={gt("Who is this Bot? How should it think, talk and decide?")}
                    value={soul}
                    editable={!saving}
                    onChangeText={setSoul}
                    multiline
                    textAlignVertical="top"
                    className="min-h-28 text-sm"
                  />
                </View>
              </View>
            ) : null}
          </View>

          <Button
            fullWidth
            tone="primary"
            label={saving ? gt("Creating…") : gt("Create Bot")}
            loading={saving}
            disabled={!canSubmit}
            onPress={() => void handleSubmit()}
          />
        </ScrollView>
      </ScreenContent>
    </KeyboardAvoidingView>
  );
}

import type { ScopedBotEntry } from "@t3tools/client-runtime/state/bots";
import { View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import { AppText as Text } from "../../components/ui/AppText";
import { BotAvatar } from "../bots/BotAvatar";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly botEntry?: ScopedBotEntry | null;
  readonly onOpenBotSettings?: () => void;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const botEntry = props.botEntry ?? null;
  const displayTitle = botEntry ? botEntry.bot.name : props.title;
  const displaySubtitle = botEntry
    ? props.subtitle || botEntry.bot.role.trim() || "Bot"
    : props.subtitle;
  const actions: AppBarAction[] = [
    ...(botEntry && props.onOpenBotSettings
      ? [
          {
            accessibilityLabel: `${botEntry.bot.name} settings`,
            icon: "slider.horizontal.3" as const,
            separateBackground: false,
            onPress: props.onOpenBotSettings,
          },
        ]
      : []),
    ...(props.hasThreadCwd
      ? [
          {
            accessibilityLabel: filesVisible ? "Close files" : "Open files",
            icon: "folder" as const,
            selected: filesVisible,
            disabled: !props.gitControls.canOpenFiles,
            separateBackground: false,
            onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
          },
        ]
      : []),
  ];
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);
  const botTitleContent = botEntry ? (
    <View className="flex-row items-center gap-2.5">
      <BotAvatar
        icon={botEntry.bot.icon}
        color={botEntry.bot.color}
        owner={botEntry}
        size="sm"
        status={botEntry.status}
        muted={botEntry.bot.muted}
      />
      <View className="min-w-0 shrink">
        <Text
          textRole="title"
          numberOfLines={1}
          className="font-t3-semibold text-header-foreground"
        >
          {displayTitle}
        </Text>
        {displaySubtitle ? (
          <Text textRole="caption" numberOfLines={1} className="text-foreground-muted">
            {displaySubtitle}
          </Text>
        ) : null}
      </View>
    </View>
  ) : undefined;

  return (
    <AppBar
      title={displayTitle}
      titleContent={botTitleContent}
      subtitle={displaySubtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}

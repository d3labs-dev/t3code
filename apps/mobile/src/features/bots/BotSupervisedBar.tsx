import {
  BOT_EXCHANGE_STATUS_LABEL,
  type ScopedCodingThreadSupervisor,
} from "@t3tools/client-runtime/state/bots";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { BotAvatar } from "./BotAvatar";

export function BotSupervisedBar(props: {
  readonly supervisor: ScopedCodingThreadSupervisor;
  readonly onOpenBot: () => void;
}) {
  const { botEntry, link } = props.supervisor;
  const { bot } = botEntry;
  const watching = link.status === "pending";

  return (
    <View className="px-4 pb-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Supervised by ${bot.name}. Open ${bot.name}`}
        onPress={() => {
          void Haptics.selectionAsync();
          props.onOpenBot();
        }}
        className="flex-row items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 active:opacity-75"
      >
        <BotAvatar icon={bot.icon} color={bot.color} size="xs" status={botEntry.status} />
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          Supervised by <Text className="text-xs font-t3-semibold text-foreground">{bot.name}</Text>
        </Text>
        <View
          className={cn(
            "flex-row items-center gap-1 rounded-full px-2 py-0.5",
            watching ? "bg-primary/14" : "bg-subtle",
          )}
        >
          <View
            className={cn(
              "size-1.5 rounded-full",
              watching ? "bg-primary" : "bg-foreground-muted/50",
            )}
          />
          <Text
            className={cn(
              "text-2xs font-t3-medium",
              watching ? "text-primary-text" : "text-foreground-muted",
            )}
          >
            {BOT_EXCHANGE_STATUS_LABEL.coding_thread[link.status]}
          </Text>
        </View>
        <SymbolView name="arrow.up.right" size={12} tintColorClassName="accent-foreground-muted" />
      </Pressable>
    </View>
  );
}

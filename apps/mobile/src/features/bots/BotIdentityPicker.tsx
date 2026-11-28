import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  BOT_THEME_COLOR,
  type BotVisualStyle,
  findBotAvatarShape,
  isCustomBotEmoji,
} from "@t3tools/client-runtime/bot-avatar";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { cn } from "../../lib/cn";
import { BOT_VISUAL_STYLES } from "./botAvatarPaint";
import { BotShapeSilhouette } from "./BotAvatar";

export function BotIdentityPicker(props: {
  readonly icon: string;
  readonly color: string;
  readonly visualStyle: BotVisualStyle;
  readonly disabled?: boolean;
  readonly onIconChange: (icon: string) => void;
  readonly onColorChange: (color: string) => void;
  readonly onVisualStyleChange: (style: BotVisualStyle) => void;
}) {
  const { colors } = useControlTheme();
  const activeShape = findBotAvatarShape(props.icon);
  const customEmoji = isCustomBotEmoji(props.icon) ? props.icon : "";

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
          Finish
        </Text>
        <SegmentedControl
          variant="card"
          size="compact"
          selected={props.visualStyle}
          options={BOT_VISUAL_STYLES.map((style) => ({
            value: style.id,
            label: style.label,
          }))}
          onSelect={(value) => {
            if (props.disabled) return;
            void Haptics.selectionAsync();
            props.onVisualStyleChange(value);
          }}
        />
      </View>

      <View className="gap-2">
        <View className="flex-row items-center justify-between px-1">
          <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
            Shape
          </Text>
          <Text textRole="caption" className="text-foreground-muted">
            {activeShape ? activeShape.label : customEmoji ? "Custom" : "Portrait"}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {BOT_AVATAR_SHAPES.map((shape) => {
            const selected = activeShape?.id === shape.id;
            return (
              <Pressable
                key={shape.id}
                accessibilityRole="button"
                accessibilityLabel={shape.label}
                accessibilityState={{ selected, disabled: Boolean(props.disabled) }}
                disabled={props.disabled}
                onPress={() => {
                  void Haptics.selectionAsync();
                  props.onIconChange(shape.id);
                }}
                className={cn(
                  "size-11 items-center justify-center rounded-xl border active:opacity-75",
                  selected ? "border-primary bg-primary/14" : "border-border bg-grouped-card",
                )}
              >
                <BotShapeSilhouette
                  shape={shape}
                  size={22}
                  color={selected ? colors["--color-primary"] : colors["--color-foreground-muted"]}
                />
              </Pressable>
            );
          })}
        </View>
        <View className="mt-1 flex-row items-center gap-2">
          <TextInput
            accessibilityLabel="Custom emoji or initials"
            placeholder="Or type an emoji / 2 chars (e.g. 🦊)"
            value={customEmoji}
            editable={!props.disabled}
            maxLength={8}
            onChangeText={(text) => {
              const trimmed = text.trim();
              if (trimmed === "") {
                props.onIconChange(BOT_AVATAR_SHAPES[2].id);
              } else {
                props.onIconChange(trimmed);
              }
            }}
            className="min-h-10 flex-1 rounded-xl px-3 py-2 text-sm"
          />
        </View>
      </View>

      <View className="gap-2">
        <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
          Color
        </Text>
        <View className="flex-row flex-wrap gap-2.5">
          {BOT_AVATAR_COLORS.map((swatch) => {
            const selected = props.color.trim().toLowerCase() === swatch.value.toLowerCase();
            const isTheme = swatch.value === BOT_THEME_COLOR;
            const swatchFill = isTheme ? colors["--color-primary"] : swatch.value;
            return (
              <Pressable
                key={swatch.id}
                accessibilityRole="button"
                accessibilityLabel={swatch.label}
                accessibilityState={{ selected, disabled: Boolean(props.disabled) }}
                disabled={props.disabled}
                onPress={() => {
                  void Haptics.selectionAsync();
                  props.onColorChange(swatch.value);
                }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  borderWidth: selected ? 2.5 : 1,
                  borderColor: selected ? colors["--color-foreground"] : colors["--color-border"],
                  padding: 3,
                }}
                className="items-center justify-center active:opacity-75"
              >
                <View
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 14,
                    backgroundColor: swatchFill,
                  }}
                  className="items-center justify-center"
                >
                  {isTheme ? (
                    <SymbolView
                      name="paintbrush"
                      size={12}
                      tintColor={colors["--color-primary-foreground"]}
                    />
                  ) : selected ? (
                    <SymbolView
                      name="checkmark"
                      size={12}
                      tintColor={swatch.id === "cream" ? "#18181b" : "#fafafa"}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

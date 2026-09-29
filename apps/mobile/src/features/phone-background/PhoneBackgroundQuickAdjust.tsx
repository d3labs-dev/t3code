import { useAtomSet } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import type { PhoneBackgroundQuickAdjustPosition } from "../../persistence/mobile-preferences";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  usePhoneBackground,
  usePhoneBackgroundEnabled,
  usePhoneBackgroundQuickAdjust,
  usePhoneBackgroundQuickAdjustPosition,
} from "./phoneBackground";
import { PhoneBackgroundLookSliders, PhoneBackgroundStepButtons } from "./PhoneBackgroundControls";

const BUTTON_SIZE = 44;
const EDGE_GAP = 12;

/**
 * A floating button, on while the quick adjust mode is, that opens the
 * background's look controls in a drawer over the lower half of the screen,
 * so every change shows on the home list or thread above it as it's made.
 * Dragging it moves it anywhere on screen, and it stays where it's dropped.
 */
export function PhoneBackgroundQuickAdjust() {
  const background = usePhoneBackground();
  const enabled = usePhoneBackgroundEnabled();
  const quickAdjust = usePhoneBackgroundQuickAdjust();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const insets = useSafeAreaInsets();
  // Screen surfaces turn transparent while the background shows; the backdrop color stays solid.
  const { phoneBackdropColor } = useAppearancePreferences();
  const [open, setOpen] = useState(false);
  if (!quickAdjust || background === null) return null;

  return (
    <>
      <DraggableQuickAdjustButton
        onPress={() => setOpen(true)}
        onMove={(phoneBackgroundQuickAdjustPosition) =>
          savePreferences({ phoneBackgroundQuickAdjustPosition })
        }
      />
      <Modal transparent animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityLabel="Close background controls"
          className="flex-1"
          onPress={() => setOpen(false)}
        />
        <View
          className="max-h-[55%] rounded-t-[28px]"
          style={{ paddingBottom: insets.bottom, backgroundColor: phoneBackdropColor ?? undefined }}
        >
          <View className="flex-row items-center justify-between px-5 pb-1 pt-4">
            <Text className="flex-1 text-lg font-t3-medium text-foreground">Background</Text>
            <View className="mr-3">
              <PhoneBackgroundStepButtons source={background.record.source} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              className="rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
            >
              <Text className="text-sm font-t3-medium text-foreground">Done</Text>
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <SettingsSwitchRow
              icon="photo"
              label="Show background"
              value={enabled}
              onValueChange={(phoneBackgroundEnabled) =>
                savePreferences({ phoneBackgroundEnabled })
              }
            />
            <PhoneBackgroundLookSliders record={background.record} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function DraggableQuickAdjustButton({
  onPress,
  onMove,
}: {
  readonly onPress: () => void;
  readonly onMove: (position: PhoneBackgroundQuickAdjustPosition) => void;
}) {
  const position = usePhoneBackgroundQuickAdjustPosition();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bounds = {
    left: EDGE_GAP,
    right: width - BUTTON_SIZE - EDGE_GAP,
    top: insets.top + EDGE_GAP,
    bottom: height - insets.bottom - BUTTON_SIZE - EDGE_GAP,
  };
  const restX = Math.min(Math.max(position.x * width, bounds.left), bounds.right);
  const restY = Math.min(Math.max(position.y * height, bounds.top), bounds.bottom);
  const x = useSharedValue(restX);
  const y = useSharedValue(restY);
  const dragging = useSharedValue(false);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  useEffect(() => {
    if (dragging.value) return;
    x.value = restX;
    y.value = restY;
  }, [dragging, restX, restY, x, y]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(6)
      .onStart(() => {
        dragging.value = true;
        startX.value = x.value;
        startY.value = y.value;
      })
      .onUpdate((event) => {
        x.value = Math.min(Math.max(startX.value + event.translationX, bounds.left), bounds.right);
        y.value = Math.min(Math.max(startY.value + event.translationY, bounds.top), bounds.bottom);
      })
      .onEnd(() => {
        runOnJS(onMove)({
          x: width > 0 ? x.value / width : 0,
          y: height > 0 ? y.value / height : 0,
        });
      })
      .onFinalize(() => {
        dragging.value = false;
      });
    const tap = Gesture.Tap().onEnd(() => {
      runOnJS(onPress)();
    });
    return Gesture.Exclusive(pan, tap);
  }, [
    bounds.bottom,
    bounds.left,
    bounds.right,
    bounds.top,
    dragging,
    height,
    onMove,
    onPress,
    startX,
    startY,
    width,
    x,
    y,
  ]);

  const style = useAnimatedStyle(() => ({
    opacity: dragging.value ? 0.85 : 1,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: dragging.value ? 1.08 : 1 },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel="Adjust background"
        accessibilityHint="Drag to move the button"
        onAccessibilityTap={onPress}
        className="absolute left-0 top-0 size-11 items-center justify-center rounded-full bg-grouped-card/90"
        style={style}
      >
        <SymbolView name="slider.horizontal.3" size={20} tintColorClassName="accent-icon" />
      </Reanimated.View>
    </GestureDetector>
  );
}

import {
  type CustomBackgroundRecord,
  MAX_CUSTOM_BACKGROUND_FADE,
  MIN_CUSTOM_BACKGROUND_FADE,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { FontSizeSliderRow as SliderRow } from "../settings/appearance/components/FontSizeSliderRow";
import {
  usePhoneBackground,
  usePhonePlaylist,
  useStepPhoneBackground,
  useUpdateActivePlaylist,
  useUpdatePhoneBackground,
} from "./phoneBackground";
import { activePhonePlaylist, phoneBackgroundShowingPlaylist } from "./phoneBackground.logic";

// Material draws a tick per step, so percentages move in fives.
const PERCENT_STEP = 5;

const LOOK_SLIDERS = [
  { key: "fade", label: "Bottom fade", icon: "slider.horizontal.3" },
  { key: "fadeHeight", label: "Fade height", icon: "arrow.up" },
  { key: "fadeSoftness", label: "Fade softness", icon: "circle" },
  { key: "opacity", label: "Picture opacity", icon: "eye" },
  { key: "brightnessAdapt", label: "Brightness adapt", icon: "sun.max" },
] as const satisfies ReadonlyArray<{
  key: keyof CustomBackgroundRecord;
  label: string;
  icon: ComponentProps<typeof SymbolView>["name"];
}>;

export function PhoneBackgroundLookSliders(props: { readonly record: CustomBackgroundRecord }) {
  const update = useUpdateActivePlaylist();
  const setRecord = (change: Partial<CustomBackgroundRecord>) =>
    update((playlist) => ({ ...playlist, ...change }));
  return (
    <>
      {LOOK_SLIDERS.map(({ key, label, icon }) => (
        <SliderRow
          key={key}
          icon={icon}
          label={label}
          min={MIN_CUSTOM_BACKGROUND_FADE}
          max={MAX_CUSTOM_BACKGROUND_FADE}
          step={PERCENT_STEP}
          value={props.record[key]}
          valueLabel={`${props.record[key]}%`}
          onChange={(value) => setRecord({ [key]: value })}
        />
      ))}
    </>
  );
}

function StepButton(props: { readonly direction: 1 | -1; readonly onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.direction === 1 ? "Next picture" : "Previous picture"}
      onPress={props.onPress}
      className="size-9 items-center justify-center rounded-full bg-subtle active:opacity-70"
    >
      <SymbolView
        name={props.direction === 1 ? "chevron.right" : "chevron.left"}
        size={16}
        tintColorClassName="accent-icon"
      />
    </Pressable>
  );
}

/** Previous and next picture buttons; nothing while there is one picture or none. */
export function PhoneBackgroundStepButtons() {
  const step = useStepPhoneBackground();
  const playlist = usePhonePlaylist();
  if (playlist === null || playlist.pictures.size < 2) return null;
  return (
    <View className="flex-row gap-2">
      <StepButton direction={-1} onPress={() => step(-1)} />
      <StepButton direction={1} onPress={() => step(1)} />
    </View>
  );
}

/** One chip per playlist; tapping one shows it. Nothing while the phone has one or none. */
export function PhonePlaylistChips() {
  const background = usePhoneBackground();
  const update = useUpdatePhoneBackground();
  if (background === null || background.playlists.length < 2) return null;
  const activeId = activePhonePlaylist(background).id;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="shrink-0 grow-0"
      contentContainerClassName="gap-2 px-5 py-2"
    >
      {background.playlists.map((playlist) => {
        const active = playlist.id === activeId;
        return (
          <Pressable
            key={playlist.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={playlist.name}
            onPress={() =>
              update((current) => phoneBackgroundShowingPlaylist(current, playlist.id))
            }
            className={
              active
                ? "rounded-full bg-primary px-3 py-1.5 active:opacity-70"
                : "rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
            }
          >
            <Text
              numberOfLines={1}
              className={
                active
                  ? "text-sm font-t3-medium text-primary-foreground"
                  : "text-sm font-t3-medium text-foreground"
              }
            >
              {playlist.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

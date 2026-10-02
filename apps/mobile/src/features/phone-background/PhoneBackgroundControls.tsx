import {
  type CustomBackgroundRecord,
  MAX_CUSTOM_BACKGROUND_FADE,
  MIN_CUSTOM_BACKGROUND_FADE,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { FontSizeSliderRow as SliderRow } from "../settings/appearance/components/FontSizeSliderRow";
import {
  usePhonePlaylist,
  useStepPhoneBackground,
  useUpdatePhoneBackground,
} from "./phoneBackground";

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
  const update = useUpdatePhoneBackground();
  const setRecord = (change: Partial<CustomBackgroundRecord>) =>
    update((background) => ({ ...background, record: { ...background.record, ...change } }));
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

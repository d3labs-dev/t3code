import { useAtomSet } from "@effect/atom-react";
import {
  CUSTOM_BACKGROUND_ROTATION_MINUTE_OPTIONS,
  type CustomBackgroundImageId,
  type CustomBackgroundImageSource,
  type CustomBackgroundRecord,
  type CustomBackgroundRotationOrder,
  type CustomBackgroundTransition,
  type PhoneBackground,
} from "@t3tools/contracts";
import { Image } from "expo-image";
import { type ComponentProps, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsControlRow } from "../settings/components/SettingsControlRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  usePhoneBackground,
  usePhoneBackgroundEnabled,
  usePhoneBackgroundQuickAdjust,
  usePhonePlaylist,
  useUpdatePhoneBackground,
} from "./phoneBackground";
import {
  phoneBackgroundWithoutPicture,
  phoneBackgroundWithPictures,
} from "./phoneBackground.logic";
import { deletePhonePicture, phonePictureFile, pickPhonePictures } from "./phonePictures";
import { PhoneBackgroundLookSliders, PhoneBackgroundStepButtons } from "./PhoneBackgroundControls";
import { PhoneBackgroundFolders } from "./PhoneBackgroundFolders";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

function formatRotationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} h`;
  return "1 day";
}

const ROTATION_OPTIONS = CUSTOM_BACKGROUND_ROTATION_MINUTE_OPTIONS.map((minutes) => ({
  value: minutes,
  label: formatRotationMinutes(minutes),
}));

const ORDER_OPTIONS: ReadonlyArray<{ value: CustomBackgroundRotationOrder; label: string }> = [
  { value: "sequential", label: "In order" },
  { value: "shuffle", label: "Shuffle" },
];

const TRANSITION_OPTIONS: ReadonlyArray<{ value: CustomBackgroundTransition; label: string }> = [
  { value: "fade", label: "Fade" },
  { value: "cut", label: "Cut" },
];

function ChoiceRow<Value extends string | number>(props: {
  readonly icon: SymbolName;
  readonly label: string;
  readonly value: Value;
  readonly options: ReadonlyArray<{ readonly value: Value; readonly label: string }>;
  readonly onChange: (value: Value) => void;
}) {
  const current = props.options.find((option) => option.value === props.value)?.label ?? "";
  return (
    <SettingsControlRow icon={props.icon} label={props.label}>
      <ControlPillMenu
        title={props.label}
        actions={props.options.map((option) => ({
          id: String(option.value),
          title: option.label,
          state: option.value === props.value ? "on" : "off",
        }))}
        onPressAction={({ nativeEvent }) => {
          const match = props.options.find((option) => String(option.value) === nativeEvent.event);
          if (match) props.onChange(match.value);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label}: ${current}`}
          className="rounded-full bg-subtle px-3 py-2 active:opacity-70"
        >
          <Text className="text-sm font-t3-medium text-foreground">{current}</Text>
        </Pressable>
      </ControlPillMenu>
    </SettingsControlRow>
  );
}

function PictureTile(props: {
  readonly imageId: CustomBackgroundImageId;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Remove picture"
      disabled={props.disabled}
      onPress={props.onRemove}
      className="h-32 w-[72px] overflow-hidden rounded-2xl bg-subtle"
    >
      <Image
        source={{ uri: phonePictureFile(props.imageId).uri }}
        style={{ flex: 1 }}
        contentFit="cover"
      />
    </Pressable>
  );
}

function PicturesSection(props: { readonly background: PhoneBackground | null }) {
  const enabled = usePhoneBackgroundEnabled();
  const quickAdjust = usePhoneBackgroundQuickAdjust();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const [busy, setBusy] = useState(false);
  const source = props.background?.record.source;
  const imageIds = source?.kind === "image" ? source.imageIds : [];
  const pictureCount = usePhonePlaylist()?.pictures.size ?? 0;

  const addPictures = () => {
    setBusy(true);
    pickPhonePictures()
      .then((pictures) => {
        if (pictures.length === 0) return;
        savePreferences({
          transform: (current) => ({
            phoneBackground: phoneBackgroundWithPictures(
              current.phoneBackground ?? null,
              pictures,
              new Date().toISOString(),
            ),
          }),
        });
      })
      .catch((error: unknown) =>
        Alert.alert(
          "Could not add the photos",
          error instanceof Error ? error.message : "Something went wrong.",
        ),
      )
      .finally(() => setBusy(false));
  };
  const confirmRemove = (imageId: CustomBackgroundImageId) => {
    Alert.alert("Remove this picture?", "It is removed from this phone's background.", [
      { style: "cancel", text: "Cancel" },
      {
        style: "destructive",
        text: "Remove",
        onPress: () => {
          savePreferences({
            transform: (current) => ({
              phoneBackground: current.phoneBackground
                ? phoneBackgroundWithoutPicture(current.phoneBackground, imageId)
                : null,
            }),
          });
          deletePhonePicture(imageId);
        },
      },
    ]);
  };

  return (
    <SettingsSection title="Pictures">
      {props.background ? (
        <>
          <SettingsSwitchRow
            icon="photo"
            label="Show behind home and threads"
            subtitle={`${pictureCount} ${pictureCount === 1 ? "picture" : "pictures"}`}
            value={enabled}
            onValueChange={(phoneBackgroundEnabled) => savePreferences({ phoneBackgroundEnabled })}
          />
          <SettingsSwitchRow
            icon="slider.horizontal.3"
            label="Quick adjust button"
            subtitle="Tune the look from home and threads while you see it."
            value={quickAdjust}
            onValueChange={(phoneBackgroundQuickAdjust) =>
              savePreferences({ phoneBackgroundQuickAdjust })
            }
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 px-4 py-3"
          >
            {imageIds.map((imageId) => (
              <PictureTile
                key={imageId}
                imageId={imageId}
                disabled={busy}
                onRemove={() => confirmRemove(imageId)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
      <SettingsActionRow
        icon="plus"
        label={busy ? "Adding photos…" : "Add photos"}
        loading={busy}
        disabled={busy}
        onPress={addPictures}
      />
      <PhoneBackgroundFolders background={props.background} />
    </SettingsSection>
  );
}

function RotationSection(props: { readonly source: CustomBackgroundImageSource }) {
  const update = useUpdatePhoneBackground();
  const pictureCount = usePhonePlaylist()?.pictures.size ?? 0;
  const setSource = (change: Partial<CustomBackgroundImageSource>) =>
    update((background) =>
      background.record.source.kind === "image"
        ? {
            ...background,
            record: { ...background.record, source: { ...background.record.source, ...change } },
          }
        : background,
    );
  return (
    <SettingsSection title="Rotation">
      {pictureCount < 2 ? (
        <View className="px-4 pt-3">
          <Text className="text-sm text-foreground-muted">
            Add another picture to rotate through them. These settings apply once you do.
          </Text>
        </View>
      ) : (
        <SettingsControlRow icon="photo" label="Showing now">
          <PhoneBackgroundStepButtons />
        </SettingsControlRow>
      )}
      <ChoiceRow
        icon="clock"
        label="Change every"
        value={props.source.rotationMinutes}
        options={ROTATION_OPTIONS}
        onChange={(rotationMinutes) => setSource({ rotationMinutes })}
      />
      <ChoiceRow
        icon="line.3.horizontal"
        label="Order"
        value={props.source.order}
        options={ORDER_OPTIONS}
        onChange={(order) => setSource({ order })}
      />
      <ChoiceRow
        icon={{ ios: "sparkles", android: "auto_awesome" }}
        label="Transition"
        value={props.source.transition}
        options={TRANSITION_OPTIONS}
        onChange={(transition) => setSource({ transition })}
      />
    </SettingsSection>
  );
}

function LookSection(props: { readonly record: CustomBackgroundRecord }) {
  return (
    <SettingsSection title="Look">
      <PhoneBackgroundLookSliders record={props.record} />
    </SettingsSection>
  );
}

function ThemeSection(props: { readonly background: PhoneBackground }) {
  const update = useUpdatePhoneBackground();
  return (
    <SettingsSection title="Theme">
      <SettingsSwitchRow
        icon="paintbrush"
        label="Colors from pictures"
        value={props.background.dynamicTheme}
        onValueChange={(dynamicTheme) => update((background) => ({ ...background, dynamicTheme }))}
      />
    </SettingsSection>
  );
}

/** Everything about the phone's own wallpaper, opened from Appearance. */
export function PhoneBackgroundRouteScreen() {
  const insets = useSafeAreaInsets();
  const background = usePhoneBackground();
  const source = background?.record.source;
  return (
    <SettingsScreen title="Background">
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <PicturesSection background={background} />
        {background ? (
          <>
            {source?.kind === "image" ? <RotationSection source={source} /> : null}
            <LookSection record={background.record} />
            <ThemeSection background={background} />
          </>
        ) : null}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

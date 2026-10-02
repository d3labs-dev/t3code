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
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { type ComponentProps, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { showTextInputDialog } from "../../components/ConfirmDialogHost";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsChoiceRow } from "../settings/components/SettingsChoiceRow";
import { SettingsControlRow } from "../settings/components/SettingsControlRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  usePhoneBackground,
  usePhoneBackgroundEnabled,
  usePhoneBackgroundQuickAdjust,
  usePhonePlaylist,
  usePhonePlaylistSize,
  useUpdateActivePlaylist,
  useUpdatePhoneBackground,
} from "./phoneBackground";
import {
  type AddedPicture,
  activePhonePlaylist,
  phoneBackgroundShowingPlaylist,
  phoneBackgroundWithFolder,
  phoneBackgroundWithNewPlaylist,
  phoneBackgroundWithoutFolder,
  phoneBackgroundWithoutPicture,
  phoneBackgroundWithoutPlaylist,
  phoneBackgroundWithPictures,
  phoneBackgroundWithPlaylistName,
  phonePictureInUse,
} from "./phoneBackground.logic";
import { deletePhonePicture, phonePictureFile, pickPhonePictures } from "./phonePictures";
import { PhoneBackgroundLookSliders, PhoneBackgroundStepButtons } from "./PhoneBackgroundControls";
import { PhoneFolderChooser, PhoneLinkedFolders } from "./PhoneBackgroundFolders";

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

function pictureCountLabel(count: number): string {
  return `${count} ${count === 1 ? "picture" : "pictures"}`;
}

/** Saves a change to the phone's backgrounds, applied to the latest stored value. */
function useSavePhoneBackground() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  return (change: (current: PhoneBackground | null) => PhoneBackground | null) =>
    savePreferences({
      transform: (current) => ({ phoneBackground: change(current.phoneBackground ?? null) }),
    });
}

/** Deletes the stored files of pictures no playlist shows anymore. */
function deleteUnusedPictures(
  next: PhoneBackground | null,
  imageIds: ReadonlyArray<CustomBackgroundImageId>,
): void {
  for (const imageId of imageIds) {
    if (!phonePictureInUse(next, imageId)) deletePhonePicture(imageId);
  }
}

function pickedImageIds(playlist: CustomBackgroundRecord): ReadonlyArray<CustomBackgroundImageId> {
  return playlist.source.kind === "image" ? playlist.source.imageIds : [];
}

/** Opens the photo picker and hands over what was picked; nothing when cancelled. */
function usePickPictures(onPicked: (pictures: ReadonlyArray<AddedPicture>) => void) {
  const [busy, setBusy] = useState(false);
  const pick = () => {
    setBusy(true);
    pickPhonePictures()
      .then((pictures) => {
        if (pictures.length > 0) onPicked(pictures);
      })
      .catch((error: unknown) =>
        Alert.alert(
          "Could not add the photos",
          error instanceof Error ? error.message : "Something went wrong.",
        ),
      )
      .finally(() => setBusy(false));
  };
  return { busy, pick };
}

function GeneralSection(props: { readonly background: PhoneBackground }) {
  const enabled = usePhoneBackgroundEnabled();
  const quickAdjust = usePhoneBackgroundQuickAdjust();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  return (
    <SettingsSection title="Background">
      <SettingsSwitchRow
        icon="photo"
        label="Show behind home and threads"
        subtitle={activePhonePlaylist(props.background).name}
        value={enabled}
        onValueChange={(phoneBackgroundEnabled) => savePreferences({ phoneBackgroundEnabled })}
      />
      <SettingsSwitchRow
        icon="slider.horizontal.3"
        label="Quick adjust button"
        subtitle="Tune the look and switch playlists from home and threads."
        value={quickAdjust}
        onValueChange={(phoneBackgroundQuickAdjust) =>
          savePreferences({ phoneBackgroundQuickAdjust })
        }
      />
    </SettingsSection>
  );
}

function PlaylistRow(props: {
  readonly playlist: CustomBackgroundRecord;
  readonly selected: boolean;
  readonly separated: boolean;
  readonly onPress: () => void;
}) {
  const size = usePhonePlaylistSize(props.playlist.id);
  const folders = props.playlist.folders.length;
  return (
    <SettingsChoiceRow
      label={props.playlist.name}
      description={
        folders === 0
          ? pictureCountLabel(size)
          : `${pictureCountLabel(size)} · ${folders} synced ${folders === 1 ? "folder" : "folders"}`
      }
      selected={props.selected}
      separated={props.separated}
      disabled={false}
      onPress={props.onPress}
    />
  );
}

/** Every playlist on the phone; tapping one shows it. */
function PlaylistsSection(props: { readonly background: PhoneBackground | null }) {
  const save = useSavePhoneBackground();
  const createdAt = () => new Date().toISOString();
  const photos = usePickPictures((pictures) =>
    save((current) =>
      phoneBackgroundWithNewPlaylist(current, {
        id: randomUUID(),
        name: "Photos",
        pictures,
        albumIds: [],
        createdAt: createdAt(),
      }),
    ),
  );
  const activeId = props.background ? activePhonePlaylist(props.background).id : null;
  return (
    <SettingsSection title="Playlists">
      {props.background?.playlists.map((playlist, index) => (
        <PlaylistRow
          key={playlist.id}
          playlist={playlist}
          selected={playlist.id === activeId}
          separated={index > 0}
          onPress={() =>
            save((current) =>
              current ? phoneBackgroundShowingPlaylist(current, playlist.id) : current,
            )
          }
        />
      ))}
      <PhoneFolderChooser
        icon="folder.badge.plus"
        label="New playlist from a folder"
        exclude={[]}
        onChoose={(folder) =>
          save((current) =>
            phoneBackgroundWithNewPlaylist(current, {
              id: randomUUID(),
              name: folder.title,
              pictures: [],
              albumIds: [folder.id],
              createdAt: createdAt(),
            }),
          )
        }
      />
      <SettingsActionRow
        icon="plus"
        label={photos.busy ? "Adding photos…" : "New playlist from photos"}
        loading={photos.busy}
        disabled={photos.busy}
        onPress={photos.pick}
      />
    </SettingsSection>
  );
}

function renamePlaylist(name: string, onRename: (name: string) => void): void {
  if (Platform.OS === "ios") {
    Alert.prompt(
      "Rename playlist",
      undefined,
      (value) => onRename(value ?? ""),
      "plain-text",
      name,
    );
    return;
  }
  showTextInputDialog({
    title: "Rename playlist",
    initialValue: name,
    confirmText: "Rename",
    onConfirm: onRename,
  });
}

/** The showing playlist's own pictures and folders. */
function ActivePlaylistSection(props: { readonly background: PhoneBackground }) {
  const save = useSavePhoneBackground();
  const playlist = activePhonePlaylist(props.background);
  const imageIds = pickedImageIds(playlist);
  const photos = usePickPictures((pictures) =>
    save((current) => (current ? phoneBackgroundWithPictures(current, pictures) : current)),
  );

  const confirmRemove = (imageId: CustomBackgroundImageId) =>
    Alert.alert("Remove this picture?", "It is removed from this playlist.", [
      { style: "cancel", text: "Cancel" },
      {
        style: "destructive",
        text: "Remove",
        onPress: () => {
          save((current) => (current ? phoneBackgroundWithoutPicture(current, imageId) : current));
          deleteUnusedPictures(phoneBackgroundWithoutPicture(props.background, imageId), [imageId]);
        },
      },
    ]);
  const confirmDelete = () =>
    Alert.alert(
      `Delete ${playlist.name}?`,
      "Its own pictures are removed from the phone's background. Synced folders stay untouched.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => {
            save((current) =>
              current ? phoneBackgroundWithoutPlaylist(current, playlist.id) : current,
            );
            deleteUnusedPictures(
              phoneBackgroundWithoutPlaylist(props.background, playlist.id),
              imageIds,
            );
          },
        },
      ],
    );

  return (
    <SettingsSection title={playlist.name}>
      {imageIds.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-4 py-3"
        >
          {imageIds.map((imageId) => (
            <PictureTile
              key={imageId}
              imageId={imageId}
              disabled={photos.busy}
              onRemove={() => confirmRemove(imageId)}
            />
          ))}
        </ScrollView>
      ) : null}
      <SettingsActionRow
        icon="plus"
        label={photos.busy ? "Adding photos…" : "Add photos"}
        loading={photos.busy}
        disabled={photos.busy}
        onPress={photos.pick}
      />
      <PhoneLinkedFolders
        playlist={playlist}
        onUnlink={(albumId) =>
          save((current) => (current ? phoneBackgroundWithoutFolder(current, albumId) : current))
        }
      />
      <PhoneFolderChooser
        icon="folder.badge.plus"
        label="Sync a folder"
        exclude={playlist.folders.map((folder) => folder.path)}
        onChoose={(folder) =>
          save((current) => (current ? phoneBackgroundWithFolder(current, folder.id) : current))
        }
      />
      <SettingsActionRow
        icon="square.and.pencil"
        label="Rename playlist"
        onPress={() =>
          renamePlaylist(playlist.name, (name) =>
            save((current) =>
              current ? phoneBackgroundWithPlaylistName(current, playlist.id, name) : current,
            ),
          )
        }
      />
      <SettingsActionRow
        icon="trash"
        label="Delete playlist"
        tone="danger"
        onPress={confirmDelete}
      />
    </SettingsSection>
  );
}

function RotationSection(props: { readonly source: CustomBackgroundImageSource }) {
  const update = useUpdateActivePlaylist();
  const pictureCount = usePhonePlaylist()?.pictures.size ?? 0;
  const setSource = (change: Partial<CustomBackgroundImageSource>) =>
    update((playlist) =>
      playlist.source.kind === "image"
        ? { ...playlist, source: { ...playlist.source, ...change } }
        : playlist,
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
  const playlist = background === null ? null : activePhonePlaylist(background);
  return (
    <SettingsScreen title="Background">
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {background ? <GeneralSection background={background} /> : null}
        <PlaylistsSection background={background} />
        {background && playlist ? (
          <>
            <ActivePlaylistSection key={playlist.id} background={background} />
            {playlist.source.kind === "image" ? <RotationSection source={playlist.source} /> : null}
            <LookSection record={playlist} />
            <ThemeSection background={background} />
          </>
        ) : null}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

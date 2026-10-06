import { useAtomValue } from "@effect/atom-react";
import type { CustomBackgroundRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { type ComponentProps, useState } from "react";
import { Alert, Linking, View } from "react-native";

import type { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { usePhoneFolderRead } from "./phoneBackground";
import {
  appForegroundSignal,
  listPhoneFolders,
  type PhoneFolder,
  requestPhoneFolderAccess,
} from "./phoneFolders";

type FolderFlow =
  | { readonly step: "idle" }
  | { readonly step: "asking" }
  | { readonly step: "choosing"; readonly folders: ReadonlyArray<PhoneFolder> }
  | { readonly step: "limited" };

const IDLE: FolderFlow = { step: "idle" };

// Titles for linked folders; empty while photo access is off.
const folderTitlesAtom = Atom.make((get) => {
  get(appForegroundSignal);
  return Effect.promise(() =>
    listPhoneFolders().then(
      (folders) => new Map(folders.map((folder) => [folder.id, folder.title])),
      () => new Map<string, string>(),
    ),
  );
}).pipe(Atom.withLabel("phone-background-folder-titles"));

function usePhoneFolderTitles(): ReadonlyMap<string, string> | null {
  const titles = useAtomValue(folderTitlesAtom);
  return AsyncResult.isSuccess(titles) ? titles.value : null;
}

function photoCount(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}

function LinkedFolderRow(props: {
  readonly albumId: string;
  readonly title: string | undefined;
  readonly onUnlink: () => void;
}) {
  const read = usePhoneFolderRead(props.albumId);
  const status =
    read === null
      ? "Reading…"
      : read.status === "unreadable"
        ? "Needs photo access"
        : photoCount(read.pictures.length);
  return (
    <SettingsRow
      icon="folder.fill"
      label={props.title ?? "Folder"}
      value={status}
      onPress={props.onUnlink}
    />
  );
}

/**
 * The folders a playlist follows. Their photos are read in place each time the
 * background rotates, so additions and deletions show up on their own.
 */
export function PhoneLinkedFolders(props: {
  readonly playlist: CustomBackgroundRecord;
  readonly onUnlink: (albumId: string) => void;
}) {
  const titles = usePhoneFolderTitles();
  const confirmUnlink = (albumId: string) =>
    Alert.alert(
      "Stop syncing this folder?",
      "Its photos leave this playlist and stay on the phone.",
      [
        { style: "cancel", text: "Cancel" },
        { style: "destructive", text: "Stop syncing", onPress: () => props.onUnlink(albumId) },
      ],
    );
  return props.playlist.folders.map((folder) => (
    <LinkedFolderRow
      key={folder.path}
      albumId={folder.path}
      title={titles?.get(folder.path)}
      onUnlink={() => confirmUnlink(folder.path)}
    />
  ));
}

/**
 * A row that asks for photo access, then lists the phone's folders in place to
 * pick one. Access is asked for through expo-media-library, since on Android
 * 13+ expo-image-picker's request reports "granted" without asking.
 */
export function PhoneFolderChooser(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly exclude: ReadonlyArray<string>;
  readonly onChoose: (folder: PhoneFolder) => void;
}) {
  const [flow, setFlow] = useState<FolderFlow>(IDLE);

  const chooseFolder = async () => {
    setFlow({ step: "asking" });
    const access = await requestPhoneFolderAccess();
    switch (access) {
      case "granted":
        setFlow({ step: "choosing", folders: await listPhoneFolders() });
        return;
      case "limited":
        setFlow({ step: "limited" });
        return;
      case "denied":
        setFlow(IDLE);
        Alert.alert(
          "Photo access is off",
          "A synced folder is read from your photos. Allow access to choose one.",
          [
            { style: "cancel", text: "Not now" },
            { text: "Ask again", onPress: () => void start() },
          ],
        );
        return;
      case "blocked":
        setFlow(IDLE);
        Alert.alert(
          "Photo access is off",
          "Android won't ask again. Allow photos for this app in system settings to sync a folder.",
          [
            { style: "cancel", text: "Not now" },
            { text: "Open settings", onPress: () => void Linking.openSettings() },
          ],
        );
        return;
    }
  };
  const start = () =>
    chooseFolder().catch((error: unknown) => {
      setFlow(IDLE);
      Alert.alert(
        "Could not read your folders",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    });

  if (flow.step === "choosing") {
    return (
      <>
        <View className="px-4 pt-3">
          <Text className="text-sm text-foreground-muted">
            Choose a folder. Photos added to it later join the rotation.
          </Text>
        </View>
        {flow.folders
          .filter((folder) => !props.exclude.includes(folder.id))
          .map((folder) => (
            <SettingsRow
              key={folder.id}
              icon="folder.fill"
              label={folder.title}
              value={photoCount(folder.photoCount)}
              onPress={() => {
                setFlow(IDLE);
                props.onChoose(folder);
              }}
            />
          ))}
        <SettingsActionRow icon="xmark" label="Cancel" onPress={() => setFlow(IDLE)} />
      </>
    );
  }
  if (flow.step === "limited") {
    return (
      <>
        <View className="px-4 pt-3">
          <Text className="text-sm text-foreground-muted">
            The app can see only the photos you selected, so a folder would show just those and
            never pick up new ones. Allow all photos in system settings, then sync again.
          </Text>
        </View>
        <SettingsActionRow
          icon={{ ios: "lock.open", android: "lock" }}
          label="Open settings"
          onPress={() => {
            setFlow(IDLE);
            void Linking.openSettings();
          }}
        />
      </>
    );
  }
  return (
    <SettingsActionRow
      icon={props.icon}
      label={flow.step === "asking" ? "Opening folders…" : props.label}
      loading={flow.step === "asking"}
      disabled={flow.step === "asking"}
      onPress={() => void start()}
    />
  );
}

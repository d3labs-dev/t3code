import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { PhoneBackground } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsRow } from "../settings/components/SettingsRow";
import { usePhoneFolderRead } from "./phoneBackground";
import { phoneBackgroundWithFolder, phoneBackgroundWithoutFolder } from "./phoneBackground.logic";
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

// Titles for the linked folders; empty while photo access is off.
const folderTitlesAtom = Atom.make((get) => {
  get(appForegroundSignal);
  return Effect.promise(() =>
    listPhoneFolders().then(
      (folders) => new Map(folders.map((folder) => [folder.id, folder.title])),
      () => new Map<string, string>(),
    ),
  );
}).pipe(Atom.withLabel("phone-background-folder-titles"));

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
 * Device folders the playlist follows. Their photos are read in place each
 * time the background rotates, so additions and deletions show up on their own.
 */
export function PhoneBackgroundFolders(props: { readonly background: PhoneBackground | null }) {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const titlesResult = useAtomValue(folderTitlesAtom);
  const titles = AsyncResult.isSuccess(titlesResult) ? titlesResult.value : null;
  const [flow, setFlow] = useState<FolderFlow>(IDLE);
  const linked = props.background?.record.folders.map((folder) => folder.path) ?? [];

  const syncFolder = async () => {
    setFlow({ step: "asking" });
    const access = await requestPhoneFolderAccess();
    switch (access) {
      case "granted": {
        const folders = await listPhoneFolders();
        setFlow({ step: "choosing", folders });
        return;
      }
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
            { text: "Ask again", onPress: () => void startSync() },
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
  const startSync = () =>
    syncFolder().catch((error: unknown) => {
      setFlow(IDLE);
      Alert.alert(
        "Could not read your folders",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    });

  const link = (folder: PhoneFolder) => {
    setFlow(IDLE);
    savePreferences({
      transform: (current) => ({
        phoneBackground: phoneBackgroundWithFolder(
          current.phoneBackground ?? null,
          folder.id,
          new Date().toISOString(),
        ),
      }),
    });
  };
  const confirmUnlink = (albumId: string) => {
    Alert.alert(
      "Stop syncing this folder?",
      "Its photos leave the rotation and stay on the phone.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Stop syncing",
          onPress: () =>
            savePreferences({
              transform: (current) => ({
                phoneBackground: current.phoneBackground
                  ? phoneBackgroundWithoutFolder(current.phoneBackground, albumId)
                  : null,
              }),
            }),
        },
      ],
    );
  };

  return (
    <>
      {linked.map((albumId) => (
        <LinkedFolderRow
          key={albumId}
          albumId={albumId}
          title={titles?.get(albumId)}
          onUnlink={() => confirmUnlink(albumId)}
        />
      ))}
      {flow.step === "choosing" ? (
        <>
          <View className="px-4 pt-3">
            <Text className="text-sm text-foreground-muted">
              Choose a folder. Photos added to it later join the rotation.
            </Text>
          </View>
          {flow.folders
            .filter((folder) => !linked.includes(folder.id))
            .map((folder) => (
              <SettingsRow
                key={folder.id}
                icon="folder.fill"
                label={folder.title}
                value={photoCount(folder.photoCount)}
                onPress={() => link(folder)}
              />
            ))}
          <SettingsActionRow icon="xmark" label="Cancel" onPress={() => setFlow(IDLE)} />
        </>
      ) : flow.step === "limited" ? (
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
      ) : (
        <SettingsActionRow
          icon="folder.badge.plus"
          label={flow.step === "asking" ? "Opening folders…" : "Sync a folder"}
          loading={flow.step === "asking"}
          disabled={flow.step === "asking"}
          onPress={() => void startSync()}
        />
      )}
    </>
  );
}

import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { usePhoneBackgroundEnabled, usePhonePlaylist } from "./phoneBackground";

/** The Appearance entry for the phone's wallpaper; its settings have their own screen. */
export function PhoneBackgroundSection() {
  const playlist = usePhonePlaylist();
  const enabled = usePhoneBackgroundEnabled();
  const count = playlist?.pictures.size ?? 0;
  const status =
    count === 0
      ? "No pictures"
      : `${count} ${count === 1 ? "picture" : "pictures"}${enabled ? "" : " · Hidden"}`;
  return (
    <SettingsSection title="Background">
      <SettingsRow icon="photo" label="Wallpaper" value={status} target="SettingsPhoneBackground" />
    </SettingsSection>
  );
}

import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { usePhoneBackground, usePhoneBackgroundEnabled, usePhonePlaylist } from "./phoneBackground";
import { activePhonePlaylist } from "./phoneBackground.logic";

/** The Appearance entry for the phone's wallpaper; its settings have their own screen. */
export function PhoneBackgroundSection() {
  const background = usePhoneBackground();
  const playlist = usePhonePlaylist();
  const enabled = usePhoneBackgroundEnabled();
  const count = playlist?.pictures.size ?? 0;
  const status =
    background === null
      ? "No pictures"
      : `${activePhonePlaylist(background).name} · ${count} ${count === 1 ? "picture" : "pictures"}${enabled ? "" : " · Hidden"}`;
  return (
    <SettingsSection title="Background">
      <SettingsRow icon="photo" label="Wallpaper" value={status} target="SettingsPhoneBackground" />
    </SettingsSection>
  );
}

import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import {
  type ApkUpdateState,
  checkForApkUpdate,
  formatMegabytes,
  installApkUpdate,
  useApkUpdateState,
} from "./apk-updates";

export function ApkUpdateRow() {
  const update = useApkUpdateState();
  const row = describeRow(update);

  return (
    <SettingsActionRow
      icon={row.icon}
      label={row.label}
      loading={row.onPress === undefined}
      disabled={row.onPress === undefined}
      onPress={() => row.onPress?.()}
    />
  );
}

function describeRow(update: ApkUpdateState): {
  readonly icon: "arrow.clockwise" | "arrow.down.circle";
  readonly label: string;
  readonly onPress: (() => void) | undefined;
} {
  const check = () => void checkForApkUpdate("manual");
  switch (update.status) {
    case "idle":
      return { icon: "arrow.clockwise", label: "Check for updates", onPress: check };
    case "checking":
      return { icon: "arrow.clockwise", label: "Checking for updates", onPress: undefined };
    case "current":
      return { icon: "arrow.clockwise", label: "Up to date", onPress: check };
    case "available":
      return {
        icon: "arrow.down.circle",
        label: `Install ${update.release.versionName} (${formatMegabytes(update.release.sizeBytes)})`,
        onPress: () => void installApkUpdate(update.release),
      };
    case "downloading":
      return {
        icon: "arrow.down.circle",
        label: `Downloading update… ${update.percent}%`,
        onPress: undefined,
      };
    case "installing":
      return { icon: "arrow.down.circle", label: "Opening installer…", onPress: undefined };
  }
}

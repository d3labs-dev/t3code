import { useAtomValue } from "@effect/atom-react";
import { serveModeComputerName } from "@t3tools/client-runtime/serve-mode";
import type { UnifiedSettings } from "@t3tools/contracts";
import {
  CoffeeIcon,
  ImageIcon,
  ImagesIcon,
  MoonIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { openBackgroundStudio } from "~/customBackground/backgroundStudioStore";
import { stepBackgroundImage } from "~/customBackground/rotation";
import { useActiveBackground } from "~/customBackground/useActiveBackground";
import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The custom nightly's own footer buttons, after upstream's utility items. */
export function SidebarFooterExtras() {
  return (
    <>
      <SidebarBackgroundMenu />
      <SidebarServeModeItem />
    </>
  );
}

function SidebarBackgroundMenu() {
  const active = useActiveBackground();
  const playlists = useClientSettings((settings) => settings.customBackgrounds);
  const enabled = useClientSettings((settings) => settings.customBackgroundEnabled);
  const updateSettings = useUpdateClientSettings();
  const rotating = active?.source.kind === "image" && active.source.imageIds.length > 1;
  if (!enabled) return null;
  return (
    <SidebarMenuItem className="shrink-0">
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger render={<SidebarMenuButton aria-label="Background" size="icon" />}>
                <ImageIcon />
              </MenuTrigger>
            }
          />
          <TooltipPopup side="top">Background</TooltipPopup>
        </Tooltip>
        <MenuPopup side="top" align="start">
          <MenuItem disabled={!rotating} onClick={() => stepBackgroundImage(1)}>
            <SkipForwardIcon /> Next image
          </MenuItem>
          <MenuItem disabled={!rotating} onClick={() => stepBackgroundImage(-1)}>
            <SkipBackIcon /> Previous image
          </MenuItem>
          <MenuSeparator />
          {playlists.length > 0 ? (
            <MenuSub>
              <MenuSubTrigger>
                <ImagesIcon /> Playlist
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuRadioGroup value={active?.id ?? null}>
                  {playlists.map((playlist) => (
                    <MenuRadioItem
                      key={playlist.id}
                      value={playlist.id}
                      onClick={() => updateSettings({ activeCustomBackgroundId: playlist.id })}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                        <MenuRadioItemIndicator />
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>
          ) : null}
          <MenuItem onClick={openBackgroundStudio}>
            <SlidersHorizontalIcon /> Customize background
          </MenuItem>
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );
}

const selectServeMode = (settings: UnifiedSettings) => settings.serveMode;

/** Serve mode for this computer's server, on the platforms that act on it. */
function SidebarServeModeItem() {
  const primaryConfig = useAtomValue(serverEnvironment.configValueAtom(usePrimaryEnvironmentId()));
  const serveMode = usePrimarySettings(selectServeMode);
  const updateSettings = useUpdatePrimarySettings();
  const computer = primaryConfig
    ? serveModeComputerName(primaryConfig.environment.platform.os)
    : null;
  if (!primaryConfig || !computer || primaryConfig.environment.capabilities.serveMode !== true) {
    return null;
  }
  const sleepsWithLidClosed =
    serveMode && primaryConfig.environment.capabilities.serveModeLidClosed === false;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label="Serve mode"
              aria-pressed={serveMode}
              isActive={serveMode}
              onClick={() => updateSettings({ serveMode: !serveMode })}
              size="icon"
            >
              {serveMode ? (
                <CoffeeIcon className={sleepsWithLidClosed ? "text-warning" : undefined} />
              ) : (
                <MoonIcon />
              )}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">
          {sleepsWithLidClosed
            ? "Serve mode on, but closing the lid still sleeps this Mac. Run sudo scripts/serve-mode/install.sh to keep it running lid-closed."
            : serveMode
              ? `Serve mode on: this ${computer} stays awake for agents and your phone`
              : `Serve mode off: this ${computer} can sleep`}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

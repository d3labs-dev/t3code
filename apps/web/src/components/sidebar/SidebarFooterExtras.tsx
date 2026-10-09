import {
  ImageIcon,
  ImagesIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { openBackgroundStudio } from "~/customBackground/backgroundStudioStore";
import { stepBackgroundImage } from "~/customBackground/rotation";
import { useActiveBackground } from "~/customBackground/useActiveBackground";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
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

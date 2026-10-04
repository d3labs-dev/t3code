import { useEffect } from "react";

import { applyAgentBubbleSurface } from "~/customBackground/agentBubbles";
import {
  useBackgroundStudioOpen,
  useBackgroundStudioStore,
} from "~/customBackground/backgroundStudioStore";
import { useBackgroundImageSourceColor } from "~/customBackground/imageStore";
import { resolveActiveBackground } from "~/customBackground/records";
import { useRotatingBackgroundImage } from "~/customBackground/rotation";
import { useActiveBackground } from "~/customBackground/useActiveBackground";
import { useDynamicBackgroundTheme } from "~/customBackground/useDynamicBackgroundTheme";
import { useClientSettings } from "~/hooks/useSettings";

const NO_SOURCE = { kind: "none" } as const;

/**
 * Keeps the image-colors theme and the agent bubble surface applied on every
 * route. The picture itself only draws behind chats, but the palette it seeds
 * stays put in settings and the rest of the app, the way a phone keeps its
 * wallpaper colors on every screen.
 */
export function BackgroundThemeSync() {
  const selected = useActiveBackground();
  const enabled = useClientSettings((settings) => settings.customBackgroundEnabled);
  const dynamicTheme = useClientSettings((settings) => settings.customBackgroundDynamicTheme);
  const bubbleOpacity = useClientSettings(
    (settings) => settings.customBackgroundAgentBubbleOpacity,
  );
  const bubbleBlur = useClientSettings((settings) => settings.customBackgroundAgentBubbleBlur);
  const bubblePadding = useClientSettings(
    (settings) => settings.customBackgroundAgentBubblePadding,
  );
  const textShadow = useClientSettings((settings) => settings.customBackgroundReplyTextShadow);
  useEffect(() => {
    applyAgentBubbleSurface(document.documentElement, {
      opacity: bubbleOpacity,
      blur: bubbleBlur,
      padding: bubblePadding,
    });
    document.documentElement.style.setProperty("--reply-text-shadow-opacity", `${textShadow}%`);
  }, [bubbleOpacity, bubbleBlur, bubblePadding, textShadow]);
  const editing = useBackgroundStudioOpen();
  const preview = useBackgroundStudioStore((store) => store.preview);
  const record = dynamicTheme
    ? resolveActiveBackground({ selected, preview, enabled, editing })
    : null;
  const { current, upcoming } = useRotatingBackgroundImage(record?.source ?? NO_SOURCE);
  useDynamicBackgroundTheme(current);
  // Warm the next picture's colors so the theme switches in the same frame as
  // the picture, which CustomBackground preloads the same way.
  useBackgroundImageSourceColor(upcoming);
  return null;
}

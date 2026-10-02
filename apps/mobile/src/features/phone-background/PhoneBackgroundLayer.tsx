import { adaptToBrightness } from "@t3tools/shared/customBackgroundBrightness";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  usePhoneBackgroundImage,
  usePhonePictureMeasure,
  useShownPhoneBackground,
} from "./phoneBackground";
import { activePhonePlaylist, fadeOverlayGradient } from "./phoneBackground.logic";

// The desktop's slide transition length, so a rotation looks the same on both.
const FADE_TRANSITION = { duration: 1400, effect: "cross-dissolve" } as const;

/**
 * Draws the phone's background behind navigation. Home and thread screens
 * clear their backdrop while it shows, so the picture fills the phone the way
 * a wallpaper does: cropped to cover, centered, under the same bottom fade
 * and brightness adapt the desktop draws.
 */
export function PhoneBackgroundLayer() {
  const background = useShownPhoneBackground();
  const { phoneBackdropColor, themeAppearance } = useAppearancePreferences();
  const record = background === null ? null : activePhonePlaylist(background);
  const image = usePhoneBackgroundImage();
  const current = record === null ? null : image.current;
  const tone = usePhonePictureMeasure(current?.uri ?? null)?.tone;
  // Measured ahead so the next picture arrives with its own look already known.
  usePhonePictureMeasure(record === null ? null : (image.upcoming?.uri ?? null));
  if (record === null || phoneBackdropColor === null) return null;
  const look = tone ? adaptToBrightness({ ...record, tone, appearance: themeAppearance }) : record;

  return (
    <View
      pointerEvents="none"
      className="absolute inset-0"
      style={{ backgroundColor: phoneBackdropColor }}
    >
      {current !== null ? (
        <Image
          source={{ uri: current.uri }}
          style={[StyleSheet.absoluteFill, { opacity: look.opacity / 100 }]}
          contentFit="cover"
          contentPosition="center"
          transition={
            record.source.kind === "image" && record.source.transition === "fade"
              ? FADE_TRANSITION
              : null
          }
        />
      ) : null}
      <View
        className="absolute inset-0"
        style={{
          experimental_backgroundImage: fadeOverlayGradient(phoneBackdropColor, {
            ...record,
            fade: look.fade,
          }),
        }}
      />
    </View>
  );
}

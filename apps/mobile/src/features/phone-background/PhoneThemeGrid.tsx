import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useShownPhoneBackground } from "./phoneBackground";

/**
 * The theme card grid, replaced by a note while the wallpaper's colors theme
 * the app, since no card choice would show.
 */
export function PhoneThemeGrid(props: { readonly children: ReactNode }) {
  const background = useShownPhoneBackground();
  if (background?.dynamicTheme) {
    return (
      <Text className="px-2 text-sm text-foreground-muted">
        Colors come from your wallpaper. Turn off Colors from pictures under Background to pick a
        theme.
      </Text>
    );
  }
  return <View className="flex-row flex-wrap gap-3">{props.children}</View>;
}

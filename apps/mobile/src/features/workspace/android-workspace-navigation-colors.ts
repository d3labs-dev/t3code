import {
  flattenThemeColor,
  themeColorWithAlpha,
  themeColorWithContrast,
  type MobileThemeVariables,
} from "../../lib/mobileTheme";

/**
 * The selection stays visible against the bar's actual surface.
 * Over a phone background the bar stays clear so the picture runs to the bottom edge,
 * and its selection is measured against the backdrop color the picture fades into.
 */
export function androidWorkspaceNavigationColors(input: {
  readonly colors: MobileThemeVariables;
  readonly phoneBackdropColor: string | null;
}) {
  const { colors, phoneBackdropColor } = input;
  const header =
    phoneBackdropColor ?? flattenThemeColor(colors["--color-header"], colors["--color-screen"]);
  const surfaceColor = flattenThemeColor(
    themeColorWithAlpha(colors["--color-header-foreground"], 0.05),
    header,
  );
  const indicatorColor = themeColorWithContrast(
    flattenThemeColor(colors["--color-secondary"], surfaceColor),
    surfaceColor,
    1.5,
  );
  return {
    containerColor: phoneBackdropColor === null ? surfaceColor : "transparent",
    indicatorColor,
    selectedColor: themeColorWithContrast(
      flattenThemeColor(colors["--color-secondary-foreground"], indicatorColor),
      [indicatorColor, surfaceColor],
    ),
    unselectedColor: flattenThemeColor(colors["--color-header-foreground"], surfaceColor),
  };
}

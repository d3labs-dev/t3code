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
 * Floating tabs keep their own surface.
 */
export function androidWorkspaceNavigationColors(input: {
  readonly colors: MobileThemeVariables;
  readonly phoneBackdropColor: string | null;
  readonly rail: boolean;
  readonly floating?: boolean;
}) {
  const { colors, phoneBackdropColor, rail, floating = false } = input;
  const header =
    phoneBackdropColor ?? flattenThemeColor(colors["--color-header"], colors["--color-screen"]);
  const containerColor = rail
    ? header
    : floating
      ? flattenThemeColor(colors["--color-secondary"], colors["--color-screen"])
      : flattenThemeColor(themeColorWithAlpha(colors["--color-header-foreground"], 0.05), header);
  const indicatorColor = themeColorWithContrast(
    flattenThemeColor(colors["--color-secondary"], containerColor),
    containerColor,
    1.5,
  );
  return {
    containerColor:
      rail || floating || phoneBackdropColor === null ? containerColor : "transparent",
    indicatorColor,
    selectedColor: themeColorWithContrast(
      flattenThemeColor(colors["--color-secondary-foreground"], indicatorColor),
      [indicatorColor, containerColor],
    ),
    unselectedColor: floating
      ? themeColorWithContrast(
          flattenThemeColor(colors["--color-secondary-foreground"], containerColor),
          containerColor,
        )
      : flattenThemeColor(colors["--color-header-foreground"], containerColor),
  };
}

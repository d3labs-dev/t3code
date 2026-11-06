import {
  flattenThemeColor,
  isDarkThemeColor,
  themeColorWithAlpha,
  themeColorWithContrast,
  type MobileThemeVariables,
} from "../../../lib/mobileTheme";

// A dark page swallows the native shadow, so the fill alone has to lift the pill off the page
// and off the cards it floats over.
function floatingContainerColor(colors: MobileThemeVariables) {
  const screen = colors["--color-screen"];
  const fill = flattenThemeColor(colors["--color-secondary"], screen);
  if (!isDarkThemeColor(screen)) return fill;
  return themeColorWithContrast(
    fill,
    [screen, flattenThemeColor(colors["--color-grouped-card"], screen)],
    1.25,
  );
}

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
  const screen = colors["--color-screen"];
  const header = phoneBackdropColor ?? flattenThemeColor(colors["--color-header"], screen);
  const containerColor = rail
    ? header
    : floating
      ? floatingContainerColor(colors)
      : flattenThemeColor(themeColorWithAlpha(colors["--color-header-foreground"], 0.05), header);
  // The lifted dark pill already took the secondary fill's place, so its indicator lifts further.
  const indicatorColor = themeColorWithContrast(
    floating && isDarkThemeColor(screen)
      ? containerColor
      : flattenThemeColor(colors["--color-secondary"], containerColor),
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

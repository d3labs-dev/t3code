import {
  type DynamicColor,
  Hct,
  MaterialDynamicColors as Material,
  SchemeTonalSpot,
  hexFromArgb,
} from "@material/material-color-utilities";

import type { DynamicTheme, ThemeAppearance, ThemeColors } from "~/themePalette";

/**
 * Tonal spot is the scheme Android defaults to for wallpaper colors. It keeps
 * chroma low enough that a saturated picture still yields surfaces someone can
 * read a diff on, which the vivid schemes do not.
 */
const CONTRAST_LEVEL = 0;
/** Amber, because Material has no warning role and a warning has to stay a warning. */
const WARNING_HUE = 80;
const WARNING_CHROMA = 70;
/**
 * Tonal spot's neutrals carry so little chroma that a dark sidebar reads as
 * black beside the picture. The sidebar takes the seed's hue at up to this
 * chroma instead, low enough that row text keeps its contrast.
 */
const SIDEBAR_MAX_CHROMA = 14;
/** How far a fully colorful seed moves the sidebar off the end of the tone scale. */
const SIDEBAR_MAX_LIFT = { dark: 6, light: 3 } as const;

/**
 * Repaints every theme role from one seed color the way Material builds a
 * scheme from a wallpaper. Roles Material names directly are taken as they
 * come; the rest are pulled to an explicit tone so T3's own contrast steps
 * (raised surfaces lighter than flat ones, sidebar rows stepping off the
 * sidebar) survive the translation.
 */
export function backgroundThemeColors(
  sourceColor: number,
  appearance: ThemeAppearance,
): ThemeColors {
  const dark = appearance === "dark";
  const scheme = new SchemeTonalSpot(Hct.fromInt(sourceColor), dark, CONTRAST_LEVEL);
  const color = (role: DynamicColor): string => hexFromArgb(role.getArgb(scheme));
  const tone = (role: DynamicColor, value: number): string => {
    const hct = role.getHct(scheme);
    return hexFromArgb(Hct.from(hct.hue, hct.chroma, value).toInt());
  };
  const warning = (value: number): string =>
    hexFromArgb(Hct.from(WARNING_HUE, WARNING_CHROMA, value).toInt());
  // The sidebar is T3's darkest plane in dark mode and its lightest in light
  // mode. A colorless picture keeps it there; color lifts it toward the canvas.
  const sidebarChroma = Math.min(SIDEBAR_MAX_CHROMA, scheme.sourceColorHct.chroma);
  const sidebarLift = SIDEBAR_MAX_LIFT[appearance] * (sidebarChroma / SIDEBAR_MAX_CHROMA);
  const sidebarBase = dark ? 4 + sidebarLift : 100 - sidebarLift;
  const sidebarStep = (steps: number): string =>
    hexFromArgb(
      Hct.from(
        scheme.sourceColorHct.hue,
        sidebarChroma,
        dark ? sidebarBase + steps : sidebarBase - steps,
      ).toInt(),
    );

  return {
    canvas: color(Material.surface),
    chrome: color(Material.surfaceContainerLow),
    toolbar: color(Material.surfaceContainerLow),
    toolbarForeground: color(Material.onSurface),
    toolbarBorder: color(Material.surfaceContainerHighest),
    toolbarControl: color(Material.surfaceContainerHigh),
    toolbarControlForeground: color(Material.onSurface),
    toolbarControlHover: color(Material.surfaceContainerHighest),
    surface: color(Material.surfaceContainer),
    surfaceRaised: color(Material.surfaceContainerHigh),
    surfaceOverlay: color(Material.surfaceContainerHigh),
    text: color(Material.onSurface),
    textMuted: color(Material.onSurfaceVariant),
    border: color(Material.surfaceContainerHighest),
    input: color(Material.surfaceContainerLowest),
    focus: color(Material.primary),
    accent: color(Material.primary),
    accentForeground: color(Material.onPrimary),
    secondary: color(Material.secondaryContainer),
    secondaryForeground: color(Material.onSecondaryContainer),
    muted: color(Material.surfaceContainer),
    mutedForeground: color(Material.onSurfaceVariant),
    placeholder: color(Material.onSurfaceVariant),
    secondaryLabel: color(Material.onSurfaceVariant),
    iconMuted: color(Material.onSurfaceVariant),
    error: color(Material.error),
    errorForeground: tone(Material.error, dark ? 75 : 40),
    errorSurface: color(Material.errorContainer),
    warning: warning(dark ? 70 : 45),
    warningForeground: warning(dark ? 80 : 35),
    warningSurface: warning(dark ? 18 : 92),
    update: color(Material.primary),
    updateForeground: tone(Material.primary, dark ? 80 : 40),
    updateSurface: color(Material.primaryContainer),
    accentSurface: color(Material.surfaceContainerHigh),
    accentSurfaceForeground: color(Material.onSurface),
    messageSurface: color(Material.surfaceContainerHigh),
    messageForeground: color(Material.onSurface),
    messageAction: color(Material.primary),
    messageActionForeground: color(Material.onPrimary),
    messageActionHover: tone(Material.primary, dark ? 70 : 35),
    codeBackground: color(Material.surfaceContainer),
    codeForeground: color(Material.onSurface),
    searchMatchBackground: warning(dark ? 25 : 90),
    searchMatchForeground: color(Material.onSurface),
    searchMatchActiveBackground: warning(70),
    searchMatchActiveForeground: warning(10),
    sidebar: sidebarStep(0),
    sidebarForeground: color(Material.onSurface),
    sidebarMutedForeground: color(Material.onSurfaceVariant),
    sidebarControlSurface: sidebarStep(4),
    sidebarRowHover: sidebarStep(4),
    sidebarRowActive: sidebarStep(10),
    sidebarRowSelected: sidebarStep(7),
    sidebarBorder: sidebarStep(8),
    terminalBackground: color(Material.surface),
    terminalForeground: color(Material.onSurface),
    terminalCursor: color(Material.primary),
    terminalSelection: color(Material.secondaryContainer),
    terminalScrollbar: color(Material.surfaceContainerHighest),
    terminalScrollbarHover: color(Material.outlineVariant),
  };
}

/**
 * The sidebar header art paints itself from its own variables, so the seed has
 * to reach them too or a blue header sits above an orange interface. Tones
 * mirror the shipped artwork's own light-to-dark run rather than the surface
 * ladder: this is illustration, and it stays brighter than any surface.
 */
function stageArtworkVariables(scheme: SchemeTonalSpot): Record<string, string> {
  const primary = (value: number): string =>
    hexFromArgb(
      Hct.from(
        scheme.sourceColorHct.hue,
        Math.max(48, scheme.sourceColorHct.chroma),
        value,
      ).toInt(),
    );
  const accentHue = (scheme.sourceColorHct.hue + 40) % 360;
  const accent = (value: number): string => hexFromArgb(Hct.from(accentHue, 60, value).toInt());

  return {
    "--stage-art-top": primary(78),
    "--stage-art-mid": primary(62),
    "--stage-art-bottom": primary(44),
    "--stage-art-highlight": primary(95),
    "--stage-art-secondary": accent(79),
    "--stage-art-tertiary": accent(68),
    "--stage-art-line": primary(96),
    "--stage-art-grid-line": primary(97),
    "--stage-art-celeste-highlight": accent(97),
    "--stage-art-celeste-secondary": accent(83),
    "--stage-art-violet-highlight": primary(90),
    "--stage-night-base-top": primary(28),
    "--stage-night-base-mid": primary(23),
    "--stage-night-base-bottom": primary(20),
    "--stage-night-highlight": primary(71),
    "--stage-night-secondary": accent(60),
    "--stage-night-tertiary": accent(63),
    "--stage-night-line": primary(94),
    "--stage-night-glow-highlight": primary(55),
    "--stage-night-glow-secondary": primary(35),
    "--stage-night-sparkle": primary(88),
  };
}

/** The full repaint for one picture: interface roles plus the header artwork. */
export function backgroundTheme(sourceColor: number, appearance: ThemeAppearance): DynamicTheme {
  const scheme = new SchemeTonalSpot(
    Hct.fromInt(sourceColor),
    appearance === "dark",
    CONTRAST_LEVEL,
  );
  return {
    colors: backgroundThemeColors(sourceColor, appearance),
    artwork: stageArtworkVariables(scheme),
  };
}

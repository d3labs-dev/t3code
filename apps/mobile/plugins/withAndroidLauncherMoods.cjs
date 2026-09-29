const fs = require("node:fs");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// One launcher icon per mascot mood. The art is apps/desktop/resources/mascot framed like
// assets/android-icon-background-d3code.png, and each file name is a mood from
// DesktopMascotMoodSchema. modules/t3-launcher-mood enables the alias for the current mood.
const MOOD_ART_DIRECTORY = "assets/launcher-mood";
const INITIAL_MOOD = "default";
const LAUNCHER_CATEGORY = "android.intent.category.LAUNCHER";

function listMoods(projectRoot) {
  return fs
    .readdirSync(path.join(projectRoot, MOOD_ART_DIRECTORY))
    .filter((file) => file.endsWith(".png"))
    .map((file) => path.basename(file, ".png"))
    .sort();
}

const iconName = (mood) => `ic_launcher_mood_${mood}`;
const nameAttribute = (element) => element.$["android:name"];

function launcherAlias(androidPackage, mood) {
  const icon = `@mipmap/${iconName(mood)}`;
  return {
    $: {
      "android:name": `${androidPackage}.LauncherMood_${mood}`,
      "android:targetActivity": ".MainActivity",
      "android:enabled": mood === INITIAL_MOOD ? "true" : "false",
      "android:exported": "true",
      "android:icon": icon,
      "android:roundIcon": icon,
    },
    "intent-filter": [
      {
        action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
        category: [{ $: { "android:name": LAUNCHER_CATEGORY } }],
      },
    ],
  };
}

// The launcher entry moves from MainActivity to the aliases. MainActivity stays enabled with its
// deep-link and share filters, so switching aliases never disables the running component.
function withLauncherAliases(config) {
  return withAndroidManifest(config, (next) => {
    const androidPackage = next.android?.package;
    if (!androidPackage) {
      throw new Error("withAndroidLauncherMoods: android.package is required.");
    }
    const moods = listMoods(next.modRequest.projectRoot);
    if (!moods.includes(INITIAL_MOOD)) {
      throw new Error(`withAndroidLauncherMoods: ${MOOD_ART_DIRECTORY} needs ${INITIAL_MOOD}.png.`);
    }

    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(next.modResults);
    mainActivity["intent-filter"] = (mainActivity["intent-filter"] ?? []).filter(
      (filter) =>
        !(filter.category ?? []).some((category) => nameAttribute(category) === LAUNCHER_CATEGORY),
    );

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults);
    const aliasPrefix = `${androidPackage}.LauncherMood_`;
    application["activity-alias"] = [
      ...(application["activity-alias"] ?? []).filter(
        (alias) => !nameAttribute(alias).startsWith(aliasPrefix),
      ),
      ...moods.map((mood) => launcherAlias(androidPackage, mood)),
    ];
    return next;
  });
}

const adaptiveIconXml = (mood) => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/${iconName(mood)}_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;

// Android 7 has no adaptive icons; it shows the framed art as a plain bitmap.
const legacyIconXml = (mood) => `<?xml version="1.0" encoding="utf-8"?>
<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@mipmap/${iconName(mood)}_background"/>
`;

// The 432px art is the 108dp adaptive layer at xxxhdpi; Android scales it for other densities.
function withLauncherIconResources(config) {
  return withDangerousMod(config, [
    "android",
    (next) => {
      const { projectRoot, platformProjectRoot } = next.modRequest;
      const res = path.join(platformProjectRoot, "app/src/main/res");
      const directories = ["mipmap-xxxhdpi", "mipmap-anydpi", "mipmap-anydpi-v26"];
      for (const directory of directories) {
        fs.mkdirSync(path.join(res, directory), { recursive: true });
      }
      for (const mood of listMoods(projectRoot)) {
        fs.copyFileSync(
          path.join(projectRoot, MOOD_ART_DIRECTORY, `${mood}.png`),
          path.join(res, "mipmap-xxxhdpi", `${iconName(mood)}_background.png`),
        );
        fs.writeFileSync(
          path.join(res, "mipmap-anydpi", `${iconName(mood)}.xml`),
          legacyIconXml(mood),
        );
        fs.writeFileSync(
          path.join(res, "mipmap-anydpi-v26", `${iconName(mood)}.xml`),
          adaptiveIconXml(mood),
        );
      }
      return next;
    },
  ]);
}

module.exports = function withAndroidLauncherMoods(config) {
  return withLauncherIconResources(withLauncherAliases(config));
};

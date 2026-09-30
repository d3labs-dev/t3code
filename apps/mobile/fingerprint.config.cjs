const { SourceSkips } = require("expo/fingerprint");

/**
 * The fork's sideloaded APK gets a new version name and code on every build.
 * Leaving them out of the runtime fingerprint lets an over-the-air update reach
 * every installed APK whose native code matches, not just the one built with it.
 * @type {import("expo/fingerprint").Config}
 */
module.exports = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions | SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
};

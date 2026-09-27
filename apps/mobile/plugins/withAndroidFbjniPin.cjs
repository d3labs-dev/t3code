const { withProjectBuildGradle } = require("expo/config-plugins");

// react-native-shiki-engine asks for `fbjni:+`, which resolves to fbjni 0.8.x.
// Those binaries need NDK r28's libc++, but React Native 0.86 ships NDK r27's
// libc++_shared.so, so the app dies loading libfbjni.so before any JS runs.
// Keep this at the fbjni version React Native's libs.versions.toml pins, and
// move it whenever React Native bumps fbjni.
//
// FORK-ONLY STOPGAP for pingdotgg/t3code#13710. When merging an upstream
// branch that fixes that issue (its own fbjni pin, a shiki-engine patch, or a
// shiki-engine release without `fbjni:+`), delete this file and its entry in
// app.config.ts so the two fixes do not fight.
const FBJNI_VERSION = "0.7.0";
const MARKER = "// withAndroidFbjniPin";

module.exports = function withAndroidFbjniPin(config) {
  return withProjectBuildGradle(config, (nextConfig) => {
    if (!nextConfig.modResults.contents.includes(MARKER)) {
      nextConfig.modResults.contents += `
${MARKER}
allprojects {
  configurations.configureEach {
    resolutionStrategy.force "com.facebook.fbjni:fbjni:${FBJNI_VERSION}"
  }
}
`;
    }
    return nextConfig;
  });
};

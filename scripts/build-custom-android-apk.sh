#!/bin/bash
# Builds the fork's signed Android APK, which updates itself from GitHub releases.
# Needs Java 17 in JAVA_HOME, the Android SDK in ANDROID_HOME, and the release
# keystore in T3CODE_ANDROID_KEYSTORE with its password in T3CODE_ANDROID_KEYSTORE_PASSWORD.

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <version-name> <version-code> <output.apk>" >&2
  exit 1
fi
: "${T3CODE_ANDROID_KEYSTORE:?Set T3CODE_ANDROID_KEYSTORE to the release keystore path.}"
: "${T3CODE_ANDROID_KEYSTORE_PASSWORD:?Set T3CODE_ANDROID_KEYSTORE_PASSWORD.}"

keystore="$(cd "$(dirname "$T3CODE_ANDROID_KEYSTORE")" && pwd)/$(basename "$T3CODE_ANDROID_KEYSTORE")"
output="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
source "$(dirname "$0")/lib/custom-android-env.sh" "$1" "$2"

cd "$repo_root/apps/mobile"
EXPO_NO_GIT_STATUS=1 vp exec expo prebuild --clean --platform android --no-install

cd android
# Release lint re-analyzes every native module on each build and gates nothing
# the fork's checks miss. The build cache lives in the Gradle home CI restores.
./gradlew :app:assembleRelease \
  --build-cache \
  -x lintVitalRelease \
  -PreactNativeArchitectures=arm64-v8a \
  "-Pandroid.injected.signing.store.file=$keystore" \
  "-Pandroid.injected.signing.store.password=$T3CODE_ANDROID_KEYSTORE_PASSWORD" \
  "-Pandroid.injected.signing.key.alias=${T3CODE_ANDROID_KEY_ALIAS:-t3code-custom}" \
  "-Pandroid.injected.signing.key.password=$T3CODE_ANDROID_KEYSTORE_PASSWORD"
cp app/build/outputs/apk/release/app-release.apk "$output"
echo "Built $output"

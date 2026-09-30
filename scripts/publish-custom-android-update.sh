#!/bin/bash
# Publishes the JavaScript of a just-built custom APK over the air, reaching
# every installed APK with the same native code. Run it from the checkout and
# environment that built the APK. Needs eas-cli, jq, EXPO_TOKEN, and
# T3CODE_EXPO_PROJECT_ID. Prints the runtime version the update targets.

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 <version-name> <version-code> <built.apk> <message>" >&2
  exit 1
fi
: "${EXPO_TOKEN:?Set EXPO_TOKEN to an Expo access token.}"
: "${T3CODE_EXPO_PROJECT_ID:?Set T3CODE_EXPO_PROJECT_ID to the fork Expo project ID.}"

apk_runtime_version="$(unzip -p "$3" assets/fingerprint)"
source "$(dirname "$0")/lib/custom-android-env.sh" "$1" "$2"

cd "$repo_root/apps/mobile"
export EXPO_NO_GIT_STATUS=1
runtime_version="$(vp exec expo-updates fingerprint:generate --platform android | jq -er .hash)"
# An update for a runtime no APK has would never load, while the APK updater
# would skip that release on the promise that it did.
if [[ "$runtime_version" != "$apk_runtime_version" ]]; then
  echo "The update's runtime $runtime_version does not match the APK's $apk_runtime_version." >&2
  exit 1
fi

eas update \
  --channel custom-nightly \
  --platform android \
  --message "$4" \
  --non-interactive >&2
echo "$runtime_version"

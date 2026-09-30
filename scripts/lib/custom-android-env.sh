# Sourced with <version-name> <version-code> by the custom Android build and
# update scripts, so an APK and the update published beside it read the same
# app config and share one runtime fingerprint.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export APP_VARIANT=preview
export T3CODE_ANDROID_UPDATE_RELEASES_URL="${T3CODE_ANDROID_UPDATE_RELEASES_URL:-https://api.github.com/repos/d3labs-dev/t3code/releases}"
export T3CODE_ANDROID_VERSION_NAME="$1"
export T3CODE_ANDROID_VERSION_CODE="$2"
# The public T3 Connect identifiers official builds ship with, overriding any local .env.
while IFS= read -r setting; do
  export "$setting"
done < <(sed -n '/^T3CODE_CLERK_PUBLISHABLE_KEY=/p; /^T3CODE_CLERK_JWT_TEMPLATE=/p; /^T3CODE_RELAY_URL=/p' "$repo_root/.env.example")

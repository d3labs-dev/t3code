#!/bin/bash
# Builds the custom nightly's macOS app and Android APK on this Mac and attaches
# them to the newest release that lacks them. scripts/custom-nightly-linux.sh
# creates the releases on the Linux machine. Runs from a dedicated clone, which
# it resets to each release's commit, so never point it at a checkout you work
# in. Install the launch agent with `--install`; remove it with `--uninstall`.

set -euo pipefail

readonly repository="d3labs-dev/t3code"
# Work switches the active gh account to one that cannot write to the fork.
readonly github_account="DiegoJohnsonL"
readonly builder_home="$HOME/.local/share/d3code-builder"
readonly label="com.diegojohnson.d3code.builder"
readonly launch_agent_path="$HOME/Library/LaunchAgents/$label.plist"
readonly signing_identity="${T3CODE_LOCAL_SIGNING_IDENTITY:-T3 Code Local Development}"
readonly android_keystore="$HOME/Library/Application Support/T3 Code Custom Android/release.p12"
readonly android_keystore_password_item="T3 Code Custom Android signing"
readonly android_certificate_sha256="c4dec69aca9c6c1da72b2bf83d506222359bf69067ca34dec29c88603ab0df20"
# Optional: google-services.json turns on agent notifications, and expo.env
# (EXPO_TOKEN and T3CODE_EXPO_PROJECT_ID) turns on over-the-air updates.
readonly google_services_file="$builder_home/google-services.json"
readonly expo_env_file="$builder_home/expo.env"
readonly built_root="$builder_home/built"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repo_root
readonly script_path="$repo_root/scripts/custom-nightly-mac-builder.sh"

log() {
  printf '[d3code-builder] %s\n' "$*"
}

notify() {
  osascript -e "display notification \"$1\" with title \"D3 Code builder\"" || true
}

install_agent() {
  mkdir -p "$builder_home" "$(dirname "$launch_agent_path")"
  cat > "$launch_agent_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$script_path</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$builder_home/builder.log</string>
  <key>StandardErrorPath</key>
  <string>$builder_home/builder.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$launch_agent_path"
  log "Installed $label. Log: $builder_home/builder.log"
}

uninstall_agent() {
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$launch_agent_path"
  log "Removed $label. $builder_home, with this clone, its toolchains, and its config, remains."
}

# Node.js and Vite+ at the versions the checked-out commit pins, kept apart from
# any Node.js manager so a release builds with what CI would have used.
use_toolchain() {
  local node_version vite_plus_version node_dir
  node_version="$(jq -r .engines.node "$repo_root/package.json")"
  vite_plus_version="$(sed -nE 's/^  vite-plus: ([0-9][^ ]*)$/\1/p' "$repo_root/pnpm-workspace.yaml")"
  node_dir="$builder_home/node/$node_version"
  if [[ ! -x "$node_dir/bin/node" ]]; then
    local download="$builder_home/node-download"
    local name="node-v$node_version-darwin-arm64"
    rm -rf "$download" && mkdir -p "$download"
    curl -fsSL "https://nodejs.org/dist/v$node_version/$name.tar.gz" -o "$download/$name.tar.gz"
    curl -fsSL "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$download/SHASUMS256.txt"
    (cd "$download" && grep " $name.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c -)
    mkdir -p "$node_dir"
    tar -xzf "$download/$name.tar.gz" -C "$node_dir" --strip-components=1
    rm -rf "$download"
  fi
  export PATH="$node_dir/bin:$HOME/.cargo/bin:$PATH"
  if [[ "$(vp --version 2>/dev/null | sed -nE 's/^vp v([^ ]+).*/\1/p' | head -1)" != "$vite_plus_version" ]]; then
    npm install --global "vite-plus@$vite_plus_version"
  fi
  rustup toolchain install stable --profile minimal --target aarch64-apple-darwin
}

load_connect_config() {
  local key
  for key in T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_CLERK_CLI_OAUTH_CLIENT_ID T3CODE_RELAY_URL; do
    export "$key=$(sed -n "s/^$key=//p" .env.example)"
  done
}

build_mac() {
  local tag="$1" version="${1#v}"
  cd "$repo_root"
  use_toolchain
  vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/desktop... --filter=@t3tools/scripts...
  load_connect_config
  node scripts/update-release-package-versions.ts "$version"
  rm -rf release
  CSC_NAME="$signing_identity" \
    T3CODE_DESKTOP_UPDATE_REPOSITORY="$repository" \
    T3CODE_MACOS_PASSKEY_SIGNING=false \
    env -u GH_TOKEN -u GITHUB_TOKEN \
    vp run dist:desktop:dmg:arm64 --build-version "$version" --signed --verbose

  local archives=(release/*-arm64.zip)
  [[ ${#archives[@]} -eq 1 && -f release/nightly-mac.yml && -f "${archives[0]}.blockmap" ]]
  local archive_name verification_dir app_bundle
  archive_name="$(basename "${archives[0]}")"
  (cd release && shasum -a 256 "$archive_name" > "$archive_name.sha256")
  verification_dir="$(mktemp -d)"
  ditto -x -k "release/$archive_name" "$verification_dir"
  app_bundle="$(find "$verification_dir" -maxdepth 2 -type d -name '*.app' -print -quit)"
  codesign --verify --deep --strict --verbose=2 "$app_bundle"
  codesign -d --verbose=4 "$app_bundle" 2>&1 | grep -F "Authority=$signing_identity"
  grep -F "repo: ${repository#*/}" "$app_bundle/Contents/Resources/app-update.yml"
  rm -rf "$verification_dir"

  stage_build "$tag" mac release/*.dmg release/*.zip release/*.blockmap release/nightly-mac.yml release/*.zip.sha256
}

build_android() {
  local tag="$1" version="${1#v}"
  cd "$repo_root"
  use_toolchain
  vp install --filter=@t3tools/mobile... --filter=@t3tools/scripts...

  # Minutes since the epoch keep version codes increasing across builds.
  local version_code=$(($(date -u +%s) / 60))
  local apk="$builder_home/T3-Code-$version-android-arm64.apk"
  JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  ANDROID_HOME="$HOME/Library/Android/sdk"
  T3CODE_ANDROID_KEYSTORE="$android_keystore"
  T3CODE_ANDROID_KEYSTORE_PASSWORD="$(security find-generic-password -s "$android_keystore_password_item" -w)"
  export JAVA_HOME ANDROID_HOME T3CODE_ANDROID_KEYSTORE T3CODE_ANDROID_KEYSTORE_PASSWORD
  if [[ -f "$google_services_file" ]]; then
    export T3CODE_ANDROID_GOOGLE_SERVICES_FILE="$google_services_file"
  fi
  if [[ -f "$expo_env_file" ]]; then
    set -a && source "$expo_env_file" && set +a
  fi
  rm -f "$apk"
  scripts/build-custom-android-apk.sh "$version" "$version_code" "$apk"

  local build_tools
  build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
  "$build_tools/aapt2" dump badging "$apk" \
    | grep -F "package: name='com.t3tools.t3code.preview' versionCode='$version_code'"
  "$build_tools/apksigner" verify --print-certs "$apk" \
    | grep -F "certificate SHA-256 digest: $android_certificate_sha256"

  local runtime_version=""
  if [[ -n "${EXPO_TOKEN:-}" && -n "${T3CODE_EXPO_PROJECT_ID:-}" ]]; then
    npm install --global eas-cli
    runtime_version="$(scripts/publish-custom-android-update.sh "$version" "$version_code" "$apk" "D3 Code $version")" ||
      log "Over-the-air publish failed; phones are offered the APK instead."
  fi

  local markers="$builder_home/release-notes-markers"
  printf '<!-- android-version-code: %s -->\n' "$version_code" > "$markers"
  # Phones on this runtime take the release over the air, so the app skips its APK.
  if [[ -n "$runtime_version" ]]; then
    printf '<!-- android-runtime-version: %s -->\n' "$runtime_version" >> "$markers"
  fi
  stage_build "$tag" android "$apk" "$markers"
}

# Keeps a verified build until its upload succeeds, so a failed upload retries
# without rebuilding. The folder appears whole or not at all.
stage_build() {
  local tag="$1" platform="$2"
  shift 2
  local staging
  mkdir -p "$built_root/$tag"
  staging="$(mktemp -d "$built_root/$tag/.staging.XXXXXX")"
  mv "$@" "$staging"
  rm -rf "${built_root:?}/$tag/$platform"
  mv "$staging" "$built_root/$tag/$platform"
}

upload_mac() {
  local tag="$1"
  gh release upload "$tag" "$built_root/$tag/mac"/* --repo "$repository" --clobber
}

# Runs inside an `if`, where `set -e` is off, so every step checks its own
# failure. The app only offers releases whose notes carry these markers next to
# an uploaded APK. The APK goes last because its presence marks the release built.
upload_android() {
  local tag="$1" built="$built_root/$1/android"
  local notes_file="$builder_home/release-notes.md"
  gh release view "$tag" --repo "$repository" --json body --jq .body > "$notes_file" || return
  if ! grep -qF "$(head -1 "$built/release-notes-markers")" "$notes_file"; then
    { printf '\n' && cat "$built/release-notes-markers"; } >> "$notes_file" || return
    gh release edit "$tag" --repo "$repository" --notes-file "$notes_file" || return
  fi
  gh release upload "$tag" "$built"/*.apk --repo "$repository" --clobber
}

# Prints the tag, commit, and missing platforms of the newest custom nightly.
newest_release() {
  gh api "repos/${repository}/releases?per_page=30" --jq '
    [.[] | select(.draft == false and ((.body // "") | contains("<!-- custom-commit:")))][0]
    | select(. != null)
    | [
        .tag_name,
        (.body | capture("<!-- custom-commit: (?<c>[^ ]+) -->").c),
        (if any(.assets[]; .name == "nightly-mac.yml") then "" else "mac" end),
        (if any(.assets[]; .name | endswith(".apk")) then "" else "android" end)
      ]
    | @tsv'
}

run_builds() {
  mkdir -p "$built_root"
  if ! GH_TOKEN="$(gh auth token --user "$github_account")"; then
    notify "gh has no login for $github_account. Run gh auth login."
    return 1
  fi
  export GH_TOKEN

  local tag commit missing_mac missing_android
  IFS=$'\t' read -r tag commit missing_mac missing_android < <(newest_release) || true
  if [[ -z "${tag:-}" ]]; then
    log "No custom nightly release was found."
    return
  fi
  find "$built_root" -mindepth 1 -maxdepth 1 ! -name "$tag" -exec rm -rf {} +

  if [[ -z "$missing_mac$missing_android" ]]; then
    log "$tag has every build."
    return
  fi

  local platform failed=false
  for platform in $missing_mac $missing_android; do
    local built="$built_root/$tag/$platform"
    local failed_marker="$builder_home/failed-$platform"
    if [[ ! -d "$built" ]]; then
      if [[ "$(cat "$failed_marker" 2>/dev/null)" == "$tag" ]]; then
        log "The $platform build of $tag already failed; waiting for a newer release."
        continue
      fi
      cd "$repo_root"
      git fetch --quiet --no-tags --depth=1 origin "$commit"
      git checkout --quiet --force --detach "$commit"
      git reset --quiet --hard
      git clean --quiet -fd
      log "Building $platform for $tag."
      # A separate process, because bash ignores `set -e` inside an `if` condition.
      if ! bash "$script_path" "--build-$platform" "$tag"; then
        git -C "$repo_root" reset --quiet --hard
        echo "$tag" > "$failed_marker"
        notify "The $platform build of $tag failed. See $builder_home/builder.log."
        failed=true
        continue
      fi
      git -C "$repo_root" reset --quiet --hard
      rm -f "$failed_marker"
    fi
    # In this process: the checkout above replaced this file with the release's copy.
    if "upload_$platform" "$tag"; then
      rm -rf "$built"
      log "Attached the $platform build to $tag."
    else
      log "Uploading the $platform build of $tag failed; retrying next run."
      if [[ ! -e "$built/.upload-failure-notified" ]]; then
        touch "$built/.upload-failure-notified"
        notify "Uploading the $platform build of $tag failed; it retries every 15 minutes. See $builder_home/builder.log."
      fi
      failed=true
    fi
  done
  [[ "$failed" == false ]]
}

main() {
  case "${1:-}" in
    --install) install_agent ;;
    --uninstall) uninstall_agent ;;
    --build-mac) build_mac "$2" ;;
    --build-android) build_android "$2" ;;
    *) run_builds ;;
  esac
}

# Each run checks out a new copy of this file, so bash must not read past this line.
main "$@"; exit

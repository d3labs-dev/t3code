#!/bin/bash

set -euo pipefail

readonly repository="${T3CODE_CUSTOM_REPOSITORY:-d3labs-dev/t3code}"
readonly signing_identity="${T3CODE_LOCAL_SIGNING_IDENTITY:-T3 Code Local Development}"
readonly app_path="${T3CODE_CUSTOM_APP_PATH:-$HOME/Applications/D3 Code.app}"
readonly updater_home="${T3CODE_CUSTOM_UPDATER_HOME:-$HOME/Library/Application Support/D3 Code Updater}"
readonly installed_script="$updater_home/update.sh"
readonly launch_agent_path="${T3CODE_CUSTOM_LAUNCH_AGENT_PATH:-$HOME/Library/LaunchAgents/com.diegojohnson.d3code.updater.plist}"
readonly launch_agent_label="com.diegojohnson.d3code.updater"

log() {
  printf '[d3code-updater] %s\n' "$*"
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This updater only supports macOS." >&2
    exit 1
  fi
}

resolve_gh() {
  local candidate
  for candidate in "${T3CODE_GH_BIN:-}" /opt/homebrew/bin/gh /usr/local/bin/gh /usr/bin/gh; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  echo "GitHub CLI is required. Install it with: brew install gh" >&2
  exit 1
}

signing_identity_exists() {
  security find-identity -v -p codesigning \
    | grep -F "\"$signing_identity\"" \
    >/dev/null
}

create_signing_identity() (
  if signing_identity_exists; then
    log "Using signing identity: $signing_identity"
    return
  fi

  local temporary_directory
  local keychain_path
  local export_password
  temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/t3code-signing.XXXXXX")"
  keychain_path="$HOME/Library/Keychains/login.keychain-db"
  export_password="$(/usr/bin/openssl rand -hex 24)"

  cleanup_signing_files() {
    rm -rf "$temporary_directory"
  }
  trap cleanup_signing_files EXIT

  cat > "$temporary_directory/openssl.cnf" <<EOF
[req]
distinguished_name = subject
x509_extensions = extensions
prompt = no

[subject]
CN = $signing_identity

[extensions]
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyCertSign
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

  /usr/bin/openssl req \
    -x509 \
    -newkey rsa:2048 \
    -sha256 \
    -nodes \
    -days 3650 \
    -config "$temporary_directory/openssl.cnf" \
    -keyout "$temporary_directory/key.pem" \
    -out "$temporary_directory/certificate.pem"
  /usr/bin/openssl pkcs12 \
    -export \
    -name "$signing_identity" \
    -inkey "$temporary_directory/key.pem" \
    -in "$temporary_directory/certificate.pem" \
    -out "$temporary_directory/identity.p12" \
    -passout "pass:$export_password"

  security import "$temporary_directory/identity.p12" \
    -k "$keychain_path" \
    -P "$export_password" \
    -T /usr/bin/codesign
  security add-trusted-cert \
    -r trustRoot \
    -p codeSign \
    -k "$keychain_path" \
    "$temporary_directory/certificate.pem"

  if ! signing_identity_exists; then
    echo "The local signing identity was created but macOS does not consider it valid." >&2
    exit 1
  fi

  log "Created local signing identity: $signing_identity"
)

latest_release_tag() {
  local gh_bin
  gh_bin="$(resolve_gh)"
  "$gh_bin" api "repos/$repository/releases?per_page=30" \
    --jq '[.[] | select(.draft == false and .prerelease == true and ((.body // "") | contains("<!-- upstream-release:")))][0].tag_name // ""'
}

installed_version() {
  local info_plist="$app_path/Contents/Info.plist"
  if [[ ! -f "$info_plist" ]]; then
    return
  fi
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist" 2>/dev/null || true
}

builtin_updater_is_configured() {
  [[ -f "$app_path/Contents/Resources/app-update.yml" ]]
}

app_is_running() {
  osascript -e 'application id "com.diegojohnson.d3code" is running' 2>/dev/null \
    | grep -qx 'true'
}

quit_app() {
  local attempt
  if ! app_is_running; then
    return
  fi

  osascript -e 'tell application id "com.diegojohnson.d3code" to quit' >/dev/null
  for attempt in {1..20}; do
    if ! app_is_running; then
      return
    fi
    sleep 0.5
  done

  echo "D3 Code did not quit. Close it and run the updater again." >&2
  exit 1
}

write_entitlements() {
  local destination="$1"
  cat > "$destination" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
  </dict>
</plist>
EOF
}

sign_app() {
  local target_app="$1"
  local entitlements_path="$2"
  codesign \
    --force \
    --deep \
    --options runtime \
    --timestamp=none \
    --entitlements "$entitlements_path" \
    --sign "$signing_identity" \
    "$target_app"
  codesign --verify --deep --strict --verbose=2 "$target_app"
}

install_app() {
  local staged_app="$1"
  local temporary_directory="$2"
  local allow_restart="$3"
  local previous_app="$temporary_directory/previous.app"
  local was_running=false

  if app_is_running; then
    if [[ "$allow_restart" != "true" ]]; then
      return 3
    fi
    was_running=true
  fi
  quit_app
  mkdir -p "$(dirname "$app_path")"

  if [[ -d "$app_path" ]]; then
    mv "$app_path" "$previous_app"
  fi

  if ! mv "$staged_app" "$app_path"; then
    if [[ -d "$previous_app" ]]; then
      mv "$previous_app" "$app_path"
    fi
    echo "Could not install the custom nightly application." >&2
    exit 1
  fi

  if [[ "$was_running" == "true" ]]; then
    open "$app_path"
  fi
}

update_app() (
  local allow_restart="${1:-false}"
  local gh_bin
  local release_tag
  local release_version
  local current_version
  local asset_name
  local checksum_name
  local temporary_directory
  local staged_directory
  local staged_app

  if builtin_updater_is_configured; then
    log "The built-in updater is configured; use Check for updates in D3 Code."
    return
  fi

  create_signing_identity
  gh_bin="$(resolve_gh)"
  release_tag="$(latest_release_tag)"
  if [[ -z "$release_tag" ]]; then
    log "No custom nightly release is available yet."
    return
  fi

  release_version="${release_tag#v}"
  current_version="$(installed_version)"
  if [[ "$current_version" == "$release_version" ]]; then
    log "Already running $release_version."
    return
  fi
  if [[ "$allow_restart" != "true" ]] && app_is_running; then
    log "D3 Code is running; the update will retry after it closes."
    return
  fi

  asset_name="$(
    "$gh_bin" release view "$release_tag" \
      --repo "$repository" \
      --json assets \
      --jq '[.assets[].name | select(endswith("-arm64.zip"))][0] // ""'
  )"
  if [[ -z "$asset_name" ]]; then
    echo "Release $release_tag has no macOS arm64 zip." >&2
    exit 1
  fi
  checksum_name="$asset_name.sha256"

  temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/t3code-update.XXXXXX")"
  cleanup_update_files() {
    rm -rf "$temporary_directory"
  }
  trap cleanup_update_files EXIT

  "$gh_bin" release download "$release_tag" \
    --repo "$repository" \
    --pattern "$asset_name" \
    --pattern "$checksum_name" \
    --dir "$temporary_directory"
  (
    cd "$temporary_directory"
    shasum -a 256 -c "$checksum_name"
  )

  staged_directory="$temporary_directory/staged"
  mkdir -p "$staged_directory"
  ditto -x -k "$temporary_directory/$asset_name" "$staged_directory"
  staged_app="$(find "$staged_directory" -maxdepth 2 -type d -name '*.app' -print -quit)"
  if [[ -z "$staged_app" ]]; then
    echo "The downloaded archive contains no application bundle." >&2
    exit 1
  fi

  write_entitlements "$temporary_directory/entitlements.plist"
  sign_app "$staged_app" "$temporary_directory/entitlements.plist"
  local install_status=0
  install_app "$staged_app" "$temporary_directory" "$allow_restart" || install_status=$?
  if [[ "$install_status" -ne 0 ]]; then
    if [[ "$install_status" -eq 3 ]]; then
      log "D3 Code started during the update; the update will retry after it closes."
      return
    fi
    return "$install_status"
  fi
  log "Installed $release_version at $app_path"
)

write_launch_agent() {
  mkdir -p "$(dirname "$launch_agent_path")"
  cat > "$launch_agent_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$launch_agent_label</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>$installed_script</string>
      <string>update</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>StandardOutPath</key>
    <string>$updater_home/update.log</string>
    <key>StandardErrorPath</key>
    <string>$updater_home/update-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
  </dict>
</plist>
EOF
  plutil -lint "$launch_agent_path" >/dev/null
}

install_updater() {
  create_signing_identity
  mkdir -p "$updater_home"
  cp "$0" "$installed_script"
  chmod 755 "$installed_script"
  write_launch_agent

  launchctl bootout "gui/$(id -u)/$launch_agent_label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$launch_agent_path"
  launchctl kickstart -k "gui/$(id -u)/$launch_agent_label"
  log "Installed the hourly updater."
  log "Application: $app_path"
  log "Logs: $updater_home"
}

uninstall_updater() {
  launchctl bootout "gui/$(id -u)/$launch_agent_label" 2>/dev/null || true
  rm -f "$launch_agent_path"
  rm -rf "$updater_home"
  log "Removed the updater. The application and signing identity were kept."
}

show_status() {
  local release_tag
  release_tag="$(latest_release_tag)"
  printf 'Repository:       %s\n' "$repository"
  printf 'Signing identity: %s\n' "$signing_identity"
  printf 'Application:      %s\n' "$app_path"
  printf 'Installed:        %s\n' "$(installed_version)"
  printf 'Available:        %s\n' "${release_tag#v}"
}

main() {
  require_macos
  case "${1:-}" in
    install)
      install_updater
      ;;
    update)
      update_app
      ;;
    update-now)
      update_app true
      ;;
    status)
      show_status
      ;;
    uninstall)
      uninstall_updater
      ;;
    *)
      echo "Usage: $0 {install|update|update-now|status|uninstall}" >&2
      exit 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

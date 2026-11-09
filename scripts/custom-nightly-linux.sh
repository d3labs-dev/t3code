#!/bin/bash
# Publishes the fork's custom nightly from this machine: merges upstream's
# latest nightly into the customization branch, builds the Linux x64 CLI
# archive that `t3` servers update from, and attaches it to a new release.
# Runs from a dedicated worktree, which it resets on every run, so never point
# it at a checkout you work in. Install the timer with `--install`; remove it
# with `--uninstall`.

set -euo pipefail

readonly repository="d3labs-dev/t3code"
readonly upstream_repository="pingdotgg/t3code"
readonly branch="custom-nightly"
readonly state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/d3code-nightly"
readonly unit_name="d3code-nightly"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repo_root

log() {
  printf '[d3code-nightly] %s\n' "$*"
}

install_timer() {
  local unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$unit_dir"
  cat > "$unit_dir/$unit_name.service" <<EOF
[Unit]
Description=Publish the D3 Code custom nightly

[Service]
Type=oneshot
Nice=10
ExecStart=/bin/bash $repo_root/scripts/custom-nightly-linux.sh
EOF
  # One build a day takes the newest upstream nightly. Persistent catches up
  # at boot when the machine was off at 9:00.
  cat > "$unit_dir/$unit_name.timer" <<EOF
[Unit]
Description=Publish the D3 Code custom nightly daily at 9:00 Peru time

[Timer]
OnCalendar=*-*-* 09:00:00 America/Lima
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$unit_name.timer"
  log "Installed $unit_name.timer. Logs: journalctl --user -u $unit_name"
}

uninstall_timer() {
  local unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  systemctl --user disable --now "$unit_name.timer" 2>/dev/null || true
  rm -f "$unit_dir/$unit_name.service" "$unit_dir/$unit_name.timer"
  systemctl --user daemon-reload
  log "Removed $unit_name.timer. The worktree, $state_dir, and the d3code-nightly-builder Docker image remain."
}

latest_upstream_nightly() {
  gh api "repos/${upstream_repository}/releases?per_page=30" \
    --jq '[.[] | select(.draft == false and .prerelease == true and (.tag_name | contains("-nightly.")))][0].tag_name // ""'
}

latest_published_body() {
  gh api "repos/${repository}/releases?per_page=30" \
    --jq '[.[] | select(.draft == false and .prerelease == true and ((.body // "") | contains("<!-- upstream-release:")))][0].body // ""'
}

marker() {
  sed -n "s/.*<!-- $1: \([^ ]*\) -->.*/\1/p" <<< "$2"
}

build_cli_archive() {
  local version="$1" output_dir="$2"
  local work_dir="$state_dir/work"
  rm -rf "$work_dir"
  mkdir -p "$work_dir/cli-resource-monitor/linux-x64" "$output_dir"

  vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/desktop... --filter=@t3tools/scripts...
  node scripts/update-release-package-versions.ts "$version"

  local key
  for key in T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_CLERK_CLI_OAUTH_CLIENT_ID T3CODE_RELAY_URL; do
    export "$key=$(sed -n "s/^$key=//p" .env.example)"
  done
  export T3CODE_TELEMETRY_CHANNEL=dev

  vp run build:desktop
  cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target x86_64-unknown-linux-gnu
  cp native/resource-monitor/target/x86_64-unknown-linux-gnu/release/t3-resource-monitor "$work_dir/cli-resource-monitor/linux-x64/"
  node apps/server/scripts/cli.ts build-exe --verbose
  node scripts/build-cli-archive.ts \
    --platform linux \
    --arch x64 \
    --version "$version" \
    --resource-monitor-dir "$work_dir/cli-resource-monitor" \
    --output-dir "$output_dir"
  node scripts/smoke-cli-archive.ts --archive "$output_dir"/t3-*.tar.gz --expect-version "$version"
  (cd "$output_dir" && sha256sum t3-*.tar.gz > SHA256SUMS)
}

# The container sees the worktree, its git directory, and the state directory at
# their host paths, and runs as this user so every file it writes stays ours.
build_in_container() {
  local version="$1" output_dir="$2"
  local image="d3code-nightly-builder"
  local git_common_dir
  git_common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)"
  mkdir -p "$state_dir/home"
  docker build --quiet --tag "$image" \
    --build-arg "NODE_VERSION=$(jq -r .engines.node "$repo_root/package.json")" \
    --build-arg "VITE_PLUS_VERSION=$(sed -nE 's/^  vite-plus: ([0-9][^ ]*)$/\1/p' "$repo_root/pnpm-workspace.yaml")" \
    --file "$repo_root/scripts/custom-nightly-linux.Dockerfile" "$repo_root/scripts"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --env HOME="$state_dir/home" \
    --volume "$repo_root:$repo_root" \
    --volume "$git_common_dir:$git_common_dir:ro" \
    --volume "$state_dir:$state_dir" \
    --workdir "$repo_root" \
    "$image" \
    bash scripts/custom-nightly-linux.sh --build-cli-archive "$version" "$output_dir"
}

# Draft first so servers, which take the newest published nightly, never see
# the release before its archive is attached.
publish_release() {
  local version="$1" upstream_tag="$2" commit="$3" upstream_changes="$4" assets_dir="$5"
  local notes_file="$state_dir/release-notes.md"
  cat > "$notes_file" <<EOF
Automated custom build of T3 Code for Linux x64. The macOS app and Android APK are attached once the Mac builder finishes them.

Upstream release: \`${upstream_tag}\`

<!-- upstream-release: ${upstream_tag} -->
<!-- custom-commit: ${commit} -->
EOF
  # The update popover shows a release's last eight list items, so upstream's changes go last.
  if [[ -n "$upstream_changes" ]]; then
    printf '\n## Upstream changes\n\n%s\n' "$upstream_changes" >> "$notes_file"
  fi
  gh release create "v$version" "$assets_dir"/t3-*.tar.gz "$assets_dir/SHA256SUMS" \
    --repo "$repository" \
    --target "$commit" \
    --title "D3 Code $version" \
    --notes-file "$notes_file" \
    --prerelease \
    --draft
  gh release edit "v$version" --repo "$repository" --draft=false
}

publish_nightly() {
  mkdir -p "$state_dir"
  local log_file="$state_dir/last-run.log"
  exec > >(tee "$log_file") 2>&1

  cd "$repo_root"
  source scripts/lib/custom-nightly-jobs.sh

  git fetch --no-tags origin "$branch"
  git checkout --quiet --detach "origin/$branch"
  git reset --quiet --hard
  git clean --quiet -fd

  local upstream_tag
  upstream_tag="$(latest_upstream_nightly)"
  if [[ -z "$upstream_tag" ]]; then
    log "No upstream nightly release was found."
    return 1
  fi
  git fetch --no-tags "https://github.com/${upstream_repository}.git" "refs/tags/${upstream_tag}:refs/tags/${upstream_tag}"

  local published_body published_upstream_tag published_commit
  published_body="$(latest_published_body)"
  published_upstream_tag="$(marker upstream-release "$published_body")"
  published_commit="$(marker custom-commit "$published_body")"
  if [[ "$published_upstream_tag" == "$upstream_tag" && "$published_commit" == "$(git rev-parse HEAD)" ]]; then
    log "${upstream_tag} on $(git rev-parse --short HEAD) is already published."
    return
  fi

  if ! git merge-base --is-ancestor "$upstream_tag" HEAD; then
    if ! git -c user.name="t3code-custom-nightly[bot]" -c user.email="t3code-custom-nightly[bot]@users.noreply.github.com" \
      merge --quiet --no-edit "$upstream_tag"; then
      local conflicted_files
      conflicted_files="$(git diff --name-only --diff-filter=U | sed 's/.*/- `&`/')"
      git merge --abort
      file_job_issue "$upstream_tag" "$(printf 'Merging it stopped on conflicts in:\n\n%s' "${conflicted_files:-See the run log.}")"
      log "Merging ${upstream_tag} conflicts with ${branch}."
      return 1
    fi
    git push origin "HEAD:${branch}"
  fi
  close_job_work "$upstream_tag" "Superseded: ${branch} already includes ${upstream_tag} as of $(git rev-parse --short HEAD)."

  local commit
  commit="$(git rev-parse HEAD)"
  # A build that failed retries only once the upstream tag or the branch moves.
  local failed_marker="$state_dir/failed-build"
  if [[ "$(cat "$failed_marker" 2>/dev/null)" == "$upstream_tag $commit" ]]; then
    log "The build of ${upstream_tag} on ${commit} already failed; waiting for a new commit."
    return
  fi

  local package_version stable_version major minor patch version
  package_version="$(jq -r .version apps/desktop/package.json)"
  stable_version="${package_version%%-*}"
  IFS=. read -r major minor patch <<< "$stable_version"
  version="${major}.${minor}.$((patch + 1))-nightly.$(date -u +%Y%m%d).$((10#$(date -u +%H%M)))"

  local upstream_changes=""
  if [[ -n "$published_upstream_tag" && "$published_upstream_tag" != "$upstream_tag" ]]; then
    git fetch --no-tags "https://github.com/${upstream_repository}.git" "refs/tags/${published_upstream_tag}:refs/tags/${published_upstream_tag}"
    upstream_changes="$(git log --reverse --first-parent --format='- %s' "${published_upstream_tag}..${upstream_tag}")"
  fi

  log "Building ${version} from ${upstream_tag} on ${commit}."
  local assets_dir="$state_dir/release"
  rm -rf "$assets_dir"
  # A separate process, because bash ignores `set -e` inside an `if` condition.
  if ! bash "$repo_root/scripts/custom-nightly-linux.sh" --build-in-container "$version" "$assets_dir"; then
    echo "$upstream_tag $commit" > "$failed_marker"
    file_job_issue "$upstream_tag" "$(printf 'The local build of `%s` failed:\n\n```text\n%s\n```\n' "$commit" "$(tail -n 60 "$log_file" | tail -c 6000)")"
    git reset --quiet --hard
    return 1
  fi
  git reset --quiet --hard

  publish_release "$version" "$upstream_tag" "$commit" "$upstream_changes" "$assets_dir"
  rm -f "$failed_marker"
  close_job_work "" "Published in v${version}."
  log "Published v${version}."
}

main() {
  case "${1:-}" in
    --install) install_timer ;;
    --uninstall) uninstall_timer ;;
    --build-in-container) build_in_container "$2" "$3" ;;
    --build-cli-archive) cd "$repo_root" && build_cli_archive "$2" "$3" ;;
    *) publish_nightly ;;
  esac
}

# Each run checks out a new copy of this file, so bash must not read past this line.
main "$@"; exit

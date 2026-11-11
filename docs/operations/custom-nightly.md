# Custom nightly builds

This fork follows released T3 Code nightlies from upstream `main` and publishes them as D3 Code releases. `t3` servers update from the Linux x64 CLI archive in each release.

GitHub Actions is off for the fork because its builds used up the free plan's minutes, so two machines publish releases instead (see [Publish a build](#publish-a-build)): a Linux machine creates each release with the Linux CLI archive, and a Mac attaches the macOS app and Android APK when it next runs. Windows builds are not published.

Chamaquita merges upstream's nightlies into `custom-nightly`, and the Linux builder publishes whatever the branch holds. Every morning from 06:00 to 08:00 Peru time she checks upstream hourly; when its newest nightly is not an ancestor of `custom-nightly`, she files `Upstream nightly <tag>: make it merge and build on custom-nightly`, merges the tag on `chamaquita/upstream-<tag>`, runs `vp install`, `vp run typecheck`, `vp run build:desktop` and the tests beside what she resolved, and merges her pull request herself, since the fork has no CI. Her Job may push `.github/workflows/` changes. A newer tag supersedes an older tag's issue and pull request once that Job stops working. To merge a tag yourself, merge it and push to `custom-nightly`; her next check closes the issue.

## Keep customizations out of upstream files

Conflicts come from fork edits inside lines upstream also changes. Upstream rewrites class strings, stylesheets, and shared components often, so fork changes live in files upstream never touches:

- **Styling** goes in `apps/web/src/custom.css`, which `index.css` imports last. Repeat an upstream selector there to change it, rather than editing `index.css` or a component's `className`.
- **Components** go in their own files, and an upstream file gets only the import and one element, like `SidebarFooterExtras` in `SidebarChrome.tsx`.
- **Upstream UI primitives** are used only through what they export. Internal helpers such as a `cva` variants function can disappear in any nightly, which breaks the build without a merge conflict.

## Install the Mac updater

Install and authenticate GitHub CLI, then run:

```bash
./scripts/custom-nightly-macos.sh install
```

The first run creates a self-signed `T3 Code Local Development` code-signing identity. macOS may ask for permission to update the login keychain. Every build must be signed with this identity so updates keep the same signature.

The bootstrap updater checks hourly and installs the app at:

```text
~/Applications/D3 Code.app
```

It keeps the existing T3 Code data under `~/.t3/userdata` and the existing desktop data directory. The custom application does not support passkeys because its local certificate has no Apple provisioning profile. Other T3 Connect sign-in methods use the public production configuration in `.env.example`.

Once a build with `app-update.yml` is installed, the bootstrap updater becomes idle. D3 Code then downloads each later release in the background as soon as it finds one; restart from its update control to install.

Inspect or run the bootstrap updater manually:

```bash
./scripts/custom-nightly-macos.sh status
./scripts/custom-nightly-macos.sh update
```

Bootstrap checks defer while D3 Code is running. To install the first feed-enabled build immediately, quit and reopen the app as part of the update:

```bash
./scripts/custom-nightly-macos.sh update-now
```

Remove the hourly job without deleting the application, data, or signing identity:

```bash
./scripts/custom-nightly-macos.sh uninstall
```

## Android app

Install the `-android-arm64.apk` from a release. It installs as `com.t3tools.t3code.preview` under the name D3 Code, next to the Play Store app and local development builds. Its Clerk sign-in callback is already allowlisted, so T3 Connect works. It never takes upstream's over-the-air updates.

The app checks the fork's releases at launch and after 15 minutes in the background, and offers newer APKs. **Settings > About > Check for updates** checks on demand. Android asks to confirm every install; the first update also asks to allow D3 Code to install unknown apps.

### Over-the-air updates

Once the fork's Expo project is configured (see Agent notifications below), each Android build can also publish its JavaScript to the project's `custom-nightly` channel. A phone whose installed APK has the same native code downloads it at launch and switches to it the next time the app goes to the background, with no install prompt. The release notes then carry an `android-runtime-version` marker, and the app skips offering that release's APK to phones on that runtime. A build that changes native code has a new runtime, so phones are offered its APK as before.

The Expo project's slug must be `t3-code`, the slug in `app.config.ts`, or `eas update` refuses to publish. The runtime fingerprint leaves out the version name and code (`apps/mobile/fingerprint.config.js`), which change on every build. A failed publish does not block the release: it ships without the marker, so phones are offered the APK.

### Agent notifications

The APK cannot use T3 Connect's relay for notifications, so each T3 Code server the phone connects to pushes them itself through Expo's push service: questions and approvals waiting on you, finished and failed work, and the ongoing activity card. The phone registers with every server it connects to, and a server only notifies about its own threads. After that, pushes arrive while the app is closed, as long as the server is running and can reach `exp.host` on the internet. Removing a server in the app unregisters the phone only while that server is connected.

Notifications stay off until the build has both an Expo project and a Firebase app:

1. In Firebase, add an Android app for `com.t3tools.t3code.preview` and download its `google-services.json`.
2. Create a service account key with the Firebase Cloud Messaging API (V1) and upload it to the Expo project under **Credentials > Android > FCM V1 service account key**.
3. For a build, set `T3CODE_ANDROID_GOOGLE_SERVICES_FILE` to the JSON's path and `T3CODE_EXPO_PROJECT_ID`. Servers keep their registered phones in `server-push-devices.json` in their state directory.

### Signing key

Android only accepts an update signed with the same key as the installed app. Losing the key means reinstalling and losing the app's data, so back up the keystore at `~/Library/Application Support/T3 Code Custom Android/release.p12` and its password, stored in the login keychain as `T3 Code Custom Android signing`.

The key was created once with:

```bash
keytool -genkeypair -keystore release.p12 -storetype PKCS12 -alias t3code-custom \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=T3 Code Custom Android"
```

Replacing the key means reinstalling the app.

### Build locally

```bash
JAVA_HOME="$(/usr/libexec/java_home -v 17)" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
T3CODE_ANDROID_KEYSTORE="$HOME/Library/Application Support/T3 Code Custom Android/release.p12" \
T3CODE_ANDROID_KEYSTORE_PASSWORD="$(security find-generic-password -s 'T3 Code Custom Android signing' -w)" \
  scripts/build-custom-android-apk.sh <version-name> <version-code> T3-Code.apk
```

Android refuses to install a lower version code than the installed one. Releases use minutes since the Unix epoch, so keep local version codes below that. Set `T3CODE_ANDROID_UPDATE_RELEASES_URL` to point a test build at another GitHub-style releases feed.

## Publish a build

`scripts/custom-nightly-linux.sh` publishes from a Linux machine with Docker, `gh`, `git`, and `jq`. Daily at 9:00 Peru time, when `custom-nightly` has moved since the last release, it builds the Linux x64 CLI archive inside the Ubuntu 24.04 image in `scripts/custom-nightly-linux.Dockerfile`, because `scripts/build-cli-archive.ts` bundles Ubuntu's libatomic and its package metadata. It smoke-tests the archive and publishes it with `SHA256SUMS` as a prerelease. The release starts as a draft and is published only once its files are attached, because servers take the newest published nightly.

The script resets its worktree to `origin/custom-nightly` on every run, so give it a worktree of its own and install its timer from there:

```bash
git worktree add --detach ../t3code-nightly-builder origin/custom-nightly
../t3code-nightly-builder/scripts/custom-nightly-linux.sh --install
```

The timer runs as the `d3code-nightly` user service; if the machine is off at 9:00, it runs at the next boot. Watch it with `journalctl --user -u d3code-nightly`, and publish right away with `systemctl --user start d3code-nightly`. The last run's log and the build state live in `~/.local/state/d3code-nightly`. Both builders publish through the `DiegoJohnsonL` `gh` login whichever account is active, because work switches it to an account that cannot write to the fork. A failed build opens an issue assigned to that account and retries once the branch moves.

The two machines never talk to each other; the release is the handoff. The Linux machine publishes on its own schedule, and the Mac pulls whatever the newest release lacks. The Mac is a laptop that is often asleep or away, and its signing identity, keystore password, and `gh` token sit in the login keychain, which only the logged-in session can use, never an SSH session. Neither machine waits for the other, and Remote Login can stay off.

The Mac attaches its builds with `scripts/custom-nightly-mac-builder.sh`. Every 15 minutes and at login it finds the newest release missing the macOS app or the Android APK and, while the Mac is on AC power, checks out the commit the release records and builds what is missing: the app signed with `T3 Code Local Development`, and the APK signed with the release keystore and checked against its certificate fingerprint. It attaches them and adds the `android-version-code` marker the Android app looks for. Until the Mac runs, the Mac app's update check finds no `nightly-mac.yml` in the newest release, and phones keep their version. A failed build shows a notification and retries only for a newer release. A failed upload shows one notification and retries every run with the build it kept in `~/.local/share/d3code-builder/built`, on battery too.

The Mac script also resets its clone on every run, so give it a clone of its own. A shallow one without the vendored `.repos/` is enough:

```bash
repo=~/.local/share/d3code-builder/repo
git init "$repo" && cd "$repo"
git remote add origin https://github.com/d3labs-dev/t3code.git
git sparse-checkout set --no-cone '/*' '!/.repos/'
git fetch --depth=1 origin custom-nightly && git checkout --detach FETCH_HEAD
scripts/custom-nightly-mac-builder.sh --install
```

It needs Xcode, Java 17, the Android SDK in `~/Library/Android/sdk`, rustup, `gh`, and the signing identity and keystore described above; it downloads the Node.js and Vite+ versions each commit pins. Agent notifications need the Firebase `google-services.json` at `~/.local/share/d3code-builder/google-services.json` and `T3CODE_EXPO_PROJECT_ID` in `~/.local/share/d3code-builder/expo.env`; adding `EXPO_TOKEN` there also publishes over-the-air updates. The log is `~/.local/share/d3code-builder/builder.log`.

To build right away, run the launch agent instead of the script: `launchctl kickstart -k gui/$(id -u)/com.diegojohnson.d3code.builder`. It still waits for AC power. Running `--build-mac` or `--build-android` directly over SSH fails, because signing needs the login keychain.

The agent runs the script from its clone, which stays at the commit of the last release it built. A change to the script reaches the Mac with the next release; to apply it sooner, move the clone to `origin/custom-nightly` with `git fetch --depth=1 origin custom-nightly && git checkout --force --detach FETCH_HEAD`. Releases from before the script existed cannot build this way.

### Remove the builders

Each machine keeps everything in a few places. To stop the Linux builder and delete what it made:

```bash
../t3code-nightly-builder/scripts/custom-nightly-linux.sh --uninstall   # ~/.config/systemd/user/d3code-nightly.{service,timer}
git worktree remove --force ../t3code-nightly-builder
rm -rf ~/.local/state/d3code-nightly                                   # logs, build output, pnpm and cargo caches
docker image rm d3code-nightly-builder
```

On the Mac:

```bash
~/.local/share/d3code-builder/repo/scripts/custom-nightly-mac-builder.sh --uninstall   # ~/Library/LaunchAgents/com.diegojohnson.d3code.builder.plist
rm -rf ~/.local/share/d3code-builder   # the clone, Node.js, Vite+, logs, google-services.json, expo.env
```

The Mac builder also installed rustup in `~/.rustup` and `~/.cargo`; remove them with `rustup self uninstall` if nothing else uses Rust. The signing identity and the Android keystore predate the builder and stay.

### Update a server to a release

The app's update button installs the newest release it found when it last checked. If it keeps offering an older one, install a release by version with the running server's own CLI, which restarts the background service:

```bash
~/.t3/runtime/versions/<active-version>/t3 update <version> --yes
```

`activeVersion` in `~/.t3/runtime/service-state.json` names the running version. `~/.local/bin/t3` can be an older CLI than the one running.

Pull requests into `custom-nightly` get no CI. Run `vp run typecheck` and `vp run build:desktop` before merging one.

# Custom nightly builds

This fork follows released T3 Code nightlies from upstream `main` and publishes them as D3 Code: a macOS arm64 build signed with a private development certificate, plus a signed Android APK. Both apps update from the fork's GitHub releases.

The automation merges upstream nightly tags into the fork's default branch and builds the result. When the tag does not merge, or the merged commit does not build, the workflow opens one issue for that tag, `Upstream nightly <tag>: make it merge and build on custom-nightly`, with the conflicted files or the failing build logs. The issue carries the `chamaquita` and `automerge` labels, so Chamaquita fixes it on `chamaquita/upstream-<tag>` and merges her pull request once Fork CI passes; the pull request closes the issue. To fix it yourself, merge the tag, fix, and push; the next release closes the issue. A newer tag supersedes an older tag's issue and pull request. The workflow retries the build until a release records the upstream tag it contains.

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

The first run creates a self-signed `T3 Code Local Development` code-signing identity. macOS may ask for permission to update the login keychain. GitHub Actions stores an encrypted PKCS#12 export of this identity so every update has the same signature.

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

While D3 Code runs, its Dock icon shows the cat in a mood that follows your threads: questions waiting on you or an unseen failure, agents at work (sweating when two or more run at once), finished work you have not opened, a big day, nothing new for half an hour or more, or everything settled. The pictures live in `apps/desktop/resources/mascot/`, and `packages/client-runtime/src/state/mascotMood.ts` picks one.

## Windows app

Install the `-x64.exe` from a release and accept the SmartScreen prompt; the installer is unsigned. Like the Mac app, it downloads later releases from the fork in the background and installs them on restart.

## Android app

Install the `-android-arm64.apk` from a release. It installs as `com.t3tools.t3code.preview` under the name D3 Code, next to the Play Store app and local development builds. Its Clerk sign-in callback is already allowlisted, so T3 Connect works. It never takes upstream's over-the-air updates.

Its launcher icon shows the same cat mood as the Mac Dock, counting a thread as seen once you open it on the phone. The icon changes only when you leave the app, and the launcher can take several seconds to redraw it.

The app checks the fork's releases at launch and after 15 minutes in the background, and offers newer APKs. **Settings > About > Check for updates** checks on demand. Android asks to confirm every install; the first update also asks to allow D3 Code to install unknown apps.

### Over-the-air updates

Once the fork's Expo project is configured (see Agent notifications below) and `EXPO_TOKEN` holds an Expo access token for its account, each build also publishes its JavaScript to the project's `custom-nightly` channel. A phone whose installed APK has the same native code downloads it at launch and switches to it the next time the app goes to the background, with no install prompt. The release notes then carry an `android-runtime-version` marker, and the app skips offering that release's APK to phones on that runtime. A build that changes native code has a new runtime, so phones are offered its APK as before.

```bash
gh secret set EXPO_TOKEN --body <expo-access-token>
```

The Expo project's slug must be `t3-code`, the slug in `app.config.ts`, or `eas update` refuses to publish. The runtime fingerprint leaves out the version name and code (`apps/mobile/fingerprint.config.js`), which change on every build. A failed publish does not block the release: it ships without the marker, so phones are offered the APK.

### Agent notifications

The APK cannot use T3 Connect's relay for notifications, so each T3 Code server the phone connects to pushes them itself through Expo's push service: questions and approvals waiting on you, finished and failed work, and the ongoing activity card. The phone registers with every server it connects to, and a server only notifies about its own threads. After that, pushes arrive while the app is closed, as long as the server is running and can reach `exp.host` on the internet. Removing a server in the app unregisters the phone only while that server is connected.

Notifications stay off until the build has both an Expo project and a Firebase app:

1. In Firebase, add an Android app for `com.t3tools.t3code.preview` and download its `google-services.json`.
2. Create a service account key with the Firebase Cloud Messaging API (V1) and upload it to the Expo project under **Credentials > Android > FCM V1 service account key**.
3. Give both to GitHub Actions:

   ```bash
   gh secret set CUSTOM_ANDROID_GOOGLE_SERVICES_JSON < google-services.json
   gh variable set T3CODE_EXPO_PROJECT_ID --body <expo-project-id>
   ```

For a local build, set `T3CODE_ANDROID_GOOGLE_SERVICES_FILE` to the JSON's path and `T3CODE_EXPO_PROJECT_ID`. Servers keep their registered phones in `server-push-devices.json` in their state directory.

### Signing key

Android only accepts an update signed with the same key as the installed app. Losing the key means reinstalling and losing the app's data, so back up the keystore at `~/Library/Application Support/T3 Code Custom Android/release.p12` and its password, stored in the login keychain as `T3 Code Custom Android signing`.

The key was created once with:

```bash
keytool -genkeypair -keystore release.p12 -storetype PKCS12 -alias t3code-custom \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=T3 Code Custom Android"
```

Give it to GitHub Actions:

```bash
base64 -i "$HOME/Library/Application Support/T3 Code Custom Android/release.p12" \
  | gh secret set CUSTOM_ANDROID_KEYSTORE
security find-generic-password -s "T3 Code Custom Android signing" -w \
  | gh secret set CUSTOM_ANDROID_KEYSTORE_PASSWORD
```

The workflow rejects an APK whose certificate does not match the key's SHA-256 fingerprint. Replacing the key means updating that fingerprint and reinstalling the app.

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

The `Custom nightly` GitHub Actions workflow checks for a new upstream nightly every 30 minutes and builds every push to `custom-nightly`. A push cancels the build in progress, so only the newest commit finishes; scheduled and manual runs wait for it instead. Its manual dispatch has a `force` input for rebuilding the current upstream nightly. Each release contains a DMG, a signed zip, update metadata, a blockmap, and the zip's SHA-256 checksum. The Android APK is attached once its parallel build finishes. The Windows x64 installer and Linux x64 AppImage come from upstream's `release-desktop.yml`, so they ship the same payload as upstream, and are attached last: the Windows build embeds the Linux CLI archive as its WSL runtime, so it starts after the Linux build. The Windows installer is unsigned, so SmartScreen asks for confirmation on first install. A failed Android, Windows, or Linux build does not block the macOS release, and is only retried by a later build or a `force` dispatch.

Inherited upstream workflows remain disabled in the fork. Some expect the maintainers' production credentials, and others would duplicate work after every automated merge. Fork CI on a pull request only typechecks and builds the desktop app: upstream's own CI already tested upstream's code, so a pull request into `custom-nightly` only has to prove the fork still builds on top of it. Behavior that only a test would catch can therefore merge. A manual dispatch runs the full suite: knip, lint, format, unit and server tests, Rust, mobile native lint, and the release smoke test.

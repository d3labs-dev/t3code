/**
 * A full Chrome or Chromium installed on the host, which server browser tabs
 * prefer over T3's pinned headless shell: Google's sign-in rejects the headless
 * shell as insecure but accepts a full browser in headless mode.
 *
 * Only the real binaries are listed. Launchers such as `/usr/bin/chromium` or
 * `/usr/bin/google-chrome` are scripts that can add the user's own flags
 * (Wayland, a keyring password store, extensions).
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

const windowsChrome = (root: string | undefined) =>
  root === undefined ? [] : [`${root}\\Google\\Chrome\\Application\\chrome.exe`];

/** Where each platform's packages install Chrome and Chromium, Google Chrome first. */
export const systemBrowserCandidates = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<string> => {
  switch (platform) {
    case "linux":
      return [
        "/opt/google/chrome/chrome",
        "/usr/lib/chromium/chromium",
        "/usr/lib64/chromium-browser/chromium-browser",
        "/usr/lib/chromium-browser/chromium-browser",
      ];
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ];
    case "win32":
      return [
        ...windowsChrome(env.PROGRAMFILES),
        ...windowsChrome(env["PROGRAMFILES(X86)"]),
        ...windowsChrome(env.LOCALAPPDATA),
      ];
    default:
      return [];
  }
};

export const firstExecutable = Effect.fn("SystemBrowser.firstExecutable")(function* (
  candidates: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  for (const candidate of candidates) {
    const info = yield* fs.stat(candidate).pipe(Effect.option);
    if (
      Option.isSome(info) &&
      info.value.type === "File" &&
      (platform === "win32" || (info.value.mode & 0o111) !== 0)
    ) {
      return Option.some(candidate);
    }
  }
  return Option.none<string>();
});

export const findSystemBrowser = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  return yield* firstExecutable(systemBrowserCandidates(platform, env));
}).pipe(Effect.withSpan("SystemBrowser.find"));

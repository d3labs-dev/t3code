import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { firstExecutable, systemBrowserCandidates } from "./SystemBrowser.ts";

// POSIX modes cannot be checked on NTFS, so follow the host like the PreviewBrowser suite.
const hostPlatform: NodeJS.Platform =
  HostProcess.Platform.defaultValue() === "win32" ? "win32" : "linux";

it.layer(NodeServices.layer)("SystemBrowser", (it) => {
  it.effect("picks the first candidate that is an executable file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-system-browser-test-" });
      const directory = path.join(dir, "directory");
      const notExecutable = path.join(dir, "not-executable");
      const chrome = path.join(dir, "chrome");
      const chromium = path.join(dir, "chromium");
      yield* fs.makeDirectory(directory);
      yield* fs.writeFileString(notExecutable, "", { mode: 0o644 });
      yield* fs.writeFileString(chrome, "", { mode: 0o755 });
      yield* fs.writeFileString(chromium, "", { mode: 0o755 });
      const candidates = [path.join(dir, "missing"), directory];
      if (hostPlatform !== "win32") candidates.push(notExecutable);

      const find = (paths: ReadonlyArray<string>) =>
        firstExecutable(paths).pipe(Effect.provideService(HostProcess.Platform, hostPlatform));
      expect(yield* find([...candidates, chrome, chromium])).toEqual(Option.some(chrome));
      expect(yield* find(candidates)).toEqual(Option.none());
    }),
  );

  it("looks for Chrome under each Windows install root the host sets", () => {
    expect(
      systemBrowserCandidates("win32", {
        PROGRAMFILES: "D:\\Programs",
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
      }),
    ).toEqual([
      "D:\\Programs\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ]);
  });
});

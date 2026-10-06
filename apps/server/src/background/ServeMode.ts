import type { ServerSettings } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";

/**
 * The optional root helper (`scripts/serve-mode`) keeps the Mac running with
 * the lid closed and in Low Power Mode while this directory names a live
 * server pid. Each server writes its own pid, so a crashed server's leftover
 * file reads as stale instead of holding the Mac awake.
 */
const SERVE_MODE_REQUEST_DIR = "/private/tmp/t3code-serve-mode";

/** Written by `scripts/serve-mode/install.sh`; must match its label. */
export const SERVE_MODE_HELPER_PLIST = "/Library/LaunchDaemons/com.t3tools.t3code.serve-mode.plist";

export type ServeModeHost =
  | { readonly platform: "darwin"; readonly requestDir: string }
  | { readonly platform: "win32"; readonly powerModeStatePath: string };

/** The "Best power efficiency" Power mode in Windows 10 and 11 Settings. */
const WINDOWS_BEST_POWER_EFFICIENCY = "961cc777-2547-4f9d-8174-7d86181b8a7a";

const powerShellString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Windows PowerShell 5.1 ships with every Windows 10 and 11 install. The Power
 * mode calls are undocumented but are what Settings uses, and need no admin.
 */
const windowsPowerApi = `$k = Add-Type -Name ServeMode -Namespace T3 -PassThru -MemberDefinition '
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
[DllImport("powrprof.dll")] public static extern uint PowerGetEffectiveOverlayScheme(out Guid overlay);
[DllImport("powrprof.dll")] public static extern uint PowerSetActiveOverlayScheme(Guid overlay);'
$saver = [Guid]'${WINDOWS_BEST_POWER_EFFICIENCY}'
$current = [Guid]::Empty`;

/**
 * The Power mode outlives this process, so the mode it replaced is saved to
 * `statePath` for whichever restore runs first. Windows keeps a mode per power
 * source; this switches the one in use.
 */
const useBestPowerEfficiency = (statePath: string) =>
  `if ($k::PowerGetEffectiveOverlayScheme([ref]$current) -eq 0 -and $current -ne $saver) {
  Set-Content -LiteralPath ${powerShellString(statePath)} -Value $current
  [void]$k::PowerSetActiveOverlayScheme($saver)
}`;

/** Leaves a Power mode the user picked since then alone. */
const restorePowerMode = (statePath: string) =>
  `if (Test-Path -LiteralPath ${powerShellString(statePath)}) {
  if ($k::PowerGetEffectiveOverlayScheme([ref]$current) -eq 0 -and $current -eq $saver) {
    [void]$k::PowerSetActiveOverlayScheme([Guid](Get-Content -LiteralPath ${powerShellString(statePath)} -Raw).Trim())
  }
  Remove-Item -LiteralPath ${powerShellString(statePath)}
}`;

const powerShell = (script: string) =>
  ChildProcess.make(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );

/**
 * The execution-state flags are ES_CONTINUOUS | ES_SYSTEM_REQUIRED in decimal,
 * because 5.1 parses 0x80000001 as a negative Int32 that won't convert to
 * uint. Windows tracks the request per thread, so it ends when this process
 * exits, and the Power mode comes back once the server is gone.
 */
const windowsKeepAwakeScript = (options: {
  readonly serverPid: number;
  readonly powerModeStatePath: string | null;
}) =>
  [
    windowsPowerApi,
    `if ($k::SetThreadExecutionState(2147483649) -eq 0) { exit 1 }`,
    ...(options.powerModeStatePath ? [useBestPowerEfficiency(options.powerModeStatePath)] : []),
    `Wait-Process -Id ${options.serverPid}`,
    ...(options.powerModeStatePath ? [restorePowerMode(options.powerModeStatePath)] : []),
  ].join("\n");

/**
 * Both commands stop idle sleep but still let the display sleep and lock, and
 * both end with this server even if it is killed before its finalizers run.
 */
const keepAwakeCommand = (options: {
  readonly host: ServeModeHost;
  readonly serverPid: number;
  readonly powerSaving: boolean;
}) => {
  switch (options.host.platform) {
    case "darwin":
      return ChildProcess.make("/usr/bin/caffeinate", ["-i", "-w", String(options.serverPid)], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
    case "win32":
      return powerShell(
        windowsKeepAwakeScript({
          serverPid: options.serverPid,
          powerModeStatePath: options.powerSaving ? options.host.powerModeStatePath : null,
        }),
      );
  }
};

/** While `serveMode` is on, holds the host's keep-awake process. */
export const make = Effect.fn("background.serveMode.make")(function* (host: ServeModeHost) {
  const settings = yield* ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const requestLidClosedHelper = (requestDir: string) => {
    const requestPath = path.join(requestDir, String(process.pid));
    return Effect.acquireRelease(
      fs
        .makeDirectory(requestDir, { recursive: true })
        .pipe(Effect.andThen(fs.writeFileString(requestPath, ""))),
      () => fs.remove(requestPath, { force: true }).pipe(Effect.ignore),
    ).pipe(Effect.ignoreCause({ log: true }));
  };

  const restoreWindowsPowerMode = (statePath: string) =>
    fs.exists(statePath).pipe(
      Effect.flatMap((saved) =>
        saved
          ? spawner.exitCode(powerShell([windowsPowerApi, restorePowerMode(statePath)].join("\n")))
          : Effect.void,
      ),
      Effect.ignoreCause({ log: true }),
    );

  const serve = (powerSaving: boolean) =>
    Effect.gen(function* () {
      if (host.platform === "darwin") yield* requestLidClosedHelper(host.requestDir);
      if (host.platform === "win32" && powerSaving) {
        yield* Effect.addFinalizer(() => restoreWindowsPowerMode(host.powerModeStatePath));
      }
      yield* spawner
        .spawn(keepAwakeCommand({ host, serverPid: process.pid, powerSaving }))
        .pipe(Effect.ignoreCause({ log: true }));
      return yield* Effect.never;
    }).pipe(Effect.scoped);

  const selectServing = (current: ServerSettings) =>
    !current.serveMode ? "off" : current.serveModePowerSaving ? "power-saving" : "awake";
  const changes = yield* settings.subscribeChanges;
  const servingAtStart = yield* settings.getSettings.pipe(
    Effect.map(selectServing),
    Effect.orElseSucceed(() => "off" as const),
  );
  yield* (
    host.platform === "win32" ? restoreWindowsPowerMode(host.powerModeStatePath) : Effect.void
  ).pipe(
    Effect.andThen(
      Stream.concat(Stream.make(servingAtStart), changes.pipe(Stream.map(selectServing))).pipe(
        Stream.changes,
        Stream.switchMap((serving) =>
          serving === "off"
            ? Stream.empty
            : Stream.fromEffectDrain(serve(serving === "power-saving")),
        ),
        Stream.runDrain,
      ),
    ),
    Effect.forkScoped,
  );
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    switch (yield* HostProcessPlatform) {
      case "darwin":
        return yield* make({ platform: "darwin", requestDir: SERVE_MODE_REQUEST_DIR });
      case "win32": {
        const { stateDir } = yield* ServerConfig;
        const path = yield* Path.Path;
        return yield* make({
          platform: "win32",
          powerModeStatePath: path.join(stateDir, "serve-mode-power-mode"),
        });
      }
    }
  }),
);

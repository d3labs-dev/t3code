import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ServeMode from "./ServeMode.ts";

const settingsLayer = () =>
  ServerSettings.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-serve-mode-test-" })),
    ),
  );

type ProcessEvent =
  | { readonly type: "started"; readonly argv: string }
  | { readonly type: "stopped" };

const recordingSpawner = (events: Queue.Queue<ProcessEvent>) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (command._tag !== "StandardCommand") return yield* Effect.die("unexpected pipeline");
      yield* Effect.addFinalizer(() => Queue.offer(events, { type: "stopped" }));
      yield* Queue.offer(events, {
        type: "started",
        argv: [command.command, ...command.args].join(" "),
      });
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

const startServeMode = Effect.fn(function* (platform: ServeMode.ServeModeHost["platform"]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const events = yield* Queue.unbounded<ProcessEvent>();
  const tempDir = yield* fs.makeTempDirectoryScoped();
  const requestDir = path.join(tempDir, "requests");
  const requestPath = path.join(requestDir, String(process.pid));
  const powerModeStatePath = path.join(tempDir, "serve-mode-power-mode");
  const serveModeScope = yield* Scope.make();
  yield* ServeMode.make(
    platform === "darwin" ? { platform, requestDir } : { platform, powerModeStatePath },
  ).pipe(
    Scope.provide(serveModeScope),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, recordingSpawner(events)),
  );
  return {
    events,
    requestExists: fs.exists(requestPath),
    powerModeStatePath,
    stop: Scope.close(serveModeScope, Exit.void),
  };
});

const powerShellScript = (event: ProcessEvent) => {
  assert(event.type === "started");
  const [command, ...args] = event.argv.split(" ");
  assert.strictEqual(command, "powershell.exe");
  assert.deepStrictEqual(args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  return Buffer.from(args[3] ?? "", "base64").toString("utf16le");
};

it.layer(NodeServices.layer)("serve mode", (it) => {
  it.effect("holds caffeinate and a helper request only while serve mode is on", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        const serveMode = yield* startServeMode("darwin");
        assert.isFalse(yield* serveMode.requestExists);

        yield* settings.updateSettings({ serveMode: true });
        assert.deepStrictEqual(yield* Queue.take(serveMode.events), {
          type: "started",
          argv: `/usr/bin/caffeinate -i -w ${process.pid}`,
        });
        assert.isTrue(yield* serveMode.requestExists);

        yield* settings.updateSettings({ serveMode: false });
        assert.deepStrictEqual(yield* Queue.take(serveMode.events), { type: "stopped" });
        yield* serveMode.stop;
        assert.isFalse(yield* serveMode.requestExists);
        assert.strictEqual(yield* Queue.size(serveMode.events), 0);
      }),
    ).pipe(Effect.provide(settingsLayer())),
  );

  it.effect("starts when the server starts with serve mode on and stops with the server", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        yield* settings.updateSettings({ serveMode: true });
        const serveMode = yield* startServeMode("darwin");

        assert.strictEqual((yield* Queue.take(serveMode.events)).type, "started");
        yield* serveMode.stop;
        assert.deepStrictEqual(yield* Queue.take(serveMode.events), { type: "stopped" });
        assert.isFalse(yield* serveMode.requestExists);
      }),
    ).pipe(Effect.provide(settingsLayer())),
  );

  it.effect("holds a PowerShell execution-state request on Windows while serve mode is on", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        const serveMode = yield* startServeMode("win32");

        yield* settings.updateSettings({ serveMode: true });
        const script = powerShellScript(yield* Queue.take(serveMode.events));
        assert.include(script, "SetThreadExecutionState(2147483649)");
        assert.include(script, `Wait-Process -Id ${process.pid}`);
        assert.notInclude(script, "PowerSetActiveOverlayScheme($saver)");
        assert.isFalse(yield* serveMode.requestExists);

        yield* settings.updateSettings({ serveMode: false });
        assert.deepStrictEqual(yield* Queue.take(serveMode.events), { type: "stopped" });
        yield* serveMode.stop;
      }),
    ).pipe(Effect.provide(settingsLayer())),
  );

  it.effect("switches Windows to Best power efficiency and restores it when opted in", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const settings = yield* ServerSettings.ServerSettingsService;
        const serveMode = yield* startServeMode("win32");

        yield* settings.updateSettings({ serveMode: true, serveModePowerSaving: true });
        const script = powerShellScript(yield* Queue.take(serveMode.events));
        assert.include(script, "PowerSetActiveOverlayScheme($saver)");
        assert.include(script, `'${serveMode.powerModeStatePath}'`);
        assert.isAbove(
          script.indexOf("Remove-Item"),
          script.indexOf(`Wait-Process -Id ${process.pid}`),
        );

        yield* fs.writeFileString(
          serveMode.powerModeStatePath,
          "00000000-0000-0000-0000-000000000000",
        );
        yield* settings.updateSettings({ serveModePowerSaving: false });
        assert.deepStrictEqual(yield* Queue.take(serveMode.events), { type: "stopped" });
        const restore = powerShellScript(yield* Queue.take(serveMode.events));
        assert.include(restore, "Remove-Item");
        assert.notInclude(restore, "Wait-Process");
        assert.deepStrictEqual(yield* Queue.take(serveMode.events), { type: "stopped" });
        assert.notInclude(
          powerShellScript(yield* Queue.take(serveMode.events)),
          "PowerSetActiveOverlayScheme($saver)",
        );
        yield* serveMode.stop;
      }),
    ).pipe(Effect.provide(settingsLayer())),
  );

  it.effect("restores a Power mode left behind by a server that died", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const events = yield* Queue.unbounded<ProcessEvent>();
        const powerModeStatePath = path.join(yield* fs.makeTempDirectoryScoped(), "power-mode");
        yield* fs.writeFileString(powerModeStatePath, "00000000-0000-0000-0000-000000000000");

        yield* ServeMode.make({ platform: "win32", powerModeStatePath }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, recordingSpawner(events)),
        );
        assert.include(powerShellScript(yield* Queue.take(events)), "Remove-Item");
      }),
    ).pipe(Effect.provide(settingsLayer())),
  );
});

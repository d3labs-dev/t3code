import { DesktopMascotMoodSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopAssets from "../../app/DesktopAssets.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const setDockMood = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_DOCK_MOOD_CHANNEL,
  payload: DesktopMascotMoodSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.setDockMood")(function* (mood) {
    if ((yield* HostProcess.Platform) !== "darwin") return;
    const assets = yield* DesktopAssets.DesktopAssets;
    const iconPath = yield* assets
      .resolveResourcePath(`mascot/${mood}.png`)
      .pipe(Effect.orElseSucceed(() => Option.none<string>()));
    if (Option.isNone(iconPath)) return;
    const app = yield* ElectronApp.ElectronApp;
    yield* app.setDockIcon(iconPath.value);
  }),
});

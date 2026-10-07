// @effect-diagnostics nodeBuiltinImport:off -- Content ids must match the renderer's SHA-256 hex of the picture bytes.
import { DesktopBackgroundFolderImage } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

/** The formats the renderer's background store accepts, keyed by extension. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const HASH_CONCURRENCY = 4;
const pathOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function imageTypeOf(path: Path.Path, filePath: string): string | null {
  return IMAGE_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

// Hidden entries include the `._name.jpg` resource forks macOS writes on
// external drives, which carry an image extension but no picture.
function isHidden(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

export const listBackgroundFolderImages = Effect.fn("desktop.backgroundFolder.list")(function* (
  folderPath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem.readDirectory(folderPath, { recursive: true });
  const candidates = entries
    .filter((entry) => !isHidden(entry) && imageTypeOf(path, entry) !== null)
    .sort(pathOrder.compare);
  const images = yield* Effect.forEach(
    candidates,
    (relativePath) => {
      const filePath = path.join(folderPath, relativePath);
      return fileSystem.readFile(filePath).pipe(
        Effect.map((bytes) =>
          Option.some({
            path: filePath,
            id: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
            type: imageTypeOf(path, filePath) ?? "",
          }),
        ),
        // A file that vanished or cannot be read mid-scan just drops out.
        Effect.orElseSucceed(() => Option.none<DesktopBackgroundFolderImage>()),
      );
    },
    { concurrency: HASH_CONCURRENCY },
  );
  return images.flatMap((image) => (Option.isSome(image) ? [image.value] : []));
});

export const pickBackgroundFolder = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PICK_BACKGROUND_FOLDER_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.backgroundFolder.pick")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const picked = yield* dialog.pickFolder({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath: Option.none(),
    });
    return Option.getOrNull(picked);
  }),
});

export const listBackgroundFolder = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LIST_BACKGROUND_FOLDER_CHANNEL,
  payload: Schema.String,
  result: Schema.NullOr(Schema.Array(DesktopBackgroundFolderImage)),
  handler: Effect.fn("desktop.ipc.backgroundFolder.list")(function* (folderPath) {
    return yield* listBackgroundFolderImages(folderPath).pipe(Effect.orElseSucceed(() => null));
  }),
});

export const readBackgroundFolderImage = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.READ_BACKGROUND_FOLDER_IMAGE_CHANNEL,
  payload: Schema.String,
  result: Schema.Uint8Array,
  handler: Effect.fn("desktop.ipc.backgroundFolder.read")(function* (filePath) {
    const path = yield* Path.Path;
    if (imageTypeOf(path, filePath) === null) {
      return yield* Effect.die(new Error("Only background pictures can be read."));
    }
    return yield* (yield* FileSystem.FileSystem).readFile(filePath);
  }),
});

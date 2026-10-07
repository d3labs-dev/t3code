// @effect-diagnostics nodeBuiltinImport:off -- Computes the expected SHA-256 hex ids independently of the implementation.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { listBackgroundFolderImages } from "./backgroundFolder.ts";

it.layer(NodeServices.layer)("listBackgroundFolderImages", (it) => {
  it.effect("lists nested pictures in file-name order with renderer-matching ids", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = yield* fileSystem.makeTempDirectoryScoped();
      yield* fileSystem.makeDirectory(path.join(folder, "nested"));
      const write = (name: string, text: string) =>
        fileSystem.writeFileString(path.join(folder, name), text);
      yield* write("img10.JPG", "ten");
      yield* write("img2.png", "two");
      yield* write("nested/deep.webp", "deep");
      yield* write("notes.txt", "not a picture");
      yield* write("._img2.png", "resource fork");

      const images = yield* listBackgroundFolderImages(folder);

      const sha = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
      assert.deepStrictEqual(images, [
        { path: path.join(folder, "img2.png"), id: sha("two"), type: "image/png" },
        { path: path.join(folder, "img10.JPG"), id: sha("ten"), type: "image/jpeg" },
        { path: path.join(folder, "nested/deep.webp"), id: sha("deep"), type: "image/webp" },
      ]);
    }).pipe(Effect.scoped),
  );
});

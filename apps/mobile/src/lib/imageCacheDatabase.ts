import type { ImageCacheStorage } from "@t3tools/client-runtime/image-cache";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MobileDatabase from "../persistence/mobile-database";

const CACHE_SCHEMA_VERSION = 1;

let database: MobileDatabase.MobileDatabase["Service"] | undefined;

export function attachImageCacheDatabase(service: MobileDatabase.MobileDatabase["Service"]) {
  database = service;
}

const runDatabase = <A, E>(
  use: (database: MobileDatabase.MobileDatabase["Service"]) => Effect.Effect<A, E>,
) =>
  database
    ? Effect.runPromise(use(database))
    : Promise.reject(new Error("Image cache storage is not attached."));

export function createImageCacheDatabaseStorage<
  Entry extends { readonly environmentId: EnvironmentId },
>(kind: MobileDatabase.ClientCacheKind): ImageCacheStorage<Entry> {
  return {
    list: () =>
      runDatabase((database) =>
        database.listCache(kind).pipe(
          Effect.map((payloads) =>
            payloads.flatMap((payload): Array<unknown> => {
              try {
                return [JSON.parse(payload)];
              } catch {
                return [];
              }
            }),
          ),
        ),
      ),
    put: (key, entry) =>
      runDatabase((database) =>
        database.saveCache(
          entry.environmentId,
          kind,
          key,
          CACHE_SCHEMA_VERSION,
          JSON.stringify(entry),
        ),
      ),
    remove: (key, entry) =>
      runDatabase((database) => database.removeCache(entry.environmentId, kind, key)),
  };
}

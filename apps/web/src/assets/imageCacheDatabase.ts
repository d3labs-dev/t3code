import type { ImageCacheStorage } from "@t3tools/client-runtime/image-cache";

const DATABASE_VERSION = 2;
const STORE_NAME = "images";

function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

/** Each cache owns a database, because opening one drops every store but its images. */
export function createIndexedDbImageCacheStorage<Entry>(
  databaseName: string,
): ImageCacheStorage<Entry> {
  let database: Promise<IDBDatabase> | undefined;

  const openDatabase = () =>
    (database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        for (const name of request.result.objectStoreNames) {
          if (name !== STORE_NAME) request.result.deleteObjectStore(name);
        }
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () => reject(new Error("Image cache is blocked.")));
    }));

  const withStore = async <A>(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => IDBRequest<A> | void,
  ) => {
    const transaction = (await openDatabase()).transaction(STORE_NAME, mode);
    const request = use(transaction.objectStore(STORE_NAME));
    await completed(transaction);
    return request?.result;
  };

  return {
    list: async () => (await withStore("readonly", (store) => store.getAll())) ?? [],
    put: async (key, entry) => {
      await withStore("readwrite", (store) => store.put(entry, key));
    },
    remove: async (key) => {
      await withStore("readwrite", (store) => store.delete(key));
    },
  };
}

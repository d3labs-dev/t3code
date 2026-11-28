import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

export interface ImageCacheStorage<Entry> {
  readonly list: () => Promise<ReadonlyArray<unknown>>;
  readonly put: (key: string, entry: Entry) => Promise<void>;
  readonly remove: (key: string, entry: Entry) => Promise<void>;
}

/**
 * An on-device cache of small images as data URLs, kept in memory and mirrored to `storage`.
 * `resolve` stores only what `decodeEntry` accepts, so hydration reads back everything it wrote.
 */
export function createImageCache<
  Target extends { readonly environmentId: EnvironmentId },
  Entry extends Target & { readonly dataUrl: string },
>(input: {
  readonly storage: ImageCacheStorage<Entry>;
  readonly load: (url: string, signal: AbortSignal) => Promise<string>;
  readonly decodeEntry: (record: unknown) => Option.Option<Entry>;
  readonly keyFor: (target: Target) => string;
  readonly entryFor: (target: Target, url: string, dataUrl: string) => Entry;
  /** Whether the cached image is still the one `url` serves for the target. */
  readonly isCurrent: (cached: Entry, target: Target, url: string) => boolean;
  /** A URL meaning the target has no image; resolving it evicts the cached one. */
  readonly isMissingImageUrl?: (url: string) => boolean;
  readonly maxEntries: number;
  readonly maxBytes: number;
}) {
  const entries = new Map<string, Entry>();
  const environmentGenerations = new Map<EnvironmentId, number>();
  const environmentGeneration = (environmentId: EnvironmentId) =>
    environmentGenerations.get(environmentId) ?? 0;
  let generation = 0;
  let hydration: Promise<void> | undefined;
  let clearing: Promise<void> | undefined;
  const pending = new Set<Promise<void>>();

  const persist = (operation: () => Promise<void>) => {
    const task: Promise<void> = operation()
      .catch(() => {})
      .finally(() => pending.delete(task));
    pending.add(task);
  };

  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    persist(() => input.storage.remove(key, entry));
  };

  const trim = () => {
    let bytes = 0;
    for (const entry of entries.values()) bytes += entry.dataUrl.length;
    while (entries.size > input.maxEntries || bytes > input.maxBytes) {
      const oldest = entries.entries().next().value;
      if (!oldest) break;
      bytes -= oldest[1].dataUrl.length;
      remove(oldest[0]);
    }
  };

  const hydrate = () =>
    (hydration ??= (async () => {
      try {
        for (const record of await input.storage.list()) {
          const entry = input.decodeEntry(record);
          if (Option.isSome(entry)) entries.set(input.keyFor(entry.value), entry.value);
        }
        trim();
      } catch {}
    })());

  const peek = (target: Target) => entries.get(input.keyFor(target))?.dataUrl ?? null;

  const resolve = async (
    target: Target,
    url: string | null,
    signal: AbortSignal,
  ): Promise<string | null> => {
    await clearing;
    const startGeneration = generation;
    const startEnvironmentGeneration = environmentGeneration(target.environmentId);
    await hydrate();
    if (signal.aborted || url === null) return peek(target);
    const key = input.keyFor(target);
    if (input.isMissingImageUrl?.(url)) {
      remove(key);
      return null;
    }
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached);
      if (input.isCurrent(cached, target, url)) return cached.dataUrl;
    }
    try {
      const dataUrl = await input.load(url, signal);
      if (
        signal.aborted ||
        startGeneration !== generation ||
        startEnvironmentGeneration !== environmentGeneration(target.environmentId)
      ) {
        return peek(target);
      }
      const entry = input.decodeEntry(input.entryFor(target, url, dataUrl));
      if (Option.isSome(entry)) {
        entries.set(key, entry.value);
        persist(() => input.storage.put(key, entry.value));
        trim();
        return dataUrl;
      }
    } catch {}
    return peek(target) ?? url;
  };

  const flush = async () => {
    await Promise.all(pending);
  };

  // A download that started before the clear sees the generation change and is discarded;
  // one that starts during the clear waits for it, so it cannot repopulate storage.
  const clear = async (environmentId?: EnvironmentId) => {
    if (environmentId === undefined) generation += 1;
    else environmentGenerations.set(environmentId, environmentGeneration(environmentId) + 1);
    const previous = clearing;
    const task = (async () => {
      await previous;
      await hydrate();
      for (const [key, entry] of entries) {
        if (environmentId === undefined || entry.environmentId === environmentId) remove(key);
      }
      await flush();
    })().finally(() => {
      if (clearing === task) clearing = undefined;
    });
    clearing = task;
    await task;
  };

  return {
    hydrate,
    peek,
    resolve,
    clearEnvironment: (environmentId: EnvironmentId) => clear(environmentId),
    clearAll: () => clear(),
    flush,
  };
}

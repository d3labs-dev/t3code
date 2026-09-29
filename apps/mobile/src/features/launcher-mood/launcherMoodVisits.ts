import Storage from "expo-sqlite/kv-store";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const STORAGE_KEY = "t3code.launcher-mood.visits";

const LauncherMoodVisits = Schema.Struct({
  /** Anything that happened before this device started keeping visits counts as seen. */
  trackedSince: Schema.String,
  lastVisitedAtByThreadKey: Schema.Record(Schema.String, Schema.String),
});
type LauncherMoodVisits = typeof LauncherMoodVisits.Type;

const VisitsJson = Schema.fromJsonString(LauncherMoodVisits);
const decodeVisits = Schema.decodeUnknownOption(VisitsJson);
const encodeVisits = Schema.encodeSync(VisitsJson);

let loadedVisits: LauncherMoodVisits | null = null;

function save(visits: LauncherMoodVisits): LauncherMoodVisits {
  Storage.setItemSync(STORAGE_KEY, encodeVisits(visits));
  loadedVisits = visits;
  return visits;
}

function visits(): LauncherMoodVisits {
  if (loadedVisits === null) {
    const stored = decodeVisits(Storage.getItemSync(STORAGE_KEY));
    loadedVisits = Option.isSome(stored)
      ? stored.value
      : save({ trackedSince: new Date().toISOString(), lastVisitedAtByThreadKey: {} });
  }
  return loadedVisits;
}

/** When this device last showed the thread, by scoped thread key. */
export function lastVisitedAt(threadKey: string): string {
  const current = visits();
  return current.lastVisitedAtByThreadKey[threadKey] ?? current.trackedSince;
}

export function recordVisit(input: { readonly threadKey: string; readonly visitedAt: string }) {
  const current = visits();
  save({
    ...current,
    lastVisitedAtByThreadKey: {
      ...current.lastVisitedAtByThreadKey,
      [input.threadKey]: input.visitedAt,
    },
  });
}

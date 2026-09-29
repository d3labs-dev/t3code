/**
 * The relay's Android delivery rules, ported from infra/relay/src/agentActivity
 * (agentActivityAggregate, agentActivityAlerts, agentActivityPayloads,
 * fcmPayloads and FcmDeliveries) so this server can push the same data map
 * itself. The native handler in apps/mobile/modules/t3-agent-notifications
 * reads these keys; keep them in step with the relay's.
 */
import type {
  RelayAgentActivityAggregateRow,
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";

type AgentActivityPhase = RelayAgentActivityState["phase"];

const RUNNING_AGENT_ACTIVITY_ROW_TTL_MS = 2 * 60 * 60 * 1_000;
const WAITING_AGENT_ACTIVITY_ROW_TTL_MS = 24 * 60 * 60 * 1_000;
const TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS = 15 * 60 * 1_000;
const TERMINAL_NOTIFICATION_FRESHNESS_MS = 2 * 60 * 1_000;
const MAX_SUMMARY_TEXT_LENGTH = 120;
const MAX_STATUS_TEXT_LENGTH = 40;
const MAX_DEEP_LINK_LENGTH = 512;
const MAX_ACTIVITY_ROWS = 5;
// The relay fits FCM's 4 KB data budget at 3800 bytes. Expo adds its own keys
// (experienceId, scopeKey, projectId) next to our JSON-encoded `body`.
const EXPO_DATA_BUDGET_BYTES = 3_500;

function isTerminalPhase(phase: AgentActivityPhase): boolean {
  return phase === "completed" || phase === "failed";
}

function isAttentionPhase(phase: AgentActivityPhase): boolean {
  return phase === "waiting_for_approval" || phase === "waiting_for_input";
}

function agentActivityExpiresAt(state: Pick<RelayAgentActivityState, "phase" | "updatedAt">) {
  const ttlMs =
    state.phase === "running" || state.phase === "starting"
      ? RUNNING_AGENT_ACTIVITY_ROW_TTL_MS
      : WAITING_AGENT_ACTIVITY_ROW_TTL_MS;
  return Date.parse(state.updatedAt) + ttlMs;
}

function isExpiredAgentActivityState(
  state: Pick<RelayAgentActivityState, "phase" | "updatedAt">,
  nowMs: number,
): boolean {
  const expiresAt = agentActivityExpiresAt(state);
  return !Number.isFinite(expiresAt) || nowMs > expiresAt;
}

function isRecentTerminalState(state: RelayAgentActivityState, nowMs: number): boolean {
  const updatedAtMs = Date.parse(state.updatedAt);
  return (
    isTerminalPhase(state.phase) &&
    !Number.isNaN(updatedAtMs) &&
    nowMs - updatedAtMs <= TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS
  );
}

function isFreshTerminalNotification(updatedAt: string, nowMs: number): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  return !Number.isNaN(updatedAtMs) && nowMs - updatedAtMs <= TERMINAL_NOTIFICATION_FRESHNESS_MS;
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength - 3).trimEnd() + "...";
}

function sanitizeDeepLink(value: string): string {
  const trimmed = value.trim();
  return !trimmed.startsWith("/") || trimmed.startsWith("//")
    ? "/"
    : truncateText(trimmed, MAX_DEEP_LINK_LENGTH);
}

function sanitizeRow(row: RelayAgentActivityAggregateRow): RelayAgentActivityAggregateRow {
  return {
    ...row,
    projectTitle: truncateText(row.projectTitle, MAX_SUMMARY_TEXT_LENGTH),
    threadTitle: truncateText(row.threadTitle, MAX_SUMMARY_TEXT_LENGTH),
    modelTitle: truncateText(row.modelTitle, MAX_SUMMARY_TEXT_LENGTH),
    status: truncateText(row.status, MAX_STATUS_TEXT_LENGTH),
    deepLink: sanitizeDeepLink(row.deepLink),
  };
}

function statusForPhase(phase: AgentActivityPhase): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval";
    case "waiting_for_input":
      return "Input";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "starting":
      return "Connecting";
    case "running":
      return "Working";
    case "stale":
      return "Waiting";
  }
}

function activityPhasePriority(phase: AgentActivityPhase): number {
  if (isAttentionPhase(phase)) return 0;
  if (phase === "failed") return 1;
  if (phase === "starting" || phase === "running") return 2;
  return 3;
}

function aggregateRowForState(state: RelayAgentActivityState): RelayAgentActivityAggregateRow {
  return sanitizeRow({
    environmentId: state.environmentId,
    threadId: state.threadId,
    projectTitle: state.projectTitle,
    threadTitle: state.threadTitle,
    modelTitle: state.modelTitle,
    phase: state.phase,
    status: statusForPhase(state.phase),
    updatedAt: state.updatedAt,
    deepLink: state.deepLink,
  });
}

/** What the ongoing card shows for this server's latest thread states. */
export function makeAggregateState(input: {
  readonly states: ReadonlyArray<RelayAgentActivityState>;
  readonly nowMs: number;
}): RelayAgentActivityAggregateState | null {
  const activeStates = input.states.filter(
    (state) => !isTerminalPhase(state.phase) && !isExpiredAgentActivityState(state, input.nowMs),
  );
  const recentTerminalStates = input.states
    .filter((state) => isRecentTerminalState(state, input.nowMs))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (activeStates.length === 0) {
    const newest = recentTerminalStates[0];
    if (!newest) return null;
    return {
      title: "T3 Code",
      subtitle: newest.phase === "failed" ? "Agent work failed" : "Agent work completed",
      activeCount: 0,
      updatedAt: newest.updatedAt,
      activities: recentTerminalStates.slice(0, MAX_ACTIVITY_ROWS).map(aggregateRowForState),
    };
  }
  const displayedStates = [
    ...activeStates
      .toSorted((a, b) => activityPhasePriority(a.phase) - activityPhasePriority(b.phase))
      .slice(0, MAX_ACTIVITY_ROWS),
    ...recentTerminalStates,
  ].slice(0, MAX_ACTIVITY_ROWS);
  const updatedAt = [...activeStates, ...recentTerminalStates].reduce((latest, state) =>
    state.updatedAt.localeCompare(latest.updatedAt) > 0 ? state : latest,
  ).updatedAt;
  return {
    title: "T3 Code",
    subtitle: "Agent work in progress",
    activeCount: activeStates.length,
    updatedAt,
    activities: displayedStates.map(aggregateRowForState),
  };
}

function rowKey(row: RelayAgentActivityAggregateRow): string {
  return JSON.stringify([row.environmentId, row.threadId]);
}

function alertAllowedForPhase(
  preferences: RelayAgentAwarenessPreferences,
  phase: AgentActivityPhase,
): boolean {
  switch (phase) {
    case "waiting_for_approval":
      return preferences.notifyOnApproval;
    case "waiting_for_input":
      return preferences.notifyOnInput;
    case "completed":
      return preferences.notifyOnCompletion;
    case "failed":
      return preferences.notifyOnFailure;
    default:
      return false;
  }
}

interface TransitionInput {
  readonly previousAggregate: RelayAgentActivityAggregateState;
  readonly nextAggregate: RelayAgentActivityAggregateState;
  readonly preferences: RelayAgentAwarenessPreferences;
  readonly nowMs: number;
}

function attentionTransitionRows(input: TransitionInput) {
  const previouslyAttention = new Set(
    input.previousAggregate.activities.filter((row) => isAttentionPhase(row.phase)).map(rowKey),
  );
  return input.nextAggregate.activities.filter(
    (row) =>
      isAttentionPhase(row.phase) &&
      !previouslyAttention.has(rowKey(row)) &&
      alertAllowedForPhase(input.preferences, row.phase),
  );
}

// Includes completions the previous card never showed as running.
function terminalTransitionRows(input: TransitionInput) {
  const previousPhases = new Map(
    input.previousAggregate.activities.map((row) => [rowKey(row), row.phase]),
  );
  return input.nextAggregate.activities.filter((row) => {
    const previousPhase = previousPhases.get(rowKey(row));
    return (
      isTerminalPhase(row.phase) &&
      (previousPhase === undefined || !isTerminalPhase(previousPhase)) &&
      alertAllowedForPhase(input.preferences, row.phase) &&
      isFreshTerminalNotification(row.updatedAt, input.nowMs)
    );
  });
}

function alertForActivityRows(rows: ReadonlyArray<RelayAgentActivityAggregateRow>) {
  const first = rows[0];
  if (!first) return null;
  if (rows.length === 1) {
    return { title: first.threadTitle, body: `${first.status}: ${first.projectTitle}` };
  }
  return {
    title: `${rows.length} agents ${isAttentionPhase(first.phase) ? "need attention" : "finished"}`,
    body: rows.map((row) => row.threadTitle).join(", "),
  };
}

interface AndroidAlert {
  /** A stable identity the phone deduplicates on; hash it before sending. */
  readonly alert_id: string;
  readonly alert_title: string;
  readonly alert_body: string;
  readonly alert_path: string;
}

function alertIdentity(row: Pick<RelayAgentActivityState, "environmentId" | "threadId">) {
  return [row.environmentId, row.threadId];
}

function singleRowAlert(row: RelayAgentActivityAggregateRow, identity: string): AndroidAlert {
  return {
    alert_id: identity,
    alert_title: truncateText(row.threadTitle, MAX_SUMMARY_TEXT_LENGTH),
    alert_body: truncateText(`${row.status}: ${row.projectTitle}`, MAX_SUMMARY_TEXT_LENGTH),
    alert_path: sanitizeDeepLink(row.deepLink),
  };
}

/** Alerts for one thread's state when there is no delivered card to compare with. */
function androidAlertForState(input: {
  readonly state: RelayAgentActivityState;
  readonly preferences: RelayAgentAwarenessPreferences;
  readonly nowMs: number;
}): AndroidAlert | null {
  const { state, preferences, nowMs } = input;
  if (
    !preferences.notificationsEnabled ||
    !alertAllowedForPhase(preferences, state.phase) ||
    (isTerminalPhase(state.phase) && !isFreshTerminalNotification(state.updatedAt, nowMs))
  ) {
    return null;
  }
  return singleRowAlert(
    aggregateRowForState(state),
    JSON.stringify([...alertIdentity(state), state.phase, state.updatedAt]),
  );
}

/** Alerts for threads that newly need attention, or else newly finished, since the last card. */
function androidAlertForAggregate(input: TransitionInput): AndroidAlert | null {
  if (!input.preferences.notificationsEnabled) return null;
  const attention = attentionTransitionRows(input);
  const activities = attention.length > 0 ? attention : terminalTransitionRows(input);
  const first = activities[0];
  const alert = alertForActivityRows(activities);
  if (!first || !alert) return null;
  if (activities.length === 1) {
    return singleRowAlert(
      first,
      JSON.stringify([...alertIdentity(first), first.phase, first.updatedAt]),
    );
  }
  const hero = input.nextAggregate.activities.toSorted(
    (a, b) => activityPhasePriority(a.phase) - activityPhasePriority(b.phase),
  )[0];
  return {
    alert_id: JSON.stringify(
      activities
        .map((row) => [...alertIdentity(row), row.phase, row.updatedAt])
        .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ),
    alert_title: alert.title,
    alert_body: alert.body,
    alert_path: hero?.deepLink ?? "/",
  };
}

/** The ongoing card's keys; a null aggregate clears the card. */
function androidActivityData(
  aggregate: RelayAgentActivityAggregateState | null,
): Record<string, string> {
  const rows = (aggregate?.activities ?? []).toSorted(
    (a, b) => activityPhasePriority(a.phase) - activityPhasePriority(b.phase),
  );
  const activeCount = aggregate?.activeCount ?? 0;
  const attentionCount = rows.filter((row) => isAttentionPhase(row.phase)).length;
  const failed = rows.some((row) => row.phase === "failed");
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const lines = rows.map((row) =>
    [row.status, clean(row.threadTitle), clean(row.projectTitle)].join("\t"),
  );
  const hero = rows[0];
  const title =
    activeCount > 0
      ? `${activeCount} active agent${activeCount === 1 ? "" : "s"}${attentionCount ? ` · ${attentionCount} need${attentionCount === 1 ? "s" : ""} attention` : ""}`
      : failed
        ? "Agent work failed"
        : "Agent work completed";
  const expiresAt = Math.max(
    0,
    ...rows.map((row) =>
      isTerminalPhase(row.phase)
        ? Date.parse(row.updatedAt) + TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS
        : agentActivityExpiresAt(row),
    ),
  );
  return {
    active: String(activeCount > 0),
    activity_chip: activeCount > 0 ? (attentionCount > 0 ? "Review" : "Active") : "",
    activity_title: title,
    activity_phase: hero?.phase ?? "",
    activity_active_count: String(activeCount),
    activity_attention_count: String(attentionCount),
    activity_body: hero
      ? `${hero.status}: ${clean(hero.threadTitle)} · ${clean(hero.projectTitle)}`
      : "",
    ...Object.fromEntries(lines.map((line, index) => [`activity_line_${index}`, line])),
    activity_path: hero?.deepLink ?? "/",
    activity_expires_at: String(expiresAt),
  };
}

/** Shrinks the longest texts until the JSON-encoded map fits Expo's push budget. */
export function fitPushData(input: Readonly<Record<string, string>>): Record<string, string> {
  const data = { ...input };
  const encoder = new TextEncoder();
  const textKeys = Object.keys(data).filter(
    (key) => key.endsWith("_body") || key.endsWith("_title") || key.startsWith("activity_line_"),
  );
  while (encoder.encode(JSON.stringify(data)).length > EXPO_DATA_BUDGET_BYTES) {
    const key = textKeys.toSorted(
      (a, b) => encoder.encode(data[b]!).length - encoder.encode(data[a]!).length,
    )[0];
    if (!key) break;
    if (data[key]!.length <= 8) {
      textKeys.splice(textKeys.indexOf(key), 1);
      continue;
    }
    const parts = key.startsWith("activity_line_") ? data[key]!.split("\t") : [data[key]!];
    const part = parts.length === 3 ? (parts[1]!.length > parts[2]!.length ? 1 : 2) : 0;
    const characters = Array.from(parts[part]!);
    // Five characters would become four plus the ellipsis and never shrink.
    if (characters.length <= 5) {
      textKeys.splice(textKeys.indexOf(key), 1);
      continue;
    }
    parts[part] =
      characters
        .slice(0, Math.floor(characters.length * 0.8))
        .join("")
        .trimEnd() + "…";
    data[key] = parts.join("\t");
  }
  return data;
}

interface DeviceDelivery {
  readonly data: Record<string, string>;
  /** The card to compare the next update with once this one is delivered. */
  readonly baseline: RelayAgentActivityAggregateState | null;
}

/**
 * Decides one device's push for an update, as the relay's FcmDeliveries does.
 * `changedState` is the thread state that caused the update; a tombstone or a
 * registration replay passes null and never alerts. Returns null when the
 * phone has nothing to show and nothing to clear.
 */
export function deliveryForDevice(input: {
  readonly deviceId: string;
  readonly userId: string;
  readonly preferences: RelayAgentAwarenessPreferences;
  readonly previousAggregate: RelayAgentActivityAggregateState | null;
  readonly aggregate: RelayAgentActivityAggregateState | null;
  readonly changedState: RelayAgentActivityState | null;
  readonly nowMs: number;
}): DeviceDelivery | null {
  const { preferences, previousAggregate, aggregate, changedState, nowMs } = input;
  let alert: AndroidAlert | null = null;
  if (changedState !== null && preferences.notificationsEnabled) {
    if (preferences.liveActivitiesEnabled && previousAggregate !== null && aggregate !== null) {
      alert = androidAlertForAggregate({
        previousAggregate,
        nextAggregate: aggregate,
        preferences,
        nowMs,
      });
    } else if (!isExpiredAgentActivityState(changedState, nowMs)) {
      alert = androidAlertForState({ state: changedState, preferences, nowMs });
    }
  }
  const displayedAggregate =
    preferences.notificationsEnabled && preferences.liveActivitiesEnabled ? aggregate : null;
  if (displayedAggregate === null && alert === null && previousAggregate === null) return null;
  return {
    data: {
      t3_kind: "agent_activity",
      device_id: input.deviceId,
      user_id: input.userId,
      updated_at: String(nowMs),
      ...androidActivityData(displayedAggregate),
      ...alert,
    },
    baseline: preferences.liveActivitiesEnabled ? aggregate : null,
  };
}

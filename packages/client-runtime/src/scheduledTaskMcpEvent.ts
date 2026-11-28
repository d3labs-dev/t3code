import type { ScheduledTask } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

type McpEventSchedule = Extract<ScheduledTask["schedule"], { readonly type: "mcp_event" }>;

/** Tasks the schedule form edits. A Bot owns its event tasks and changes them with `schedule_task`. */
export type FormScheduledTask = ScheduledTask & {
  readonly schedule: Exclude<ScheduledTask["schedule"], McpEventSchedule>;
};

export const isFormScheduledTask = (task: ScheduledTask): task is FormScheduledTask =>
  task.schedule.type !== "mcp_event";

/** Such as "On whatsapp.message.received (chatType=group) from executor". */
export function mcpEventScheduleLabel(
  schedule: McpEventSchedule,
  resolve: MFunctionType = mFallback,
): string {
  const filters = Object.entries(schedule.arguments).map(
    ([name, value]) => `${name}=${String(value)}`,
  );
  const { event, server } = schedule;
  return filters.length === 0
    ? resolve(msg("On {event} from {server}", { event, server }))
    : resolve(
        msg("On {event} ({filters}) from {server}", { event, filters: filters.join(", "), server }),
      );
}

export function mcpEventSubscriptionLabel(
  subscription: NonNullable<ScheduledTask["subscription"]>,
  resolve: MFunctionType = mFallback,
): string {
  switch (subscription.status) {
    case "active":
      return resolve(msg("Subscribed"));
    case "pending":
      return resolve(msg("Subscribing…"));
    case "failed":
      return resolve(msg("Subscription failed"));
  }
}

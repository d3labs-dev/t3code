import type { ScheduledTask } from "@t3tools/contracts";

type McpEventSchedule = Extract<ScheduledTask["schedule"], { readonly type: "mcp_event" }>;

/** Tasks the schedule form edits. A Bot owns its event tasks and changes them with `schedule_task`. */
export type FormScheduledTask = ScheduledTask & {
  readonly schedule: Exclude<ScheduledTask["schedule"], McpEventSchedule>;
};

export const isFormScheduledTask = (task: ScheduledTask): task is FormScheduledTask =>
  task.schedule.type !== "mcp_event";

/** Such as "On whatsapp.message.received (chatType=group) from executor". */
export function mcpEventScheduleLabel(schedule: McpEventSchedule): string {
  const filters = Object.entries(schedule.arguments).map(
    ([name, value]) => `${name}=${String(value)}`,
  );
  return `On ${schedule.event}${filters.length === 0 ? "" : ` (${filters.join(", ")})`} from ${schedule.server}`;
}

export function mcpEventSubscriptionLabel(
  subscription: NonNullable<ScheduledTask["subscription"]>,
): string {
  switch (subscription.status) {
    case "active":
      return "Subscribed";
    case "pending":
      return "Subscribing…";
    case "failed":
      return "Subscription failed";
  }
}

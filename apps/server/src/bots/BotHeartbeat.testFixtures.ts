import { BotId, type BotRecord, BotSlug, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { at, botThreadId } from "./BotDreaming.testFixtures.ts";

/** A proactive primary Bot active all day in UTC, checking in every 30 minutes. */
export const primaryBot: BotRecord = {
  id: BotId.make("kelsier"),
  slug: BotSlug.make("kelsier"),
  name: "Kelsier",
  role: "",
  groupName: null,
  icon: "bot",
  color: "blue",
  isPrimary: true,
  modelSelection: {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: "model",
    options: [{ id: "effort", value: "high" }],
  },
  runtimeMode: "full-access",
  tools: [],
  mcpServerNames: [],
  customMcpServers: {},
  skills: [],
  systemPromptMode: "custom",
  proactive: {
    enabled: true,
    intervalMinutes: 30,
    activeHoursStart: "00:00",
    activeHoursEnd: "00:00",
    timezone: "UTC",
  },
  muted: false,
  threadId: botThreadId,
  folderPath: "/bots/kelsier",
  hopCount: 0,
  archivedAt: null,
  createdAt: DateTime.formatIso(at()),
  updatedAt: DateTime.formatIso(at()),
};

import { ThreadId } from "@t3tools/contracts";

export type BotHandoffMessage =
  | {
      readonly kind: "from_bot";
      readonly botName: string;
      readonly botSlug: string;
      readonly hopCount: number;
      readonly hopLimit: number;
      readonly body: string;
    }
  | {
      readonly kind: "bot_reply";
      readonly botName: string;
      readonly botSlug: string;
      readonly status: string;
      readonly body: string;
    }
  | {
      readonly kind: "coding_thread_update";
      readonly title: string;
      readonly threadId: ThreadId;
      readonly status: string;
      readonly body: string;
    };

const FROM_BOT_HEADER =
  /^\[From Bot: (.+) \(([a-z0-9-]+)\), hop (\d+)\/(\d+)\.[^\]]*\]\r?\n\r?\n([\s\S]*)$/;
const BOT_REPLY_HEADER =
  /^\[Bot reply from (.+) \(([a-z0-9-]+)\), status: ([^\]]+)\]\r?\n\r?\n([\s\S]*)$/;
const CODING_THREAD_HEADER =
  /^\[Coding thread update: (.+) \(([^()]+)\), status: ([^\]]+)\]\r?\n\r?\n([\s\S]*)$/;

/** Parses Bot-to-Bot and coding-thread wake envelopes written by BotService. */
export function parseBotHandoffMessage(message: {
  readonly createdBy?: string | undefined;
  readonly text: string;
}): BotHandoffMessage | null {
  if (message.createdBy !== "agent") return null;
  const text = message.text;

  const fromBot = FROM_BOT_HEADER.exec(text);
  if (fromBot !== null) {
    return {
      kind: "from_bot",
      botName: fromBot[1]!.trim(),
      botSlug: fromBot[2]!,
      hopCount: Number.parseInt(fromBot[3]!, 10),
      hopLimit: Number.parseInt(fromBot[4]!, 10),
      body: fromBot[5]!.trim(),
    };
  }

  const botReply = BOT_REPLY_HEADER.exec(text);
  if (botReply !== null) {
    return {
      kind: "bot_reply",
      botName: botReply[1]!.trim(),
      botSlug: botReply[2]!,
      status: botReply[3]!.trim(),
      body: botReply[4]!.trim(),
    };
  }

  const codingUpdate = CODING_THREAD_HEADER.exec(text);
  if (codingUpdate !== null) {
    const rawThreadId = codingUpdate[2]!.trim();
    if (rawThreadId === "") return null;
    return {
      kind: "coding_thread_update",
      title: codingUpdate[1]!.trim(),
      threadId: ThreadId.make(rawThreadId),
      status: codingUpdate[3]!.trim(),
      body: codingUpdate[4]!.trim(),
    };
  }

  return null;
}

export function botHandoffPreviewLine(body: string): string {
  const first = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  return first ?? "";
}

const BOT_HANDOFF_STATUS_LABELS: Readonly<Record<string, string>> = {
  completed: "Completed",
  waiting: "Needs input",
  failed: "Failed",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
};

/** The status worth showing beside a handoff; a peer Bot's completed reply needs none. */
export function botHandoffStatusLabel(handoff: BotHandoffMessage): string | null {
  if (handoff.kind === "from_bot") return null;
  if (handoff.kind === "bot_reply" && handoff.status === "completed") return null;
  return BOT_HANDOFF_STATUS_LABELS[handoff.status] ?? handoff.status;
}

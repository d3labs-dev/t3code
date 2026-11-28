import type { MessageId, RunId } from "@t3tools/contracts";
import { isBotNoReplyMessage, serverBotPromptKind } from "@t3tools/shared/botProactive";

type BotRunMessage = Parameters<typeof serverBotPromptKind>[0] & {
  readonly id: MessageId;
  readonly runId: RunId | null;
  readonly streaming: boolean;
};

/**
 * Bot memory consolidations and check-ins run in the background, out of the Bot's chat. A run that
 * also carries someone's message is a conversation. A finished check-in whose last reply is a real
 * message keeps that reply, so the Bot reads as texting first.
 */
export function botBackgroundRuns(
  messagesInOrder: Iterable<BotRunMessage>,
  isLiveRun: (runId: RunId) => boolean,
): {
  readonly backgroundRunIds: ReadonlySet<RunId>;
  readonly checkInAnswerIds: ReadonlySet<MessageId>;
} {
  const backgroundRunIds = new Set<RunId>();
  const checkInRunIds = new Set<RunId>();
  const conversationRunIds = new Set<RunId>();
  const lastReplyByRun = new Map<RunId, BotRunMessage>();
  for (const message of messagesInOrder) {
    const runId = message.runId;
    if (runId === null) continue;
    if (message.role === "assistant") lastReplyByRun.set(runId, message);
    if (message.role !== "user") continue;
    const promptKind = serverBotPromptKind(message);
    if (promptKind === "dreaming") backgroundRunIds.add(runId);
    else if (promptKind === "checkIn") checkInRunIds.add(runId);
    else conversationRunIds.add(runId);
  }
  for (const runId of conversationRunIds) {
    backgroundRunIds.delete(runId);
    checkInRunIds.delete(runId);
  }
  const checkInAnswerIds = new Set<MessageId>();
  for (const runId of checkInRunIds) {
    backgroundRunIds.add(runId);
    const reply = lastReplyByRun.get(runId);
    if (
      reply !== undefined &&
      !isLiveRun(runId) &&
      !reply.streaming &&
      !isBotNoReplyMessage(reply.text)
    ) {
      checkInAnswerIds.add(reply.id);
    }
  }
  return { backgroundRunIds, checkInAnswerIds };
}

/** Server, web and mobile match this prefix to keep memory consolidation turns out of Bot chats. */
export const BOT_DREAMING_MESSAGE_PREFIX = "[Bot memory consolidation]";

export function isBotDreamingMessage(text: string): boolean {
  return text.trimStart().startsWith(BOT_DREAMING_MESSAGE_PREFIX);
}

/** A consolidation prompt the server itself sent, as opposed to someone typing the prefix. */
export function isServerBotDreamingMessage(message: {
  readonly role: string;
  readonly text: string;
  readonly createdBy?: string | undefined;
  readonly creationSource?: string | undefined;
}): boolean {
  return (
    message.role === "user" &&
    message.createdBy === "agent" &&
    message.creationSource === "server" &&
    isBotDreamingMessage(message.text)
  );
}

export const BOT_DREAMING_PROMPT = `${BOT_DREAMING_MESSAGE_PREFIX} You are idle. Consolidate your memory files now so you pick up cleanly next time:

1. Rewrite NOW.md with your active coding threads, open commitments, pending decisions, and the exact next action for each. Remove completed items and keep it under about 2 KB.
2. Promote durable facts, preferences, and decisions from the recent conversation into MEMORY.md. Keep MEMORY.md under about 4 KB as a clean index: move detailed project or topic notes into notes/<topic>.md and link them from MEMORY.md.
3. Prune entries that are stale or superseded.
4. Do not send bot_message or launch coding threads during this consolidation.

When you are done, reply with exactly NO_REPLY.`;

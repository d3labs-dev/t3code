import { SERVER_BOT_PROMPT_PREFIXES } from "./botProactive.ts";

export const BOT_DREAMING_PROMPT = `${SERVER_BOT_PROMPT_PREFIXES.dreaming} You are idle. Consolidate your memory files now so you pick up cleanly next time:

1. Rewrite NOW.md with your active coding threads, open commitments, pending decisions, and the exact next action for each. Remove completed items and keep it under about 2 KB.
2. Promote durable facts, preferences, and decisions from the recent conversation into MEMORY.md. Keep MEMORY.md under about 4 KB as a clean index: move detailed project or topic notes into notes/<topic>.md and link them from MEMORY.md.
3. Prune entries that are stale or superseded.
4. Do not send bot_message or launch coding threads during this consolidation.

When you are done, reply with exactly NO_REPLY.`;

import {
  BOT_DOCUMENTS,
  type BotDocuments,
  type BotRecord,
  type BotUpdateInput,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Record from "effect/Record";

import { BOT_AVATAR_COLORS, BOT_AVATAR_SHAPES, BOT_THEME_COLOR } from "./botAvatar.ts";
import type { ScopedBotEntry } from "./state/bots.ts";

type BotSettingsField = Exclude<keyof BotRecord & keyof BotUpdateInput, "slug">;
export type BotSettingsPatch = Partial<Pick<BotRecord, BotSettingsField>>;

export type BotDocumentName = keyof BotDocuments;
export type BotDocumentDrafts = { [Name in BotDocumentName]?: string };

const DOCUMENT_PLACEHOLDERS: { readonly [Name in BotDocumentName]: string } = {
  soul: "Who is this Bot? How should it think, talk and decide?",
  now: "Active threads, open commitments, and next actions (kept concise).",
  memory: "What should this Bot remember between conversations?",
  heartbeat: "What should this Bot keep an eye on during proactive check-ins?",
};

const DOCUMENT_FIELDS = Record.toEntries(BOT_DOCUMENTS).map(([id, document]) => ({
  id,
  ...document,
  placeholder: DOCUMENT_PLACEHOLDERS[id],
}));

/** The documents a Bot's settings show; only the primary Bot has a heartbeat. */
export function botDocumentFields(isPrimary: boolean) {
  return DOCUMENT_FIELDS.filter((document) => isPrimary || !document.primaryOnly);
}

function changedFields(bot: BotRecord, patch: BotSettingsPatch): BotSettingsPatch {
  const changes: { [field: string]: unknown } = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined && !Equal.equals(value, bot[field as BotSettingsField])) {
      changes[field] = value;
    }
  }
  return changes as BotSettingsPatch;
}

function updateInput(
  bot: BotRecord,
  changes: BotSettingsPatch,
  drafts: BotDocumentDrafts,
  dirtyDocuments: ReadonlyArray<BotDocumentName>,
): BotUpdateInput {
  const groupName = changes.groupName === undefined ? undefined : changes.groupName?.trim() || null;
  const documents: BotDocumentDrafts = {};
  for (const id of dirtyDocuments) documents[id] = drafts[id] ?? "";
  return {
    botId: bot.id,
    ...changes,
    ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
    ...(groupName === undefined ? {} : { groupName }),
    ...(dirtyDocuments.length === 0 ? {} : { documents }),
  };
}

function withoutDrafts(
  drafts: BotDocumentDrafts,
  ids: ReadonlyArray<BotDocumentName>,
): BotDocumentDrafts {
  const remaining = { ...drafts };
  for (const id of ids) delete remaining[id];
  return remaining;
}

/**
 * What a Bot's settings show and would save, from its unsaved edits. A saved draft stays on
 * screen until the refreshed documents return the same text; `pendingDrafts` drops those.
 */
export function botSettingsForm(
  bot: BotRecord,
  patch: BotSettingsPatch,
  savedDocuments: BotDocuments | null,
  drafts: BotDocumentDrafts,
) {
  const draftedIds = DOCUMENT_FIELDS.map(({ id }) => id).filter((id) => drafts[id] !== undefined);
  const settled = draftedIds.filter((id) => savedDocuments?.[id] === drafts[id]);
  const dirtyDocuments = draftedIds.filter((id) => savedDocuments?.[id] !== drafts[id]);
  const changes = changedFields(bot, patch);
  const changeCount = Object.keys(changes).length + dirtyDocuments.length;
  const shown = { ...bot, ...patch };
  const nameMissing = shown.name.trim() === "";
  return {
    shown,
    nameMissing,
    changeCount,
    dirtyDocuments,
    pendingDrafts: settled.length === 0 ? drafts : withoutDrafts(drafts, settled),
    saveInput:
      changeCount === 0 || nameMissing ? null : updateInput(bot, changes, drafts, dirtyDocuments),
  };
}

const SUGGESTED_BOT_GROUPS = ["Engineering", "Operations", "Creative"];

/** The groups this environment's active Bots already use, or starter names when there are none. */
export function botGroupSuggestions(
  bots: ReadonlyArray<ScopedBotEntry>,
  environmentId: EnvironmentId | null,
): ReadonlyArray<string> {
  const existing = [
    ...new Set(
      bots.flatMap(({ environmentId: botEnvironmentId, bot }) =>
        botEnvironmentId === environmentId && bot.groupName !== null && bot.archivedAt === null
          ? [bot.groupName]
          : [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  return existing.length > 0 ? existing : SUGGESTED_BOT_GROUPS;
}

const RANDOM_COLORS = BOT_AVATAR_COLORS.flatMap((option) =>
  option.value === BOT_THEME_COLOR ? [] : [option.value],
);

/** A different shape and solid color for the new-Bot shuffle; `random` behaves like Math.random. */
export function shuffleBotIdentity(
  current: { readonly icon: string; readonly color: string },
  random: () => number,
) {
  const pickOther = (options: ReadonlyArray<string>, value: string) => {
    const others = options.filter((option) => option !== value);
    return others[Math.floor(random() * others.length)] ?? value;
  };
  return {
    icon: pickOther(
      BOT_AVATAR_SHAPES.map((shape) => shape.id),
      current.icon,
    ),
    color: pickOther(RANDOM_COLORS, current.color),
  };
}

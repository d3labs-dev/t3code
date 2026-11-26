import { useAtomValue } from "@effect/atom-react";
import type { ScopedBotEntry } from "@t3tools/client-runtime/state/bots";
import type { BotDocuments } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, FolderIcon, Maximize2Icon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { botsEnvironment, useBotDetail } from "../../state/bots";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useUpdateBot } from "./botActions";

type BotDocumentName = keyof BotDocuments;

const DOCUMENTS = [
  {
    id: "soul",
    file: "SOUL.md",
    placeholder: "Who is this Bot? How should it think, talk and decide?",
  },
  {
    id: "memory",
    file: "MEMORY.md",
    placeholder: "What should this Bot remember between conversations?",
  },
] as const satisfies ReadonlyArray<{ id: BotDocumentName; file: string; placeholder: string }>;

type DocumentDrafts = Partial<Record<BotDocumentName, string>>;

export function BotSoulTab({ entry }: { readonly entry: ScopedBotEntry }) {
  const { bot, environmentId } = entry;
  const detail = useBotDetail(environmentId, bot.id);
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const update = useUpdateBot();
  const [drafts, setDrafts] = useState<DocumentDrafts>({});
  const [expanded, setExpanded] = useState<BotDocumentName | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = detail.data?.documents ?? null;
  // A saved draft stays on screen until the refreshed detail returns the same text.
  const settled = DOCUMENTS.filter(
    ({ id }) => drafts[id] !== undefined && saved !== null && saved[id] === drafts[id],
  );
  if (settled.length > 0) {
    setDrafts((current) => {
      const next = { ...current };
      for (const { id } of settled) delete next[id];
      return next;
    });
  }
  const dirty = DOCUMENTS.filter(
    ({ id }) => drafts[id] !== undefined && drafts[id] !== saved?.[id],
  );
  const valueOf = (id: BotDocumentName) => drafts[id] ?? saved?.[id] ?? "";
  const editable = canUpdate && saved !== null && !saving;

  const save = async () => {
    if (dirty.length === 0 || saving) return;
    const isDirty = (name: BotDocumentName) => dirty.some(({ id }) => id === name);
    const documents = {
      ...(isDirty("soul") && drafts.soul !== undefined ? { soul: drafts.soul } : {}),
      ...(isDirty("memory") && drafts.memory !== undefined ? { memory: drafts.memory } : {}),
    };
    setSaving(true);
    await update(environmentId, { botId: bot.id, documents }, "Could not save Bot documents");
    setSaving(false);
  };

  const expandedDocument = DOCUMENTS.find(({ id }) => id === expanded) ?? null;

  return (
    <>
      <ThreadDetailsSection headingId="bot-details-folder-heading" title="Folder" separated={false}>
        <BotFolderPill path={bot.folderPath} />
      </ThreadDetailsSection>
      {DOCUMENTS.map((document) => (
        <ThreadDetailsSection
          key={document.id}
          headingId={`bot-details-${document.id}-heading`}
          title={document.file}
          actions={
            <>
              {dirty.some(({ id }) => id === document.id) ? (
                <span className="flex items-center gap-1 text-2xs text-warning-foreground">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                  Unsaved
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ThreadDetailsControl
                      size="icon-xs"
                      variant="ghost"
                      part="icon"
                      aria-label={`Expand ${document.file}`}
                      disabled={saved === null}
                      onClick={() => setExpanded(document.id)}
                    >
                      <Maximize2Icon className="size-3.5" aria-hidden />
                    </ThreadDetailsControl>
                  }
                />
                <TooltipPopup>Expand</TooltipPopup>
              </Tooltip>
            </>
          }
        >
          <div className="px-2.5">
            {detail.error !== null && saved === null ? (
              <p className="text-2xs text-destructive">
                Could not load {document.file}: {detail.error}
              </p>
            ) : (
              <Textarea
                size="sm"
                rows={6}
                className="max-h-72"
                aria-label={document.file}
                placeholder={saved === null ? "Loading…" : document.placeholder}
                disabled={!editable}
                value={valueOf(document.id)}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDrafts((current) => ({ ...current, [document.id]: value }));
                }}
              />
            )}
          </div>
        </ThreadDetailsSection>
      ))}
      <div className="flex items-center justify-end gap-2 px-4 pt-1 pb-3">
        {dirty.length > 0 ? (
          <Button size="xs" variant="ghost-muted" disabled={saving} onClick={() => setDrafts({})}>
            Discard
          </Button>
        ) : null}
        <Button
          size="xs"
          disabled={!canUpdate || dirty.length === 0 || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <Dialog open={expandedDocument !== null} onOpenChange={(open) => !open && setExpanded(null)}>
        <DialogPopup className="max-w-3xl">
          {expandedDocument ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {bot.name} · {expandedDocument.file}
                </DialogTitle>
                <DialogDescription>{bot.folderPath}</DialogDescription>
              </DialogHeader>
              <DialogPanel>
                <Textarea
                  rows={22}
                  aria-label={expandedDocument.file}
                  placeholder={expandedDocument.placeholder}
                  disabled={!editable}
                  value={valueOf(expandedDocument.id)}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDrafts((current) => ({ ...current, [expandedDocument.id]: value }));
                  }}
                />
              </DialogPanel>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setExpanded(null)}>
                  Close
                </Button>
                <Button
                  disabled={!canUpdate || dirty.length === 0 || saving}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function BotFolderPill({ path }: { readonly path: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "Bot folder path" });
  return (
    <ThreadDetailsControl
      variant="ghost"
      aria-label="Copy folder path"
      onClick={() => copyToClipboard(path)}
    >
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <StartTruncatedPath path={path} className="flex-1 font-mono text-xs" />
      {isCopied ? (
        <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </ThreadDetailsControl>
  );
}

import { useAtomValue } from "@effect/atom-react";
import { type ScopedBotEntry, botKey } from "@t3tools/client-runtime/state/bots";
import {
  BOT_DEFAULT_TOOLS,
  type BotDocuments,
  type BotRecord,
  type BotSystemPromptMode,
  type BotUpdateInput,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  CopyIcon,
  FolderIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { botsEnvironment, useBotDetail, useBotsIndex } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingsRow } from "../settings/settingsLayout";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { Toggle as SegmentToggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { BotAvatar } from "./BotAvatar";
import { reportBotFailure, useOpenThreadInMode, useUpdateBot } from "./botActions";
import {
  BotField,
  BotMcpServerChecklist,
  BotModelPicker,
  useBotModelChoice,
} from "./botFormControls";
import { BotIdentityPicker } from "./BotIdentityPicker";
import { type BotSettingsTab, useBotsUiStore } from "./botsUiStore";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "soul", label: "Soul & Memory" },
  { id: "capabilities", label: "Capabilities" },
] as const satisfies ReadonlyArray<{ id: BotSettingsTab; label: string }>;

type EditableBotField =
  | "name"
  | "role"
  | "groupName"
  | "icon"
  | "color"
  | "isPrimary"
  | "muted"
  | "modelSelection"
  | "runtimeMode"
  | "systemPromptMode"
  | "tools"
  | "mcpServerNames"
  | "skills";

type BotRecordPatch = Partial<Pick<BotRecord, EditableBotField>>;

type BotDocumentName = keyof BotDocuments;
type DocumentDrafts = Partial<Record<BotDocumentName, string>>;

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

const SYSTEM_PROMPT_MODES: Record<BotSystemPromptMode, string> = {
  custom: "Custom (lightweight)",
  preset: "Claude Code preset",
};

function changedFields(bot: BotRecord, patch: BotRecordPatch): BotRecordPatch {
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined && !Equal.equals(value, bot[field as EditableBotField])) {
      changes[field] = value;
    }
  }
  return changes as BotRecordPatch;
}

export function BotSettingsDialog() {
  const target = useBotsUiStore((state) => state.botSettings);
  const index = useBotsIndex();
  const entry =
    target === null
      ? null
      : (index.bots.find(
          (candidate) =>
            candidate.environmentId === target.environmentId && candidate.bot.id === target.botId,
        ) ?? null);
  if (target === null || entry === null) return null;
  return (
    <BotSettingsDialogBody
      key={botKey(entry.environmentId, entry.bot.id)}
      entry={entry}
      initialTab={target.tab}
    />
  );
}

function BotSettingsDialogBody(props: {
  readonly entry: ScopedBotEntry;
  readonly initialTab: BotSettingsTab;
}) {
  const { bot, environmentId } = props.entry;
  const open = useBotsUiStore((state) => state.botSettingsOpen);
  const close = useBotsUiStore((state) => state.closeBotSettings);
  const clear = useBotsUiStore((state) => state.clearBotSettings);
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const detail = useBotDetail(environmentId, bot.id);
  const update = useUpdateBot();
  const [tab, setTab] = useState<BotSettingsTab>(props.initialTab);
  const [patch, setPatch] = useState<BotRecordPatch>({});
  const [documentDrafts, setDocumentDrafts] = useState<DocumentDrafts>({});
  const [busy, setBusy] = useState(false);

  const savedDocuments = detail.data?.documents ?? null;
  // A saved draft stays on screen until the refreshed detail returns the same text.
  const settled = DOCUMENTS.filter(
    ({ id }) =>
      documentDrafts[id] !== undefined &&
      savedDocuments !== null &&
      savedDocuments[id] === documentDrafts[id],
  );
  if (settled.length > 0) {
    setDocumentDrafts((current) => {
      const next = { ...current };
      for (const { id } of settled) delete next[id];
      return next;
    });
  }
  const dirtyDocuments = DOCUMENTS.filter(
    ({ id }) => documentDrafts[id] !== undefined && documentDrafts[id] !== savedDocuments?.[id],
  );
  const changes = changedFields(bot, patch);
  const changeCount = Object.keys(changes).length + dirtyDocuments.length;
  const shown = { ...bot, ...patch };
  const nameMissing = shown.name.trim() === "";

  const requestClose = async () => {
    if (changeCount > 0) {
      const discard =
        (await requestConfirmDialog(`Discard unsaved changes to ${bot.name}?`, {
          variant: "destructive",
        })) ?? true;
      if (!discard) return;
    }
    close();
  };

  const discard = () => {
    setPatch({});
    setDocumentDrafts({});
  };

  const save = async () => {
    if (changeCount === 0 || nameMissing || busy) return;
    const groupName =
      changes.groupName === undefined ? undefined : changes.groupName?.trim() || null;
    const documents: DocumentDrafts = {};
    for (const { id } of dirtyDocuments) documents[id] = documentDrafts[id] ?? "";
    const input: BotUpdateInput = {
      botId: bot.id,
      ...changes,
      ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
      ...(groupName === undefined ? {} : { groupName }),
      ...(dirtyDocuments.length === 0 ? {} : { documents }),
    };
    setBusy(true);
    const saved = await update(environmentId, input, "Could not save Bot settings");
    setBusy(false);
    if (saved) setPatch({});
  };

  const editable = canUpdate && !busy;
  const set = (next: BotRecordPatch) => setPatch((current) => ({ ...current, ...next }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void requestClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) clear();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title={`${bot.name} settings`}
          identity={
            <div className="flex min-w-0 items-center gap-3 pe-8">
              <BotAvatar
                icon={shown.icon}
                color={shown.color}
                size="lg"
                status={props.entry.status}
                muted={shown.muted}
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-base font-semibold text-foreground">
                  {shown.name.trim() || bot.name}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  @{bot.slug}
                </span>
              </div>
              {bot.archivedAt !== null ? (
                <Badge size="sm" variant="outline">
                  Archived
                </Badge>
              ) : null}
            </div>
          }
        >
          <ToggleGroup
            aria-label="Bot settings section"
            className="mt-3 w-full"
            value={[tab]}
            onValueChange={(values) => {
              const next = TABS.find((option) => option.id === values[0]);
              if (next) setTab(next.id);
            }}
          >
            {TABS.map((option) => (
              <SegmentToggle key={option.id} value={option.id} className="flex-1">
                {option.label}
                {option.id === "soul" && dirtyDocuments.length > 0 ? (
                  <span className="size-1.5 rounded-full bg-warning" aria-label="Unsaved" />
                ) : null}
              </SegmentToggle>
            ))}
          </ToggleGroup>
        </WizardHeader>
        <WizardPanel>
          {tab === "profile" ? (
            <ProfileSection entry={props.entry} shown={shown} editable={editable} set={set} />
          ) : tab === "soul" ? (
            <SoulSection
              folderPath={bot.folderPath}
              saved={savedDocuments}
              loadError={savedDocuments === null ? detail.error : null}
              drafts={documentDrafts}
              dirty={dirtyDocuments.map(({ id }) => id)}
              editable={editable && savedDocuments !== null}
              onChange={(id, value) =>
                setDocumentDrafts((current) => ({ ...current, [id]: value }))
              }
            />
          ) : (
            <CapabilitiesSection entry={props.entry} shown={shown} editable={editable} set={set} />
          )}
        </WizardPanel>
        <WizardFooter
          leading={
            <span className="self-center text-xs text-muted-foreground">
              {nameMissing
                ? "A Bot needs a name."
                : changeCount === 0
                  ? "All changes saved"
                  : `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`}
            </span>
          }
        >
          {changeCount > 0 ? (
            <Button variant="ghost" disabled={busy} onClick={discard}>
              Discard
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void requestClose()}>
            Close
          </Button>
          <Button
            disabled={!canUpdate || changeCount === 0 || nameMissing || busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

function ProfileSection(props: {
  readonly entry: ScopedBotEntry;
  readonly shown: BotRecord;
  readonly editable: boolean;
  readonly set: (patch: BotRecordPatch) => void;
}) {
  const { shown, editable, set } = props;
  const visualStyle = useBotsUiStore((state) => state.visualStyle);
  const setVisualStyle = useBotsUiStore((state) => state.setVisualStyle);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-stretch">
        <div className="flex shrink-0 items-center justify-center rounded-2xl bg-muted/30 py-6 sm:w-40">
          <BotAvatar icon={shown.icon} color={shown.color} size="xl" muted={shown.muted} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <BotField label="Name" htmlFor="bot-settings-name">
            <Input
              id="bot-settings-name"
              disabled={!editable}
              aria-invalid={shown.name.trim() === "" || undefined}
              value={shown.name}
              onChange={(event) => set({ name: event.currentTarget.value })}
            />
          </BotField>
          <BotField label="Role" htmlFor="bot-settings-role">
            <Input
              id="bot-settings-role"
              placeholder="Chief of Staff, Designer, Engineering Lead"
              disabled={!editable}
              value={shown.role}
              onChange={(event) => set({ role: event.currentTarget.value })}
            />
          </BotField>
          <BotField label="Group" htmlFor="bot-settings-group">
            <Input
              id="bot-settings-group"
              placeholder="Ungrouped"
              disabled={!editable}
              value={shown.groupName ?? ""}
              onChange={(event) =>
                set({
                  groupName: event.currentTarget.value === "" ? null : event.currentTarget.value,
                })
              }
            />
          </BotField>
        </div>
      </div>
      <BotIdentityPicker
        icon={shown.icon}
        color={shown.color}
        disabled={!editable}
        onIconChange={(icon) => set({ icon })}
        onColorChange={(color) => set({ color })}
        visualStyle={visualStyle}
        onVisualStyleChange={setVisualStyle}
      />
      <SettingsGroup>
        <SettingsRow
          title="Primary Bot"
          description="Pinned to the top of the Bots sidebar."
          control={
            <Switch
              aria-label="Primary Bot"
              checked={shown.isPrimary}
              disabled={!editable}
              onCheckedChange={(isPrimary) => set({ isPrimary })}
            />
          }
        />
        <SettingsRow
          title="Muted"
          description="Shown asleep and dimmed in the sidebar."
          control={
            <Switch
              aria-label="Muted"
              checked={shown.muted}
              disabled={!editable}
              onCheckedChange={(muted) => set({ muted })}
            />
          }
        />
      </SettingsGroup>
      <BotDangerZone entry={props.entry} />
    </div>
  );
}

function BotDangerZone({ entry }: { readonly entry: ScopedBotEntry }) {
  const { bot, environmentId } = entry;
  const index = useBotsIndex();
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const canDelete = useAtomValue(botsEnvironment.deleteBot.permissionAtom(environmentId));
  const update = useUpdateBot();
  const deleteBot = useAtomCommand(botsEnvironment.deleteBot, {
    label: "bot delete",
    reportFailure: false,
  });
  const close = useBotsUiStore((state) => state.closeBotSettings);
  const openThread = useOpenThreadInMode();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const archived = bot.archivedAt !== null;

  const setArchived = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    const changed = await update(
      environmentId,
      { botId: bot.id, archived: next },
      next ? "Could not archive Bot" : "Could not restore Bot",
    );
    setBusy(false);
    if (!changed || !next) return;
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Archived ${bot.name}`,
        actionProps: {
          children: "Undo",
          onClick: () => {
            void update(environmentId, { botId: bot.id, archived: false }, "Could not restore Bot");
          },
        },
      }),
    );
  };

  const remove = async () => {
    if (busy) return;
    const confirmed =
      (await requestConfirmDialog(
        `Delete ${bot.name}? Its thread is archived and it stops watching its coding threads. Its folder stays on disk.`,
        { variant: "destructive" },
      )) ?? false;
    if (!confirmed) return;
    setBusy(true);
    const result = await deleteBot({ environmentId, input: { botId: bot.id } });
    setBusy(false);
    if (result._tag === "Failure") {
      reportBotFailure("Could not delete Bot", result);
      return;
    }
    close();
    const nextPrimary = index.bots.find(
      (candidate) =>
        candidate.bot.isPrimary && candidate.bot.archivedAt === null && candidate.bot.id !== bot.id,
    );
    if (nextPrimary) openThread("bots", nextPrimary.environmentId, nextPrimary.bot.threadId);
    else void navigate({ to: "/" });
  };

  return (
    <SettingsGroup>
      <SettingsRow
        title={archived ? "Restore Bot" : "Archive Bot"}
        description={
          archived
            ? "Brings this Bot back to the sidebar."
            : "Hides this Bot from the sidebar. You can restore it later."
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!canUpdate || busy}
            onClick={() => void setArchived(!archived)}
          >
            {archived ? <ArchiveRestoreIcon aria-hidden /> : <ArchiveIcon aria-hidden />}
            {archived ? "Restore" : "Archive"}
          </Button>
        }
      />
      <SettingsRow
        title="Delete Bot"
        description="Archives its thread and stops its watches. Its folder stays on disk."
        control={
          <Button
            size="sm"
            variant="destructive-outline"
            disabled={!canDelete || busy}
            onClick={() => void remove()}
          >
            <Trash2Icon aria-hidden />
            Delete
          </Button>
        }
      />
    </SettingsGroup>
  );
}

function SoulSection(props: {
  readonly folderPath: string;
  readonly saved: BotDocuments | null;
  readonly loadError: string | null;
  readonly drafts: DocumentDrafts;
  readonly dirty: ReadonlyArray<BotDocumentName>;
  readonly editable: boolean;
  readonly onChange: (id: BotDocumentName, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <BotFolderPath path={props.folderPath} />
      {DOCUMENTS.map((document) => (
        <div key={document.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label
              htmlFor={`bot-settings-${document.id}`}
              className="font-mono text-xs font-medium text-muted-foreground"
            >
              {document.file}
            </label>
            {props.dirty.includes(document.id) ? (
              <span className="flex items-center gap-1 text-2xs text-warning-foreground">
                <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                Unsaved
              </span>
            ) : null}
          </div>
          {props.loadError !== null ? (
            <p className="text-xs text-destructive">
              Could not load {document.file}: {props.loadError}
            </p>
          ) : (
            <Textarea
              id={`bot-settings-${document.id}`}
              rows={document.id === "soul" ? 12 : 8}
              placeholder={props.saved === null ? "Loading…" : document.placeholder}
              disabled={!props.editable}
              value={props.drafts[document.id] ?? props.saved?.[document.id] ?? ""}
              onChange={(event) => props.onChange(document.id, event.currentTarget.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function BotFolderPath({ path }: { readonly path: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "Bot folder path" });
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/60 bg-muted/30 py-1 ps-3 pe-1">
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <StartTruncatedPath path={path} className="min-w-0 flex-1 font-mono text-xs" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Copy folder path"
              onClick={() => copyToClipboard(path)}
            />
          }
        >
          {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        </TooltipTrigger>
        <TooltipPopup>{isCopied ? "Copied" : "Copy path"}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ChipInput(props: {
  readonly label: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const add = () => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    props.onAdd(trimmed);
    setValue("");
  };
  return (
    <div className="flex max-w-sm items-center gap-1">
      <Input
        size="sm"
        aria-label={props.label}
        placeholder={props.placeholder}
        disabled={props.disabled}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          add();
        }}
      />
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={props.label}
        disabled={props.disabled || value.trim() === ""}
        onClick={add}
      >
        <PlusIcon aria-hidden />
      </Button>
    </div>
  );
}

function CapabilitiesSection(props: {
  readonly entry: ScopedBotEntry;
  readonly shown: BotRecord;
  readonly editable: boolean;
  readonly set: (patch: BotRecordPatch) => void;
}) {
  const { shown, editable, set } = props;
  const { environmentId } = props.entry;
  const index = useBotsIndex();
  const model = useBotModelChoice(environmentId, shown.modelSelection);
  const availableMcpServers = index.availableMcpServersByEnvironment.get(environmentId) ?? [];
  const toolNames = [...new Set([...BOT_DEFAULT_TOOLS, ...shown.tools])];
  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup>
        <SettingsRow
          title="Model"
          description="Runs every turn of this Bot."
          control={
            <BotModelPicker
              environmentId={environmentId}
              selection={model.selection}
              instanceEntries={model.instanceEntries}
              modelOptionsByInstance={model.modelOptionsByInstance}
              disabled={!editable}
              onChange={(modelSelection) => set({ modelSelection })}
            />
          }
        />
        <SettingsRow
          title="Runtime permissions"
          description="What the Bot may do without asking."
          control={
            <Select
              value={shown.runtimeMode}
              disabled={!editable}
              onValueChange={(value) => {
                const runtimeMode = runtimeModeOptions.find((mode) => mode === value);
                if (runtimeMode) set({ runtimeMode });
              }}
            >
              <SelectTrigger aria-label="Runtime permissions">
                <SelectValue>{runtimeModeConfig[shown.runtimeMode].label}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {runtimeModeOptions.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {runtimeModeConfig[mode].label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="System prompt"
          description="Custom keeps turns light. The preset adds Claude Code's full instructions."
          control={
            <Select
              value={shown.systemPromptMode}
              disabled={!editable}
              onValueChange={(value) => {
                if (value === "custom" || value === "preset") set({ systemPromptMode: value });
              }}
            >
              <SelectTrigger aria-label="System prompt">
                <SelectValue>{SYSTEM_PROMPT_MODES[shown.systemPromptMode]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {Object.entries(SYSTEM_PROMPT_MODES).map(([mode, label]) => (
                  <SelectItem key={mode} value={mode}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsGroup>
      <BotField label="Built-in tools">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {toolNames.map((tool) => (
              <Toggle
                key={tool}
                size="xs"
                variant="outline"
                disabled={!editable}
                pressed={shown.tools.includes(tool)}
                onPressedChange={(pressed) =>
                  set({
                    tools: pressed
                      ? [...shown.tools.filter((name) => name !== tool), tool]
                      : shown.tools.filter((name) => name !== tool),
                  })
                }
              >
                {tool}
              </Toggle>
            ))}
          </div>
          <ChipInput
            label="Add tool"
            placeholder="Add a tool, like NotebookEdit"
            disabled={!editable}
            onAdd={(tool) => set({ tools: [...shown.tools.filter((name) => name !== tool), tool] })}
          />
        </div>
      </BotField>
      <BotField label="MCP servers">
        <BotMcpServerChecklist
          available={availableMcpServers}
          selected={shown.mcpServerNames}
          disabled={!editable}
          onChange={(mcpServerNames) => set({ mcpServerNames })}
        />
      </BotField>
      <BotField label="Skills">
        <div className="flex flex-col gap-2">
          {shown.skills.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {shown.skills.map((skill) => (
                <Badge key={skill} variant="outline" size="lg">
                  {skill}
                  <Button
                    size="icon-tiny"
                    variant="ghost-muted"
                    aria-label={`Remove ${skill}`}
                    disabled={!editable}
                    onClick={() => set({ skills: shown.skills.filter((name) => name !== skill) })}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No skills yet.</p>
          )}
          <ChipInput
            label="Add skill"
            placeholder="Add a skill by name"
            disabled={!editable}
            onAdd={(skill) =>
              set({ skills: [...shown.skills.filter((name) => name !== skill), skill] })
            }
          />
        </div>
      </BotField>
    </div>
  );
}

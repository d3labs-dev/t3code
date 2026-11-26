import { useAtomValue } from "@effect/atom-react";
import type { ScopedBotEntry } from "@t3tools/client-runtime/state/bots";
import {
  BOT_DEFAULT_TOOLS,
  type BotRecord,
  type BotSystemPromptMode,
  type BotUpdateInput,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";
import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { botsEnvironment, useBotsIndex } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { reportBotFailure, useOpenThreadInMode, useUpdateBot } from "./botActions";
import {
  BotField,
  BotMcpServerChecklist,
  BotModelPicker,
  useBotModelChoice,
} from "./botFormControls";
import { BotIdentityPicker } from "./BotIdentityPicker";
import { useBotsUiStore } from "./botsUiStore";

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

type BotConfigPatch = Partial<Pick<BotRecord, EditableBotField>>;

const SYSTEM_PROMPT_MODES: Record<BotSystemPromptMode, string> = {
  custom: "Custom (lightweight)",
  preset: "Claude Code preset",
};

function changedFields(bot: BotRecord, patch: BotConfigPatch): BotConfigPatch {
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined && !Equal.equals(value, bot[field as EditableBotField])) {
      changes[field] = value;
    }
  }
  return changes as BotConfigPatch;
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
    <div className="flex items-center gap-1">
      <Input
        size="compact"
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

export function BotConfigTab({ entry }: { readonly entry: ScopedBotEntry }) {
  const { bot, environmentId } = entry;
  const index = useBotsIndex();
  const canUpdate = useAtomValue(botsEnvironment.updateBot.permissionAtom(environmentId));
  const canDelete = useAtomValue(botsEnvironment.deleteBot.permissionAtom(environmentId));
  const visualStyle = useBotsUiStore((state) => state.visualStyle);
  const setVisualStyle = useBotsUiStore((state) => state.setVisualStyle);
  const update = useUpdateBot();
  const deleteBot = useAtomCommand(botsEnvironment.deleteBot, {
    label: "bot delete",
    reportFailure: false,
  });
  const openThread = useOpenThreadInMode();
  const navigate = useNavigate();
  const [patch, setPatch] = useState<BotConfigPatch>({});
  const [busy, setBusy] = useState(false);
  const shown = { ...bot, ...patch };
  const changes = changedFields(bot, patch);
  const changeCount = Object.keys(changes).length;
  const nameMissing = shown.name.trim() === "";
  const editable = canUpdate && !busy;
  const set = (next: BotConfigPatch) => setPatch((current) => ({ ...current, ...next }));
  const model = useBotModelChoice(environmentId, shown.modelSelection);
  const availableMcpServers = index.availableMcpServersByEnvironment.get(environmentId) ?? [];
  const toolNames = [...new Set([...BOT_DEFAULT_TOOLS, ...shown.tools])];

  const save = async () => {
    if (changeCount === 0 || nameMissing || busy) return;
    const groupName =
      changes.groupName === undefined ? undefined : changes.groupName?.trim() || null;
    const input: BotUpdateInput = {
      botId: bot.id,
      ...changes,
      ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
      ...(groupName === undefined ? {} : { groupName }),
    };
    setBusy(true);
    const saved = await update(environmentId, input, "Could not save Bot config");
    setBusy(false);
    if (saved) setPatch({});
  };

  const archive = async () => {
    if (busy) return;
    setBusy(true);
    const archived = await update(
      environmentId,
      { botId: bot.id, archived: true },
      "Could not archive Bot",
    );
    setBusy(false);
    if (!archived) return;
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

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    await update(environmentId, { botId: bot.id, archived: false }, "Could not restore Bot");
    setBusy(false);
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
    const nextPrimary = index.bots.find(
      (candidate) =>
        candidate.bot.isPrimary && candidate.bot.archivedAt === null && candidate.bot.id !== bot.id,
    );
    if (nextPrimary) openThread("bots", nextPrimary.environmentId, nextPrimary.bot.threadId);
    else void navigate({ to: "/" });
  };

  return (
    <>
      <ThreadDetailsSection
        headingId="bot-config-identity-heading"
        title="Identity"
        separated={false}
      >
        <div className="flex flex-col gap-3 px-2.5">
          <BotField label="Name" htmlFor="bot-config-name">
            <Input
              id="bot-config-name"
              size="sm"
              disabled={!editable}
              aria-invalid={nameMissing || undefined}
              value={shown.name}
              onChange={(event) => set({ name: event.currentTarget.value })}
            />
          </BotField>
          <BotField label="Role" htmlFor="bot-config-role">
            <Input
              id="bot-config-role"
              size="sm"
              placeholder="Triages work and delegates coding tasks"
              disabled={!editable}
              value={shown.role}
              onChange={(event) => set({ role: event.currentTarget.value })}
            />
          </BotField>
          <BotField label="Group" htmlFor="bot-config-group">
            <Input
              id="bot-config-group"
              size="sm"
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
          <label className="flex items-center justify-between gap-2 text-sm text-foreground/80">
            Primary Bot
            <Switch
              size="sm"
              checked={shown.isPrimary}
              disabled={!editable}
              onCheckedChange={(isPrimary) => set({ isPrimary })}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-sm text-foreground/80">
            Muted
            <Switch
              size="sm"
              checked={shown.muted}
              disabled={!editable}
              onCheckedChange={(muted) => set({ muted })}
            />
          </label>
        </div>
      </ThreadDetailsSection>
      <ThreadDetailsSection headingId="bot-config-look-heading" title="Look">
        <div className="px-2.5">
          <BotIdentityPicker
            icon={shown.icon}
            color={shown.color}
            disabled={!editable}
            onIconChange={(icon) => set({ icon })}
            onColorChange={(color) => set({ color })}
            visualStyle={visualStyle}
            onVisualStyleChange={setVisualStyle}
          />
        </div>
      </ThreadDetailsSection>
      <ThreadDetailsSection headingId="bot-config-runtime-heading" title="Runtime">
        <div className="flex flex-col gap-3 px-2.5">
          <BotField label="Model">
            <div>
              <BotModelPicker
                environmentId={environmentId}
                selection={model.selection}
                instanceEntries={model.instanceEntries}
                modelOptionsByInstance={model.modelOptionsByInstance}
                disabled={!editable}
                onChange={(modelSelection) => set({ modelSelection })}
              />
            </div>
          </BotField>
          <BotField label="Permissions">
            <Select
              value={shown.runtimeMode}
              disabled={!editable}
              onValueChange={(value) => {
                const runtimeMode = runtimeModeOptions.find((mode) => mode === value);
                if (runtimeMode) set({ runtimeMode });
              }}
            >
              <SelectTrigger size="sm" aria-label="Permissions">
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
          </BotField>
          <BotField label="System prompt">
            <Select
              value={shown.systemPromptMode}
              disabled={!editable}
              onValueChange={(value) => {
                if (value === "custom" || value === "preset") set({ systemPromptMode: value });
              }}
            >
              <SelectTrigger size="sm" aria-label="System prompt">
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
          </BotField>
        </div>
      </ThreadDetailsSection>
      <ThreadDetailsSection headingId="bot-config-tools-heading" title="Tools">
        <div className="flex flex-col gap-2 px-2.5">
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
      </ThreadDetailsSection>
      <ThreadDetailsSection headingId="bot-config-mcp-heading" title="MCP servers">
        <div className="px-1">
          <BotMcpServerChecklist
            available={availableMcpServers}
            selected={shown.mcpServerNames}
            disabled={!editable}
            onChange={(mcpServerNames) => set({ mcpServerNames })}
          />
        </div>
      </ThreadDetailsSection>
      <ThreadDetailsSection headingId="bot-config-skills-heading" title="Skills">
        <div className="flex flex-col gap-2 px-2.5">
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
            <p className="text-2xs text-muted-foreground">No skills yet.</p>
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
      </ThreadDetailsSection>
      <div className="surface-glass sticky bottom-0 z-10 flex items-center gap-2 border-t border-border/60 px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {nameMissing
            ? "A Bot needs a name."
            : changeCount === 0
              ? "No changes"
              : `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`}
        </span>
        {changeCount > 0 ? (
          <Button size="xs" variant="ghost-muted" disabled={busy} onClick={() => setPatch({})}>
            Discard
          </Button>
        ) : null}
        <Button
          size="xs"
          disabled={!canUpdate || changeCount === 0 || nameMissing || busy}
          onClick={() => void save()}
        >
          Save config
        </Button>
      </div>
      <ThreadDetailsSection headingId="bot-config-danger-heading" title="Danger zone">
        <div className="flex flex-wrap gap-2 px-2.5">
          {bot.archivedAt === null ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canUpdate || busy}
              onClick={() => void archive()}
            >
              <ArchiveIcon aria-hidden />
              Archive Bot
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={!canUpdate || busy}
              onClick={() => void restore()}
            >
              <ArchiveRestoreIcon aria-hidden />
              Restore Bot
            </Button>
          )}
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={!canDelete || busy}
            onClick={() => void remove()}
          >
            <Trash2Icon aria-hidden />
            Delete Bot
          </Button>
        </div>
      </ThreadDetailsSection>
    </>
  );
}

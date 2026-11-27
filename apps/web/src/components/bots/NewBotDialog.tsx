import {
  AuthOrchestrationOperateScope,
  type BotCreateInput,
  type EnvironmentId,
  type ModelSelection,
  slugifyBotName,
} from "@t3tools/contracts";
import { ChevronRightIcon, ShuffleIcon } from "lucide-react";
import { useRef, useState } from "react";

import { botsEnvironment, useBotsIndex } from "../../state/bots";
import { useConnectedEnvironmentIds, useEnvironments } from "../../state/environments";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { BotAvatar } from "./BotAvatar";
import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  BOT_THEME_COLOR,
  DEFAULT_BOT_AVATAR_SHAPE,
} from "./botAvatars";
import {
  reportBotFailure,
  useCanCreateBot,
  useDefaultBotEnvironmentId,
  useOpenThreadInMode,
} from "./botActions";
import {
  BotField,
  BotMcpServerChecklist,
  BotModelPicker,
  useBotModelChoice,
} from "./botFormControls";
import { BotIdentityPicker } from "./BotIdentityPicker";
import { useBotsUiStore } from "./botsUiStore";

const SUGGESTED_GROUPS = ["Engineering", "Operations", "Creative"] as const;
const RANDOM_COLORS = BOT_AVATAR_COLORS.filter((option) => option.value !== BOT_THEME_COLOR);

interface NewBotDraft {
  readonly name: string;
  readonly role: string;
  readonly groupName: string;
  readonly icon: string;
  readonly color: string;
  readonly model: ModelSelection | null;
  readonly mcpServerNames: ReadonlyArray<string>;
  readonly soul: string;
}

const EMPTY_DRAFT: NewBotDraft = {
  name: "",
  role: "",
  groupName: "",
  icon: DEFAULT_BOT_AVATAR_SHAPE.id,
  color: BOT_THEME_COLOR,
  model: null,
  mcpServerNames: [],
  soul: "",
};

function pickOther(options: ReadonlyArray<string>, current: string): string {
  const others = options.filter((option) => option !== current);
  return others[Math.floor(Math.random() * others.length)] ?? current;
}

export function NewBotDialog() {
  const open = useBotsUiStore((state) => state.newBotDialogOpen);
  const close = useBotsUiStore((state) => state.closeNewBotDialog);
  const defaultEnvironmentId = useDefaultBotEnvironmentId();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <WizardPopup>
        {defaultEnvironmentId === null ? (
          <>
            <WizardHeader title="New Bot" description="Connect an environment to create a Bot." />
            <WizardFooter>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
            </WizardFooter>
          </>
        ) : (
          <NewBotForm defaultEnvironmentId={defaultEnvironmentId} onClose={close} />
        )}
      </WizardPopup>
    </Dialog>
  );
}

function NewBotForm(props: {
  readonly defaultEnvironmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const openThread = useOpenThreadInMode();
  const visualStyle = useBotsUiStore((state) => state.visualStyle);
  const setVisualStyle = useBotsUiStore((state) => state.setVisualStyle);
  const connectedIds = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const index = useBotsIndex();
  const [chosenEnvironmentId, setChosenEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    chosenEnvironmentId !== null && connectedIds.includes(chosenEnvironmentId)
      ? chosenEnvironmentId
      : props.defaultEnvironmentId;
  const [draft, setDraft] = useState<NewBotDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const canCreate = useCanCreateBot(environmentId);
  const createBot = useAtomCommand(botsEnvironment.createBot, {
    label: "bot create",
    reportFailure: false,
  });
  const model = useBotModelChoice(environmentId, draft.model);
  const availableMcpServers = index.availableMcpServersByEnvironment.get(environmentId) ?? [];
  const existingGroups = [
    ...new Set(
      index.bots.flatMap(({ environmentId: botEnvironmentId, bot }) =>
        botEnvironmentId === environmentId && bot.groupName !== null && bot.archivedAt === null
          ? [bot.groupName]
          : [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const groupSuggestions = existingGroups.length > 0 ? existingGroups : SUGGESTED_GROUPS;
  const name = draft.name.trim();
  const slug = slugifyBotName(name || "bot");
  const update = (patch: Partial<NewBotDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const mcpCount = draft.mcpServerNames.length;
  const optionsSummary = [
    model.label,
    mcpCount === 0 ? null : `${mcpCount} ${mcpCount === 1 ? "MCP" : "MCPs"}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  const randomize = () =>
    update({
      icon: pickOther(
        BOT_AVATAR_SHAPES.map((shape) => shape.id),
        draft.icon,
      ),
      color: pickOther(
        RANDOM_COLORS.map((option) => option.value),
        draft.color,
      ),
    });

  const submit = async () => {
    if (
      submitting.current ||
      name === "" ||
      model.selection === null ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const soul = draft.soul.trim();
    const groupName = draft.groupName.trim();
    const input: BotCreateInput = {
      name,
      modelSelection: model.selection,
      role: draft.role.trim(),
      groupName: groupName === "" ? null : groupName,
      icon: draft.icon,
      color: draft.color,
      mcpServerNames: draft.mcpServerNames,
      ...(soul === "" ? {} : { documents: { soul: draft.soul } }),
    };
    submitting.current = true;
    setSaving(true);
    const result = await createBot({ environmentId, input });
    submitting.current = false;
    setSaving(false);
    if (result._tag === "Failure") {
      reportBotFailure("Could not create Bot", result);
      return;
    }
    props.onClose();
    openThread("bots", environmentId, result.value.bot.threadId);
  };

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <WizardHeader
        title="New Bot"
        description="A long-lived agent with its own folder, memory and thread."
      />
      <WizardPanel>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative flex w-full justify-center rounded-2xl bg-muted/30 py-7">
              <BotAvatar icon={draft.icon} color={draft.color} size="xl" />
              <div className="absolute end-2 bottom-2">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label="Randomize look"
                        onClick={randomize}
                      />
                    }
                  >
                    <ShuffleIcon aria-hidden />
                  </TooltipTrigger>
                  <TooltipPopup>Randomize</TooltipPopup>
                </Tooltip>
              </div>
            </div>
            <div className="flex w-full max-w-xs flex-col items-center gap-0.5 pt-1">
              <input
                autoFocus
                aria-label="Bot name"
                placeholder="Name your Bot"
                value={draft.name}
                onChange={(event) => update({ name: event.currentTarget.value })}
                className="h-9 w-full rounded-lg bg-transparent px-3 text-center text-lg font-semibold text-foreground outline-none transition-colors placeholder:font-medium placeholder:text-muted-foreground/60 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 motion-reduce:transition-none"
              />
              <input
                aria-label="Bot role"
                placeholder="Role (e.g. Chief of Staff, Designer)"
                value={draft.role}
                onChange={(event) => update({ role: event.currentTarget.value })}
                className="h-7 w-full rounded-md bg-transparent px-3 text-center text-xs text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/55 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 motion-reduce:transition-none"
              />
            </div>
            <span className="max-w-full truncate font-mono text-2xs text-muted-foreground/80">
              ~/.t3/bots/{slug}
            </span>
          </div>
          <BotIdentityPicker
            icon={draft.icon}
            color={draft.color}
            visualStyle={visualStyle}
            onVisualStyleChange={setVisualStyle}
            disabled={saving}
            onIconChange={(icon) => update({ icon })}
            onColorChange={(color) => update({ color })}
          />
          <Collapsible>
            <CollapsibleTrigger className="group/more flex w-full items-center gap-2 rounded-xl border border-border/60 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none">
              <span className="shrink-0 text-sm font-medium text-foreground">
                Model, group & tools
              </span>
              <span className="ms-auto min-w-0 truncate text-xs text-muted-foreground">
                {optionsSummary}
              </span>
              <ChevronRightIcon
                className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open/more:rotate-90 motion-reduce:transition-none"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="flex flex-col gap-4 px-0.5 pt-4">
                <BotField label="Group" htmlFor="new-bot-group">
                  <Input
                    id="new-bot-group"
                    placeholder="Ungrouped"
                    value={draft.groupName}
                    onChange={(event) => update({ groupName: event.currentTarget.value })}
                  />
                  <div className="flex flex-wrap gap-1">
                    {groupSuggestions.map((group) => (
                      <Button
                        key={group}
                        type="button"
                        size="micro"
                        variant={draft.groupName.trim() === group ? "secondary" : "ghost-muted"}
                        onClick={() =>
                          update({ groupName: draft.groupName.trim() === group ? "" : group })
                        }
                      >
                        {group}
                      </Button>
                    ))}
                  </div>
                </BotField>
                {connectedIds.length > 1 ? (
                  <BotField label="Environment">
                    <Select
                      value={environmentId}
                      onValueChange={(value) => {
                        const next = connectedIds.find((id) => id === value);
                        if (next) setChosenEnvironmentId(next);
                      }}
                    >
                      <SelectTrigger aria-label="Environment">
                        <SelectValue>
                          {environments.find((entry) => entry.environmentId === environmentId)
                            ?.label ?? environmentId}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {connectedIds.map((id) => (
                          <SelectItem key={id} value={id}>
                            {environments.find((entry) => entry.environmentId === id)?.label ?? id}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </BotField>
                ) : null}
                <BotField label="Model">
                  <div>
                    <BotModelPicker
                      environmentId={environmentId}
                      selection={model.selection}
                      instanceEntries={model.instanceEntries}
                      modelOptionsByInstance={model.modelOptionsByInstance}
                      disabled={saving}
                      onChange={(selection) => update({ model: selection })}
                    />
                  </div>
                </BotField>
                <BotField label="MCP servers">
                  <BotMcpServerChecklist
                    available={availableMcpServers}
                    selected={draft.mcpServerNames}
                    disabled={saving}
                    onChange={(mcpServerNames) => update({ mcpServerNames })}
                  />
                </BotField>
                <BotField label="Starter SOUL.md" htmlFor="new-bot-soul" hint="Optional.">
                  <Textarea
                    id="new-bot-soul"
                    placeholder="Who is this Bot? How should it think, talk and decide?"
                    rows={5}
                    value={draft.soul}
                    onChange={(event) => update({ soul: event.currentTarget.value })}
                  />
                </BotField>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </WizardPanel>
      <WizardFooter>
        <Button type="button" variant="outline" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!canCreate || saving || name === "" || model.selection === null}
        >
          {saving ? "Creating…" : "Create Bot"}
        </Button>
      </WizardFooter>
    </form>
  );
}

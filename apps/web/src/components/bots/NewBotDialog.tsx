import {
  AuthOrchestrationOperateScope,
  BOT_DEFAULT_ICON,
  type BotCreateInput,
  type EnvironmentId,
  type ModelSelection,
  slugifyBotName,
} from "@t3tools/contracts";
import { ChevronRightIcon, FolderIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { botsEnvironment, useBotsIndex } from "../../state/bots";
import { useConnectedEnvironmentIds, useEnvironments } from "../../state/environments";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { BotAvatar } from "./BotAvatar";
import {
  reportBotFailure,
  useCanCreateBot,
  useDefaultBotEnvironmentId,
  useOpenThreadInMode,
} from "./botActions";
import { BotIdentityPicker } from "./BotIdentityPicker";
import {
  BotField,
  BotMcpServerChecklist,
  BotModelPicker,
  useBotModelChoice,
} from "./botFormControls";
import { useBotsUiStore } from "./botsUiStore";

const SUGGESTED_GROUPS = ["Engineering", "Operations", "Creative"] as const;
const DEFAULT_NEW_BOT_COLOR = "theme";

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
  icon: BOT_DEFAULT_ICON,
  color: DEFAULT_NEW_BOT_COLOR,
  model: null,
  mcpServerNames: [],
  soul: "",
};

export function NewBotDialog() {
  const open = useBotsUiStore((state) => state.newBotDialogOpen);
  const close = useBotsUiStore((state) => state.closeNewBotDialog);
  const defaultEnvironmentId = useDefaultBotEnvironmentId();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Bot</DialogTitle>
          <DialogDescription>
            A Bot is a long-lived agent with its own folder, memory and thread. It can delegate
            coding work to new threads and watch them.
          </DialogDescription>
        </DialogHeader>
        {defaultEnvironmentId === null ? (
          <DialogPanel>
            <p className="text-sm text-muted-foreground">Connect an environment to create a Bot.</p>
          </DialogPanel>
        ) : (
          <NewBotForm defaultEnvironmentId={defaultEnvironmentId} onClose={close} />
        )}
      </DialogPopup>
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
      <DialogPanel>
        <div className="flex items-center gap-3">
          <BotAvatar icon={draft.icon} color={draft.color} size="xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Input
              autoFocus
              size="lg"
              aria-label="Bot name"
              placeholder="Name your Bot"
              value={draft.name}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
            <span className="inline-flex min-w-0 items-center gap-1 self-start rounded-full bg-muted/60 px-2 py-0.5 font-mono text-2xs text-muted-foreground">
              <FolderIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">~/.t3/bots/{slug}/</span>
            </span>
          </div>
        </div>
        <BotField label="Role" htmlFor="new-bot-role">
          <Input
            id="new-bot-role"
            placeholder="Triages work and delegates coding tasks"
            value={draft.role}
            onChange={(event) => update({ role: event.currentTarget.value })}
          />
        </BotField>
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
                onClick={() => update({ groupName: draft.groupName.trim() === group ? "" : group })}
              >
                {group}
              </Button>
            ))}
          </div>
        </BotField>
        <BotIdentityPicker
          icon={draft.icon}
          color={draft.color}
          onIconChange={(icon) => update({ icon })}
          onColorChange={(color) => update({ color })}
          visualStyle={visualStyle}
          onVisualStyleChange={setVisualStyle}
        />
        <div className={cn("grid gap-4", connectedIds.length > 1 && "sm:grid-cols-2")}>
          {connectedIds.length > 1 ? (
            <BotField label="Environment">
              <Select
                value={environmentId}
                onValueChange={(value) => {
                  const next = connectedIds.find((id) => id === value);
                  if (next) setChosenEnvironmentId(next);
                }}
              >
                <SelectTrigger size="sm" aria-label="Environment">
                  <SelectValue>
                    {environments.find((entry) => entry.environmentId === environmentId)?.label ??
                      environmentId}
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
        </div>
        <BotField label="MCP servers">
          <BotMcpServerChecklist
            available={availableMcpServers}
            selected={draft.mcpServerNames}
            disabled={saving}
            onChange={(mcpServerNames) => update({ mcpServerNames })}
          />
        </BotField>
        <Collapsible>
          <CollapsibleTrigger className="group/soul flex w-full items-center gap-1.5 rounded-md py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <ChevronRightIcon
              className="size-3.5 transition-transform duration-150 group-data-panel-open/soul:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
            Starter SOUL.md
            <span className="font-normal">(optional)</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-2">
              <Textarea
                aria-label="Starter SOUL.md"
                placeholder="Who is this Bot? How should it think, talk and decide?"
                rows={6}
                value={draft.soul}
                onChange={(event) => update({ soul: event.currentTarget.value })}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!canCreate || saving || name === "" || model.selection === null}
        >
          {saving ? "Creating…" : "Create Bot"}
        </Button>
      </DialogFooter>
    </form>
  );
}

import { useAtomValue } from "@effect/atom-react";
import type {
  BotAvailableMcpServer,
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { LockIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { type ProviderInstanceEntry, providerInstanceEntriesFor } from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { Checkbox } from "../ui/checkbox";

const BOT_BUILTIN_MCP_SERVER = "t3-code";

export function BotField(props: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={props.htmlFor} className="text-xs font-medium text-muted-foreground">
        {props.label}
      </label>
      {props.children}
      {props.hint ? <p className="text-2xs text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

function isReady(entry: ProviderInstanceEntry): boolean {
  return (
    entry.enabled &&
    entry.installed &&
    entry.isAvailable &&
    entry.snapshot.auth.status !== "unauthenticated"
  );
}

/** Bots run best on Claude, so a new Bot starts there when this environment has it. */
function defaultBotModel(
  settings: Parameters<typeof scheduledTaskDefaultModel>[0],
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ModelSelection | null {
  const claude = entries.find((entry) => entry.driverKind === "claudeAgent" && isReady(entry));
  const models = claude?.models.filter((model) => !model.isLegacy) ?? [];
  const model = models.find((candidate) => candidate.isDefault) ?? models[0];
  if (claude && model) return { instanceId: claude.instanceId, model: model.slug };
  return scheduledTaskDefaultModel(settings, null, entries);
}

export function useBotModelChoice(
  environmentId: EnvironmentId,
  chosen: ModelSelection | null,
): {
  readonly selection: ModelSelection | null;
  readonly label: string | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReturnType<typeof getCustomModelOptionsByInstance>;
} {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, null);
  const selection =
    chosen !== null &&
    instanceEntries.some((entry) => entry.instanceId === chosen.instanceId && entry.enabled)
      ? chosen
      : defaultBotModel(settings, instanceEntries);
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId ?? null,
    selection?.model ?? null,
  );
  const label =
    selection === null
      ? null
      : (instanceEntries
          .find((entry) => entry.instanceId === selection.instanceId)
          ?.models.find((model) => model.slug === selection.model)?.name ?? selection.model);
  return { selection, label, instanceEntries, modelOptionsByInstance };
}

export function BotModelPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly selection: ModelSelection | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReturnType<typeof getCustomModelOptionsByInstance>;
  readonly disabled?: boolean;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const fallbackInstanceId = props.instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  return (
    <ProviderModelPicker
      environmentId={props.environmentId}
      disabled={props.disabled === true || props.instanceEntries.length === 0}
      activeInstanceId={props.selection?.instanceId ?? fallbackInstanceId}
      model={props.selection?.model ?? ""}
      lockedProvider={null}
      instanceEntries={props.instanceEntries}
      modelOptionsByInstance={props.modelOptionsByInstance}
      isComposerOwned={false}
      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
      onInstanceModelChange={(instanceId, model) => props.onChange({ instanceId, model })}
    />
  );
}

export function BotMcpServerChecklist(props: {
  readonly available: ReadonlyArray<BotAvailableMcpServer>;
  readonly selected: ReadonlyArray<string>;
  readonly disabled?: boolean;
  readonly onChange: (names: ReadonlyArray<string>) => void;
}) {
  const discovered = props.available.filter((server) => server.name !== BOT_BUILTIN_MCP_SERVER);
  // Names a Bot already uses stay listed after their server leaves this environment's config.
  const missing = props.selected.filter(
    (name) => name !== BOT_BUILTIN_MCP_SERVER && !discovered.some((server) => server.name === name),
  );
  const toggle = (name: string, checked: boolean) =>
    props.onChange(
      checked
        ? [...props.selected.filter((entry) => entry !== name), name]
        : props.selected.filter((entry) => entry !== name),
    );
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm">
        <LockIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {BOT_BUILTIN_MCP_SERVER}
        </span>
        <span className="text-2xs text-muted-foreground">Always on</span>
      </div>
      {[
        ...discovered.map((server) => ({ name: server.name, transport: server.transport })),
        ...missing.map((name) => ({ name, transport: null })),
      ].map((server) => (
        <label
          key={server.name}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-64"
        >
          <Checkbox
            checked={props.selected.includes(server.name)}
            disabled={props.disabled}
            onCheckedChange={(checked) => toggle(server.name, checked === true)}
          />
          <span className="min-w-0 flex-1 truncate text-foreground">{server.name}</span>
          <span className="text-2xs text-muted-foreground">
            {server.transport ?? "Not configured"}
          </span>
        </label>
      ))}
      {discovered.length === 0 && missing.length === 0 ? (
        <p className="px-1.5 text-2xs text-muted-foreground">
          No other MCP servers are configured on this environment.
        </p>
      ) : null}
    </div>
  );
}

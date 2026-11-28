import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type BotVisualStyle, DEFAULT_BOT_VISUAL_STYLE } from "@t3tools/client-runtime/bot-avatar";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { msg } from "gt-react-native";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { buildModelOptions, type ModelOption } from "../../lib/modelOptions";
import { useEnvironmentServerConfig } from "../../state/entities";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";

export function useBotVisualStyle(): BotVisualStyle {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const stored = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value.botVisualStyle
    : undefined;
  return stored ?? DEFAULT_BOT_VISUAL_STYLE;
}

export function useSetBotVisualStyle(): (style: BotVisualStyle) => void {
  const savePreferences = useAtomCommand(saveMobilePreferences);
  return (botVisualStyle) => void savePreferences({ botVisualStyle });
}

export function reportBotCommandFailure(
  title: string,
  result: AtomCommandResult<unknown, unknown>,
): void {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(title, error instanceof Error ? error.message : m(msg("Try again.")));
  }
}

/** Bots run best on Claude, so a new Bot starts there when this environment has it. */
export function selectDefaultBotModel(options: ReadonlyArray<ModelOption>): ModelSelection | null {
  const ready = options.filter((option) => !option.isUnavailable && !option.isHidden);
  const claudeModels = ready.filter((option) => option.providerDriver === "claudeAgent");
  const nonLegacyClaude = claudeModels.filter((option) => !option.isLegacy);
  const preferredClaude =
    nonLegacyClaude.find((option) => option.isDefault) ?? nonLegacyClaude[0] ?? claudeModels[0];
  if (preferredClaude) return preferredClaude.selection;
  const nonLegacy = ready.filter((option) => !option.isLegacy);
  const preferred = nonLegacy.find((option) => option.isDefault) ?? nonLegacy[0] ?? ready[0];
  return preferred?.selection ?? null;
}

export function useBotModelChoice(
  environmentId: EnvironmentId | null,
  chosen: ModelSelection | null,
): {
  readonly selection: ModelSelection | null;
  readonly label: string | null;
  readonly options: ReadonlyArray<ModelOption>;
} {
  const config = useEnvironmentServerConfig(environmentId);
  const options = buildModelOptions(config, chosen, undefined, null).filter(
    (option) => !option.isUnavailable && !option.isHidden,
  );
  const matchedChosen =
    chosen !== null
      ? (options.find(
          (option) =>
            option.selection.instanceId === chosen.instanceId &&
            option.selection.model === chosen.model,
        ) ?? null)
      : null;
  const selection = matchedChosen?.selection ?? chosen ?? selectDefaultBotModel(options);
  const activeOption =
    selection === null
      ? null
      : (options.find(
          (option) =>
            option.selection.instanceId === selection.instanceId &&
            option.selection.model === selection.model,
        ) ?? null);
  return {
    selection,
    label: activeOption
      ? `${activeOption.providerLabel} · ${activeOption.label}`
      : (selection?.model ?? null),
    options,
  };
}

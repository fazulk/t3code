import type {
  AgentActionConfig,
  AgentActionProvider,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { memo, useMemo } from "react";

import { getAppModelOptions, resolveAppModelSelection } from "~/modelSelection";
import { getProviderModels } from "~/providerModels";
import { TraitsPicker } from "./chat/TraitsPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const AGENT_ACTION_PROVIDERS = [
  "codex",
  "claudeAgent",
] as const satisfies ReadonlyArray<AgentActionProvider>;
const INTERACTION_MODE_LABELS: Record<ProviderInteractionMode, string> = {
  default: "Build",
  plan: "Plan",
};
const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  "full-access": "Full access",
};

function normalizeAgentModelSelection(input: {
  value: AgentActionConfig;
  settings: UnifiedSettings;
  providerStatuses: ReadonlyArray<ServerProvider>;
}): AgentActionConfig["modelSelection"] {
  const provider = input.value.provider;
  const candidateModel =
    input.value.modelSelection.provider === provider ? input.value.modelSelection.model : null;
  const normalizedModel = resolveAppModelSelection(
    provider,
    input.settings,
    input.providerStatuses,
    candidateModel,
  );
  const nextOptions =
    input.value.modelSelection.provider === provider
      ? input.value.modelSelection.options
      : undefined;
  return createModelSelection(
    provider,
    normalizedModel,
    nextOptions,
  ) as AgentActionConfig["modelSelection"];
}

export interface AgentActionFieldsProps {
  value: AgentActionConfig;
  providerStatuses: ReadonlyArray<ServerProvider>;
  settings: UnifiedSettings;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onChange: (value: AgentActionConfig) => void;
}

export const AgentActionFields = memo(function AgentActionFields(props: AgentActionFieldsProps) {
  const provider = props.value.provider;
  const normalizedModelSelection = useMemo(
    () =>
      normalizeAgentModelSelection({
        value: props.value,
        settings: props.settings,
        providerStatuses: props.providerStatuses,
      }),
    [props.providerStatuses, props.settings, props.value],
  );
  const modelOptionsByProvider = useMemo(
    () => ({
      codex: getAppModelOptions(
        props.settings,
        props.providerStatuses,
        "codex",
        provider === "codex" ? normalizedModelSelection.model : undefined,
      ),
      claudeAgent: getAppModelOptions(
        props.settings,
        props.providerStatuses,
        "claudeAgent",
        provider === "claudeAgent" ? normalizedModelSelection.model : undefined,
      ),
    }),
    [normalizedModelSelection.model, props.providerStatuses, props.settings, provider],
  );
  const availableModels = modelOptionsByProvider[provider];
  const providerModels = getProviderModels(props.providerStatuses, provider);
  const selectedModelLabel =
    availableModels.find((model) => model.slug === normalizedModelSelection.model)?.name ??
    normalizedModelSelection.model;
  const selectedProviderLabel = provider === "codex" ? "Codex" : "Claude";

  const updateModelSelection = (
    nextProvider: AgentActionProvider,
    model: string,
    options?: AgentActionConfig["modelSelection"]["options"],
  ) => {
    if (nextProvider === "codex") {
      props.onChange({
        ...props.value,
        provider: "codex",
        modelSelection: createModelSelection(
          "codex",
          model,
          options as Extract<AgentActionConfig, { provider: "codex" }>["modelSelection"]["options"],
        ) as Extract<AgentActionConfig, { provider: "codex" }>["modelSelection"],
      });
      return;
    }

    props.onChange({
      ...props.value,
      provider: "claudeAgent",
      modelSelection: createModelSelection(
        "claudeAgent",
        model,
        options as Extract<
          AgentActionConfig,
          { provider: "claudeAgent" }
        >["modelSelection"]["options"],
      ) as Extract<AgentActionConfig, { provider: "claudeAgent" }>["modelSelection"],
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="font-medium text-sm">Provider</div>
          <Select
            value={provider}
            onValueChange={(nextProvider) => {
              if (!nextProvider || nextProvider === provider) {
                return;
              }
              const typedProvider = nextProvider as AgentActionProvider;
              updateModelSelection(
                typedProvider,
                resolveAppModelSelection(
                  typedProvider,
                  props.settings,
                  props.providerStatuses,
                  null,
                ),
              );
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue>{selectedProviderLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {AGENT_ACTION_PROVIDERS.map((providerOption) => (
                <SelectItem key={providerOption} value={providerOption}>
                  {providerOption === "codex" ? "Codex" : "Claude"}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="font-medium text-sm">Model</div>
          <Select
            value={normalizedModelSelection.model}
            onValueChange={(nextModel) => {
              if (!nextModel || nextModel === normalizedModelSelection.model) {
                return;
              }
              updateModelSelection(provider, nextModel, normalizedModelSelection.options);
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue>{selectedModelLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {availableModels.map((model) => (
                <SelectItem key={model.slug} value={model.slug}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="font-medium text-sm">Traits</div>
        <TraitsPicker
          provider={provider}
          models={providerModels}
          model={normalizedModelSelection.model}
          prompt={props.prompt}
          onPromptChange={props.onPromptChange}
          modelOptions={normalizedModelSelection.options}
          onModelOptionsChange={(nextOptions) => {
            updateModelSelection(
              provider,
              normalizedModelSelection.model,
              nextOptions as AgentActionConfig["modelSelection"]["options"],
            );
          }}
          triggerVariant="outline"
          triggerClassName="w-full justify-between"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="font-medium text-sm">Mode</div>
          <Select
            value={props.value.interactionMode}
            onValueChange={(nextMode) => {
              if (!nextMode || nextMode === props.value.interactionMode) {
                return;
              }
              props.onChange({
                ...props.value,
                interactionMode: nextMode as ProviderInteractionMode,
              });
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue>{INTERACTION_MODE_LABELS[props.value.interactionMode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {(["default", "plan"] as const).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {INTERACTION_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="font-medium text-sm">Access</div>
          <Select
            value={props.value.runtimeMode}
            onValueChange={(nextMode) => {
              if (!nextMode || nextMode === props.value.runtimeMode) {
                return;
              }
              props.onChange({
                ...props.value,
                runtimeMode: nextMode as RuntimeMode,
              });
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue>{RUNTIME_MODE_LABELS[props.value.runtimeMode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {(
                [
                  "approval-required",
                  "auto-accept-edits",
                  "full-access",
                ] as const satisfies ReadonlyArray<RuntimeMode>
              ).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {RUNTIME_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>
    </div>
  );
});

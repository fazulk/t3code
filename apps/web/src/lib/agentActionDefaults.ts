import type {
  AgentActionConfig,
  AgentActionProvider,
  ModelSelection,
  ProviderKind,
} from "@t3tools/contracts";

export type AgentActionDefaults = AgentActionConfig;

export function isAgentActionProvider(provider: ProviderKind): provider is AgentActionProvider {
  return provider === "codex" || provider === "claudeAgent";
}

export function deriveAgentActionDefaults(input: {
  currentProvider: ProviderKind;
  currentModelSelection: ModelSelection;
  fallbackCodexModelSelection: Extract<ModelSelection, { provider: "codex" }>;
  runtimeMode: AgentActionDefaults["runtimeMode"];
  interactionMode: AgentActionDefaults["interactionMode"];
}): AgentActionDefaults {
  if (input.currentProvider === "codex" && input.currentModelSelection.provider === "codex") {
    return {
      provider: "codex",
      modelSelection: input.currentModelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
    };
  }

  if (
    input.currentProvider === "claudeAgent" &&
    input.currentModelSelection.provider === "claudeAgent"
  ) {
    return {
      provider: "claudeAgent",
      modelSelection: input.currentModelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
    };
  }

  return {
    provider: "codex",
    modelSelection: input.fallbackCodexModelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  };
}

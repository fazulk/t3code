import type {
  AgentActionConfig,
  ClaudeSettings,
  CodexSettings,
  ProviderInteractionMode,
  RuntimeMode,
  TerminalProcessLaunch,
} from "@t3tools/contracts";
import { parseCliArgs } from "@t3tools/shared/cliArgs";

const PLAN_MODE_PROMPT_PREFIX = [
  "You are in plan mode.",
  "Analyze the codebase and return a concrete implementation plan only.",
  "Do not modify files or execute mutating commands.",
  "",
  "User request:",
].join("\n");

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function encodePromptForShell(prompt: string): string {
  const bytes = new TextEncoder().encode(prompt);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function appendOptionalFlag(args: string[], flag: string, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  args.push(flag, value);
}

function buildCliArgv(args: string): string[] {
  const parsed = parseCliArgs(args);
  return [
    ...Object.entries(parsed.flags).flatMap(([key, value]) =>
      value === null ? [`--${key}`] : [`--${key}`, value],
    ),
    ...parsed.positionals,
  ];
}

function buildCodexPrompt(prompt: string, interactionMode: ProviderInteractionMode): string {
  if (interactionMode !== "plan") {
    return prompt;
  }
  return `${PLAN_MODE_PROMPT_PREFIX}\n${prompt}`;
}

function buildClaudeModelId(
  selection: Extract<AgentActionConfig["modelSelection"], { provider: "claudeAgent" }>,
): string {
  return selection.options?.contextWindow === "1m" ? `${selection.model}[1m]` : selection.model;
}

function buildClaudeSettingsArg(
  selection: Extract<AgentActionConfig["modelSelection"], { provider: "claudeAgent" }>,
): string | null {
  const settings: Record<string, boolean> = {};
  if (typeof selection.options?.thinking === "boolean") {
    settings.alwaysThinkingEnabled = selection.options.thinking;
  }
  if (selection.options?.fastMode === true) {
    settings.fastMode = true;
  }
  return Object.keys(settings).length > 0 ? JSON.stringify(settings) : null;
}

function buildClaudePermissionArgs(input: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
}): string[] {
  if (input.interactionMode === "plan") {
    return ["--permission-mode", "plan"];
  }
  if (input.runtimeMode === "approval-required") {
    return ["--permission-mode", "default"];
  }
  if (input.runtimeMode === "auto-accept-edits") {
    return ["--permission-mode", "acceptEdits"];
  }
  return ["--dangerously-skip-permissions"];
}

function buildCodexLaunchArgs(input: {
  prompt: string;
  agentConfig: Extract<AgentActionConfig, { provider: "codex" }>;
}): string[] {
  const prompt = buildCodexPrompt(input.prompt, input.agentConfig.interactionMode);
  const sandbox =
    input.agentConfig.interactionMode === "plan"
      ? "read-only"
      : input.agentConfig.runtimeMode === "approval-required"
        ? "read-only"
        : input.agentConfig.runtimeMode === "auto-accept-edits"
          ? "workspace-write"
          : "danger-full-access";
  const approvalPolicy =
    input.agentConfig.runtimeMode === "approval-required"
      ? "untrusted"
      : input.agentConfig.runtimeMode === "auto-accept-edits"
        ? "on-request"
        : "never";
  const args = ["-m", input.agentConfig.modelSelection.model, "-s", sandbox, "-a", approvalPolicy];

  if (input.agentConfig.modelSelection.options?.reasoningEffort) {
    args.push(
      "-c",
      `model_reasoning_effort="${input.agentConfig.modelSelection.options.reasoningEffort}"`,
    );
  }
  if (input.agentConfig.modelSelection.options?.fastMode) {
    args.push("-c", 'service_tier="fast"');
  }
  args.push(prompt);

  return args;
}

function buildClaudeCommand(input: {
  prompt: string;
  agentConfig: Extract<AgentActionConfig, { provider: "claudeAgent" }>;
  claudeSettings: ClaudeSettings;
}): string {
  const encodedPrompt = encodePromptForShell(input.prompt);
  const args = [
    input.claudeSettings.binaryPath,
    ...buildCliArgv(input.claudeSettings.launchArgs),
    "-p",
    "--model",
    buildClaudeModelId(input.agentConfig.modelSelection),
    ...buildClaudePermissionArgs(input.agentConfig),
  ];
  appendOptionalFlag(args, "--effort", input.agentConfig.modelSelection.options?.effort ?? null);
  appendOptionalFlag(args, "--settings", buildClaudeSettingsArg(input.agentConfig.modelSelection));

  return `printf %s ${shellQuote(encodedPrompt)} | base64 --decode | ${args
    .map(shellQuote)
    .join(" ")}`;
}

function buildCodexCommand(input: {
  prompt: string;
  agentConfig: Extract<AgentActionConfig, { provider: "codex" }>;
  codexSettings: CodexSettings;
}): string {
  const prompt = buildCodexPrompt(input.prompt, input.agentConfig.interactionMode);
  const encodedPrompt = encodePromptForShell(prompt);
  const args = [
    ...(input.codexSettings.homePath ? ["env", `CODEX_HOME=${input.codexSettings.homePath}`] : []),
    input.codexSettings.binaryPath,
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "-s",
    input.agentConfig.interactionMode === "plan"
      ? "read-only"
      : input.agentConfig.runtimeMode === "approval-required"
        ? "read-only"
        : input.agentConfig.runtimeMode === "auto-accept-edits"
          ? "workspace-write"
          : "danger-full-access",
    "--model",
    input.agentConfig.modelSelection.model,
  ];

  if (input.agentConfig.modelSelection.options?.reasoningEffort) {
    args.push(
      "--config",
      `model_reasoning_effort="${input.agentConfig.modelSelection.options.reasoningEffort}"`,
    );
  }
  if (input.agentConfig.modelSelection.options?.fastMode) {
    args.push("--config", 'service_tier="fast"');
  }
  args.push("-");

  return `printf %s ${shellQuote(encodedPrompt)} | base64 --decode | ${args
    .map(shellQuote)
    .join(" ")}`;
}

export function buildAgentActionTerminalCommand(input: {
  prompt: string;
  agentConfig: AgentActionConfig;
  settings: {
    providers: {
      codex: CodexSettings;
      claudeAgent: ClaudeSettings;
    };
  };
}): string {
  if (input.agentConfig.provider === "claudeAgent") {
    return buildClaudeCommand({
      prompt: input.prompt,
      agentConfig: input.agentConfig,
      claudeSettings: input.settings.providers.claudeAgent,
    });
  }

  return buildCodexCommand({
    prompt: input.prompt,
    agentConfig: input.agentConfig,
    codexSettings: input.settings.providers.codex,
  });
}

export function buildAgentActionTerminalLaunch(input: {
  prompt: string;
  agentConfig: AgentActionConfig;
  env: Record<string, string>;
  settings: {
    providers: {
      codex: CodexSettings;
      claudeAgent: ClaudeSettings;
    };
  };
}): {
  env: Record<string, string>;
  launch: TerminalProcessLaunch;
} {
  if (input.agentConfig.provider === "claudeAgent") {
    const args = [
      ...buildCliArgv(input.settings.providers.claudeAgent.launchArgs),
      "--model",
      buildClaudeModelId(input.agentConfig.modelSelection),
      ...(input.agentConfig.modelSelection.options?.effort
        ? ["--effort", input.agentConfig.modelSelection.options.effort]
        : []),
      ...(buildClaudeSettingsArg(input.agentConfig.modelSelection)
        ? ["--settings", buildClaudeSettingsArg(input.agentConfig.modelSelection)!]
        : []),
      ...(input.agentConfig.interactionMode === "plan"
        ? ["--permission-mode", "plan"]
        : input.agentConfig.runtimeMode === "approval-required"
          ? ["--permission-mode", "default"]
          : input.agentConfig.runtimeMode === "auto-accept-edits"
            ? ["--permission-mode", "acceptEdits"]
            : ["--permission-mode", "bypassPermissions"]),
      input.prompt,
    ];

    return {
      env: { ...input.env },
      launch: {
        executable: input.settings.providers.claudeAgent.binaryPath,
        args,
      },
    };
  }

  return {
    env: {
      ...input.env,
      ...(input.settings.providers.codex.homePath
        ? { CODEX_HOME: input.settings.providers.codex.homePath }
        : {}),
    },
    launch: {
      executable: input.settings.providers.codex.binaryPath,
      args: buildCodexLaunchArgs({
        prompt: input.prompt,
        agentConfig: input.agentConfig,
      }),
    },
  };
}

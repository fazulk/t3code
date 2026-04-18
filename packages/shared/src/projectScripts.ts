import {
  type AgentProjectAction,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type ProviderInteractionMode,
  type ProjectScript,
  type RuntimeMode,
  type ServerConfig,
  type ShellProjectAction,
} from "@t3tools/contracts";
import { resolveApiModelId } from "./model.ts";
import { parseCliArgs } from "./cliArgs.ts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function isAgentProjectScript(script: ProjectScript): script is AgentProjectAction {
  return script.kind === "agent";
}

export function isShellProjectScript(script: ProjectScript): script is ShellProjectAction {
  return script.kind === "shell";
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ShellProjectAction | null {
  return (
    scripts.find(
      (script): script is ShellProjectAction =>
        isShellProjectScript(script) && script.runOnWorktreeCreate,
    ) ?? null
  );
}

function expandLaunchArgs(launchArgs: string): string[] {
  const parsed = parseCliArgs(launchArgs);
  const args: string[] = [];
  for (const [flag, value] of Object.entries(parsed.flags)) {
    args.push(`--${flag}`);
    if (value !== null) {
      args.push(value);
    }
  }
  args.push(...parsed.positionals);
  return args;
}

function mapCodexRuntimeMode(runtimeMode: RuntimeMode): {
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
} {
  switch (runtimeMode) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        sandbox: "read-only",
      };
    case "auto-accept-edits":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      };
    case "full-access":
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      };
  }
}

function buildCodexInteractivePrompt(
  prompt: string,
  interactionMode: ProviderInteractionMode,
): string {
  if (interactionMode !== "plan") {
    return prompt;
  }

  return [
    "Plan mode:",
    "Analyze the request, inspect the codebase as needed, and return a concrete plan before making changes.",
    "Do not edit files or run mutating commands until the user explicitly asks you to proceed.",
    "",
    prompt,
  ].join("\n");
}

function buildClaudePermissionMode(action: AgentProjectAction): string {
  if (action.interactionMode === "plan") {
    return "plan";
  }

  switch (action.runtimeMode) {
    case "approval-required":
      return "default";
    case "auto-accept-edits":
      return "acceptEdits";
    case "full-access":
      return "bypassPermissions";
  }
}

export function buildAgentTerminalLaunch(input: {
  action: AgentProjectAction;
  cwd: string;
  env: Record<string, string>;
  settings: ServerConfig["settings"];
}): {
  cwd: string;
  env: Record<string, string>;
  launch: {
    kind: "process";
    executable: string;
    args: string[];
  };
  prefillInput?: string;
} {
  if (input.action.modelSelection.provider === "codex") {
    const codexRuntime = mapCodexRuntimeMode(input.action.runtimeMode);
    const codexOptions = input.action.modelSelection.options as CodexModelOptions | undefined;
    const prompt = buildCodexInteractivePrompt(input.action.prompt, input.action.interactionMode);
    return {
      cwd: input.cwd,
      env: {
        ...input.env,
        ...(input.settings.providers.codex.homePath
          ? { CODEX_HOME: input.settings.providers.codex.homePath }
          : {}),
      },
      launch: {
        kind: "process",
        executable: input.settings.providers.codex.binaryPath,
        args: [
          "-m",
          input.action.modelSelection.model,
          "-s",
          codexRuntime.sandbox,
          "-a",
          codexRuntime.approvalPolicy,
          ...(codexOptions?.reasoningEffort
            ? ["-c", `model_reasoning_effort="${codexOptions.reasoningEffort}"`]
            : []),
          ...(codexOptions?.fastMode ? ["-c", `service_tier="fast"`] : []),
          ...(input.action.submitPromptOnLaunch ? [prompt] : []),
        ],
      },
      ...(input.action.submitPromptOnLaunch ? {} : { prefillInput: prompt }),
    };
  }

  const claudeOptions = input.action.modelSelection.options as ClaudeModelOptions | undefined;
  const claudeSettings = {
    ...(typeof claudeOptions?.thinking === "boolean"
      ? { alwaysThinkingEnabled: claudeOptions.thinking }
      : {}),
    ...(claudeOptions?.fastMode ? { fastMode: true } : {}),
  };

  return {
    cwd: input.cwd,
    env: { ...input.env },
    launch: {
      kind: "process",
      executable: input.settings.providers.claudeAgent.binaryPath,
      args: [
        ...expandLaunchArgs(input.settings.providers.claudeAgent.launchArgs),
        "--model",
        resolveApiModelId(input.action.modelSelection),
        ...(claudeOptions?.effort ? ["--effort", claudeOptions.effort] : []),
        ...(Object.keys(claudeSettings).length > 0
          ? ["--settings", JSON.stringify(claudeSettings)]
          : []),
        "--permission-mode",
        buildClaudePermissionMode(input.action),
        ...(input.action.submitPromptOnLaunch ? [input.action.prompt] : []),
      ],
    },
    ...(input.action.submitPromptOnLaunch ? {} : { prefillInput: input.action.prompt }),
  };
}

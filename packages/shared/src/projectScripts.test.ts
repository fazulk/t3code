import { DEFAULT_SERVER_SETTINGS, type ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildAgentTerminalLaunch, setupProjectScript } from "./projectScripts.ts";

describe("projectScripts shared helpers", () => {
  it("ignores agent actions when resolving setup scripts", () => {
    const scripts: ProjectScript[] = [
      {
        kind: "agent",
        id: "triage",
        name: "Triage",
        icon: "agent",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        prompt: "Review the repo.",
        submitPromptOnLaunch: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        runOnWorktreeCreate: false,
      },
      {
        kind: "shell",
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure",
        runOnWorktreeCreate: true,
      },
    ];

    expect(setupProjectScript(scripts)?.id).toBe("setup");
  });

  it("builds a codex launch for a local project", () => {
    const launch = buildAgentTerminalLaunch({
      action: {
        kind: "agent",
        id: "codex-review",
        name: "Codex Review",
        icon: "agent",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "xhigh",
            fastMode: true,
          },
        },
        prompt: "Review the current branch.",
        submitPromptOnLaunch: true,
        runtimeMode: "auto-accept-edits",
        interactionMode: "plan",
        runOnWorktreeCreate: false,
      },
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: {
            ...DEFAULT_SERVER_SETTINGS.providers.codex,
            binaryPath: "/opt/codex",
          },
        },
      },
    });

    expect(launch).toEqual({
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      launch: {
        kind: "process",
        executable: "/opt/codex",
        args: [
          "-m",
          "gpt-5.4",
          "-s",
          "workspace-write",
          "-a",
          "on-request",
          "-c",
          'model_reasoning_effort="xhigh"',
          "-c",
          'service_tier="fast"',
          [
            "Plan mode:",
            "Analyze the request, inspect the codebase as needed, and return a concrete plan before making changes.",
            "Do not edit files or run mutating commands until the user explicitly asks you to proceed.",
            "",
            "Review the current branch.",
          ].join("\n"),
        ],
      },
    });
  });

  it("includes CODEX_HOME only when configured", () => {
    const launch = buildAgentTerminalLaunch({
      action: {
        kind: "agent",
        id: "codex-review",
        name: "Codex Review",
        icon: "agent",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        prompt: "Inspect the worktree state.",
        submitPromptOnLaunch: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        runOnWorktreeCreate: false,
      },
      cwd: "/repo/worktrees/feature-a",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
        T3CODE_WORKTREE_PATH: "/repo/worktrees/feature-a",
      },
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: {
            ...DEFAULT_SERVER_SETTINGS.providers.codex,
            binaryPath: "/opt/codex",
            homePath: "/Users/test/.codex",
          },
        },
      },
    });

    expect(launch.env).toEqual({
      T3CODE_PROJECT_ROOT: "/repo/project",
      T3CODE_WORKTREE_PATH: "/repo/worktrees/feature-a",
      CODEX_HOME: "/Users/test/.codex",
    });
  });

  it("builds a claude launch with configured launch args", () => {
    const launch = buildAgentTerminalLaunch({
      action: {
        kind: "agent",
        id: "claude-review",
        name: "Claude Review",
        icon: "agent",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            effort: "max",
            thinking: false,
            contextWindow: "1m",
          },
        },
        prompt: "Summarize the open risks in this repo.",
        submitPromptOnLaunch: true,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        runOnWorktreeCreate: false,
      },
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          claudeAgent: {
            ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent,
            binaryPath: "/opt/claude",
            launchArgs: "--chrome --verbose",
          },
        },
      },
    });

    expect(launch).toEqual({
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      launch: {
        kind: "process",
        executable: "/opt/claude",
        args: [
          "--chrome",
          "--verbose",
          "--model",
          "claude-sonnet-4-6[1m]",
          "--effort",
          "max",
          "--settings",
          JSON.stringify({ alwaysThinkingEnabled: false }),
          "--permission-mode",
          "plan",
          "Summarize the open risks in this repo.",
        ],
      },
    });
  });

  it("omits the codex prompt arg and returns editable prefill text when auto-submit is disabled", () => {
    const launch = buildAgentTerminalLaunch({
      action: {
        kind: "agent",
        id: "codex-review",
        name: "Codex Review",
        icon: "agent",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        prompt: "Review the current branch.",
        submitPromptOnLaunch: false,
        runtimeMode: "full-access",
        interactionMode: "plan",
        runOnWorktreeCreate: false,
      },
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: {
            ...DEFAULT_SERVER_SETTINGS.providers.codex,
            binaryPath: "/opt/codex",
          },
        },
      },
    });

    expect(launch).toEqual({
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      launch: {
        kind: "process",
        executable: "/opt/codex",
        args: ["-m", "gpt-5.4", "-s", "danger-full-access", "-a", "never"],
      },
      prefillInput: [
        "Plan mode:",
        "Analyze the request, inspect the codebase as needed, and return a concrete plan before making changes.",
        "Do not edit files or run mutating commands until the user explicitly asks you to proceed.",
        "",
        "Review the current branch.",
      ].join("\n"),
    });
  });

  it("omits the claude prompt arg and returns editable prefill text when auto-submit is disabled", () => {
    const launch = buildAgentTerminalLaunch({
      action: {
        kind: "agent",
        id: "claude-review",
        name: "Claude Review",
        icon: "agent",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
        },
        prompt: "Summarize the current branch.",
        submitPromptOnLaunch: false,
        runtimeMode: "approval-required",
        interactionMode: "default",
        runOnWorktreeCreate: false,
      },
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          claudeAgent: {
            ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent,
            binaryPath: "/opt/claude",
          },
        },
      },
    });

    expect(launch).toEqual({
      cwd: "/repo/project",
      env: {
        T3CODE_PROJECT_ROOT: "/repo/project",
      },
      launch: {
        kind: "process",
        executable: "/opt/claude",
        args: ["--model", "claude-sonnet-4-6", "--permission-mode", "default"],
      },
      prefillInput: "Summarize the current branch.",
    });
  });
});

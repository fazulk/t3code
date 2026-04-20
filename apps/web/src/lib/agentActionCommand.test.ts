import { describe, expect, it } from "vitest";

import { buildAgentActionTerminalLaunch } from "./agentActionCommand";

describe("buildAgentActionTerminalLaunch", () => {
  const settings = {
    providers: {
      codex: {
        enabled: true,
        binaryPath: "codex",
        homePath: "/tmp/codex-home",
        customModels: [],
      },
      claudeAgent: {
        enabled: true,
        binaryPath: "claude",
        customModels: [],
        launchArgs: "--verbose",
      },
    },
  };

  it("builds a direct codex process launch", () => {
    const result = buildAgentActionTerminalLaunch({
      prompt: "Review the diff",
      env: { T3CODE_PROJECT_ROOT: "/repo" },
      settings,
      agentConfig: {
        provider: "codex",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            fastMode: true,
          },
        },
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    });

    expect(result.env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/repo",
      CODEX_HOME: "/tmp/codex-home",
    });
    expect(result.launch).toMatchObject({
      executable: "codex",
    });
    expect(result.launch.args).toContain("Review the diff");
  });

  it("builds a direct claude process launch", () => {
    const result = buildAgentActionTerminalLaunch({
      prompt: "Summarize the code",
      env: { T3CODE_PROJECT_ROOT: "/repo" },
      settings,
      agentConfig: {
        provider: "claudeAgent",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-5",
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
      },
    });

    expect(result.env).toEqual({
      T3CODE_PROJECT_ROOT: "/repo",
    });
    expect(result.launch).toMatchObject({
      executable: "claude",
    });
    expect(result.launch.args).toEqual(
      expect.arrayContaining(["--verbose", "--model", "claude-sonnet-4-5", "Summarize the code"]),
    );
  });
});

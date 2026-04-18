import type { ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  setupProjectScript,
} from "@t3tools/shared/projectScripts";

import {
  actionPreferenceKey,
  commandForGlobalAction,
  commandForProjectScript,
  globalActionIdFromCommand,
  nextResolvedActionId,
  nextProjectScriptId,
  primaryProjectScript,
  projectScriptIdFromCommand,
} from "./projectScripts";

describe("projectScripts helpers", () => {
  it("builds and parses script run commands", () => {
    const command = commandForProjectScript("lint");
    expect(command).toBe("script.lint.run");
    expect(projectScriptIdFromCommand(command)).toBe("lint");
    expect(projectScriptIdFromCommand("terminal.toggle")).toBeNull();
  });

  it("builds and parses global action run commands", () => {
    const command = commandForGlobalAction("review");
    expect(command).toBe("global-action.review.run");
    expect(globalActionIdFromCommand(command)).toBe("review");
    expect(globalActionIdFromCommand("script.review.run")).toBeNull();
  });

  it("slugifies and dedupes project script ids", () => {
    expect(nextProjectScriptId("Run Tests", [])).toBe("run-tests");
    expect(nextProjectScriptId("Run Tests", ["run-tests"])).toBe("run-tests-2");
    expect(nextProjectScriptId("!!!", [])).toBe("script");
  });

  it("builds scoped action preference keys", () => {
    expect(actionPreferenceKey("project", "lint")).toBe("project:lint");
    expect(actionPreferenceKey("global", "review")).toBe("global:review");
  });

  it("preserves ids when moving actions across scopes unless the target id is taken", () => {
    const globalActions: ProjectScript[] = [
      {
        kind: "shell",
        id: "shared-review",
        name: "Shared Review",
        command: "echo review",
        icon: "play",
        runOnWorktreeCreate: false,
      },
    ];

    expect(
      nextResolvedActionId({
        name: "Lint",
        scope: "global",
        projectScripts: [
          {
            kind: "shell",
            id: "lint",
            name: "Lint",
            command: "bun lint",
            icon: "lint",
            runOnWorktreeCreate: false,
          },
        ],
        globalActions,
        previousAction: {
          scope: "project",
          action: { id: "lint" },
        },
      }),
    ).toBe("lint");

    expect(
      nextResolvedActionId({
        name: "Shared Review",
        scope: "global",
        projectScripts: [],
        globalActions,
        previousAction: {
          scope: "project",
          action: { id: "shared-review" },
        },
      }),
    ).toBe("shared-review-2");
  });

  it("resolves primary and setup scripts", () => {
    const scripts: ProjectScript[] = [
      {
        kind: "shell",
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure",
        runOnWorktreeCreate: true,
      },
      {
        kind: "agent",
        id: "test",
        name: "Test",
        icon: "agent",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        prompt: "Review the repository.",
        submitPromptOnLaunch: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        runOnWorktreeCreate: false as const,
      },
    ];

    expect(primaryProjectScript(scripts)?.id).toBe("test");
    expect(setupProjectScript(scripts)?.id).toBe("setup");
  });

  it("builds default runtime env for scripts", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/repo/worktree-a",
    });

    expect(env).toMatchObject({
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo/worktree-a",
    });
  });

  it("allows overriding runtime env values", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      extraEnv: {
        T3CODE_PROJECT_ROOT: "/custom-root",
        CUSTOM_FLAG: "1",
      },
    });

    expect(env.T3CODE_PROJECT_ROOT).toBe("/custom-root");
    expect(env.CUSTOM_FLAG).toBe("1");
    expect(env.T3CODE_WORKTREE_PATH).toBeUndefined();
  });

  it("prefers the worktree path for script cwd resolution", () => {
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: "/repo/worktree-a",
      }),
    ).toBe("/repo/worktree-a");
    expect(
      projectScriptCwd({
        project: { cwd: "/repo" },
        worktreePath: null,
      }),
    ).toBe("/repo");
  });
});

import { describe, expect, it } from "vitest";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  setupProjectScript,
} from "@t3tools/shared/projectScripts";

import {
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
  projectScriptIdFromCommand,
} from "./projectScripts";
import { mergeScopedProjectScripts, validateScopedProjectScriptId } from "./scopedProjectScripts";

describe("projectScripts helpers", () => {
  it("builds and parses script run commands", () => {
    const command = commandForProjectScript("lint");
    expect(command).toBe("script.lint.run");
    expect(projectScriptIdFromCommand(command)).toBe("lint");
    expect(projectScriptIdFromCommand("terminal.toggle")).toBeNull();
  });

  it("slugifies and dedupes project script ids", () => {
    expect(nextProjectScriptId("Run Tests", [])).toBe("run-tests");
    expect(nextProjectScriptId("Run Tests", ["run-tests"])).toBe("run-tests-2");
    expect(nextProjectScriptId("!!!", [])).toBe("script");
  });

  it("resolves primary and setup scripts", () => {
    const scripts = [
      {
        id: "setup",
        name: "Setup",
        command: "bun install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "test",
        name: "Test",
        command: "bun test",
        icon: "test" as const,
        runOnWorktreeCreate: false,
      },
    ];

    expect(primaryProjectScript(scripts)?.id).toBe("test");
    expect(setupProjectScript(scripts)?.id).toBe("setup");
  });

  it("merges project scripts ahead of global scripts", () => {
    const merged = mergeScopedProjectScripts({
      projectScripts: [
        {
          id: "lint",
          name: "Lint",
          command: "bun lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ],
      globalProjectScripts: [
        {
          id: "format",
          name: "Format",
          command: "bun fmt",
          icon: "configure",
          runOnWorktreeCreate: false,
        },
      ],
    });

    expect(merged).toMatchObject([
      { id: "lint", scope: "project" },
      { id: "format", scope: "global" },
    ]);
  });

  it("rejects cross-scope script id collisions and ignores the edited source script", () => {
    expect(
      validateScopedProjectScriptId({
        candidateId: "lint",
        scope: "project",
        globalProjectScripts: [
          {
            id: "lint",
            name: "Lint",
            command: "bun lint",
            icon: "lint",
            runOnWorktreeCreate: false,
          },
        ],
        loadedProjects: [],
      }),
    ).toContain("global action");

    expect(
      validateScopedProjectScriptId({
        candidateId: "format",
        scope: "global",
        currentProjectRef: {
          environmentId: "environment-local",
          id: "project-1",
        },
        currentScript: {
          id: "format",
          name: "Format",
          command: "bun fmt",
          icon: "configure",
          runOnWorktreeCreate: false,
          scope: "project",
        },
        globalProjectScripts: [],
        loadedProjects: [
          {
            environmentId: "environment-local",
            id: "project-1",
            scripts: [
              {
                id: "format",
                name: "Format",
                command: "bun fmt",
                icon: "configure",
                runOnWorktreeCreate: false,
              },
            ],
          },
        ],
      }),
    ).toBeNull();

    expect(
      validateScopedProjectScriptId({
        candidateId: "format",
        scope: "global",
        currentProjectRef: {
          environmentId: "environment-local",
          id: "project-1",
        },
        currentScript: {
          id: "format",
          name: "Format",
          command: "bun fmt",
          icon: "configure",
          runOnWorktreeCreate: false,
          scope: "project",
        },
        globalProjectScripts: [],
        loadedProjects: [
          {
            environmentId: "environment-local",
            id: "project-1",
            scripts: [
              {
                id: "format",
                name: "Format",
                command: "bun fmt",
                icon: "configure",
                runOnWorktreeCreate: false,
              },
            ],
          },
          {
            environmentId: "environment-remote",
            id: "project-2",
            scripts: [
              {
                id: "format",
                name: "Format",
                command: "pnpm format",
                icon: "configure",
                runOnWorktreeCreate: false,
              },
            ],
          },
        ],
      }),
    ).toContain("project action");
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

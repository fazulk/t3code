import "../index.css";

import type { ProjectScript, ServerProvider } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import ProjectScriptsControl from "./ProjectScriptsControl";

const TEST_CAPABILITIES = {
  reasoningEffortLevels: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium", isDefault: true },
    { value: "high", label: "High" },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
} as const;

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "gpt-5.4",
        name: "GPT-5.4",
        isCustom: false,
        capabilities: TEST_CAPABILITIES,
      },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    provider: "claudeAgent",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: TEST_CAPABILITIES,
      },
    ],
    slashCommands: [],
    skills: [],
  },
];

async function chooseAgentIcon(): Promise<void> {
  await page.getByRole("button", { name: "Choose icon" }).click();
  await page.getByText("Agent", { exact: true }).click();
}

async function openActionsMenu(): Promise<void> {
  await page.getByRole("button", { name: "Actions" }).click();
}

async function mountControl(options?: {
  projectScripts?: ProjectScript[];
  globalActions?: ProjectScript[];
  providers?: ReadonlyArray<ServerProvider>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onSaveAction = vi.fn();
  const onDeleteAction = vi.fn();

  const screen = await render(
    <ProjectScriptsControl
      projectScripts={options?.projectScripts ?? []}
      globalActions={options?.globalActions ?? []}
      keybindings={[]}
      providers={options?.providers ?? TEST_PROVIDERS}
      onRunAction={() => undefined}
      onSaveAction={onSaveAction}
      onDeleteAction={onDeleteAction}
    />,
    { container: host },
  );

  return {
    onSaveAction,
    onDeleteAction,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ProjectScriptsControl", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adds local shell actions through the project scope", async () => {
    const mounted = await mountControl();

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await page.getByLabelText("Name").fill("Lint");
      await page.getByLabelText("Command").fill("bun run lint");
      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(mounted.onSaveAction).toHaveBeenCalledWith({
          scope: "project",
          previousAction: null,
          value: {
            kind: "shell",
            name: "Lint",
            command: "bun run lint",
            icon: "play",
            runOnWorktreeCreate: false,
            keybinding: null,
          },
        });
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("adds global shell actions through server-backed scope", async () => {
    const mounted = await mountControl();

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await page.getByLabelText("Name").fill("Shared Lint");
      await page.getByLabelText("Global").click();
      await page.getByLabelText("Command").fill("bun lint");
      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(mounted.onSaveAction).toHaveBeenCalledWith({
          scope: "global",
          previousAction: null,
          value: {
            kind: "shell",
            name: "Shared Lint",
            command: "bun lint",
            icon: "play",
            runOnWorktreeCreate: false,
            keybinding: null,
          },
        });
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("adds global agent actions with the selected model selection and prompt", async () => {
    const mounted = await mountControl();

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await chooseAgentIcon();
      await page.getByLabelText("Name").fill("Review");
      await page.getByLabelText("Global").click();
      await page
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Review the current branch.");
      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(mounted.onSaveAction).toHaveBeenCalledWith({
          scope: "global",
          previousAction: null,
          value: {
            kind: "agent",
            name: "Review",
            icon: "agent",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                reasoningEffort: "medium",
              },
            },
            prompt: "Review the current branch.",
            submitPromptOnLaunch: true,
            runtimeMode: "full-access",
            interactionMode: "default",
            keybinding: null,
          },
        });
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the Global checkbox checked when editing a global action", async () => {
    const mounted = await mountControl({
      globalActions: [
        {
          kind: "shell",
          id: "shared-lint",
          name: "Shared Lint",
          command: "bun lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ],
    });

    try {
      await openActionsMenu();
      await page.getByRole("button", { name: "Edit Shared Lint" }).click();

      await vi.waitFor(() => {
        expect(page.getByLabelText("Global")).toBeChecked();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders local actions first, then a separator, then global actions, with Add action last", async () => {
    const mounted = await mountControl({
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
      globalActions: [
        {
          kind: "shell",
          id: "shared-review",
          name: "Shared Review",
          command: "echo review",
          icon: "play",
          runOnWorktreeCreate: false,
        },
      ],
    });

    try {
      await openActionsMenu();

      const itemTexts = Array.from(document.querySelectorAll('[role="menuitem"]')).map((node) =>
        node.textContent?.replace(/\s+/g, " ").trim(),
      );
      expect(itemTexts).toEqual(["Lint", "Shared Review", "Add action"]);
      expect(document.querySelectorAll('[role="separator"]').length).toBe(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the edit dialog for both local and global actions", async () => {
    const mounted = await mountControl({
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
      globalActions: [
        {
          kind: "shell",
          id: "shared-lint",
          name: "Shared Lint",
          command: "bun lint --all",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ],
    });

    try {
      await openActionsMenu();
      await page.getByRole("button", { name: "Edit Lint" }).click();
      await vi.waitFor(() => {
        expect(page.getByLabelText("Name")).toHaveValue("Lint");
        expect(page.getByLabelText("Global")).not.toBeChecked();
      });
      await page.getByRole("button", { name: "Cancel" }).click();

      await openActionsMenu();
      await page.getByRole("button", { name: "Edit Shared Lint" }).click();
      await vi.waitFor(() => {
        expect(page.getByLabelText("Name")).toHaveValue("Shared Lint");
        expect(page.getByLabelText("Global")).toBeChecked();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows agent fields and hides the command field when the agent icon is selected", async () => {
    const mounted = await mountControl();

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await chooseAgentIcon();

      await vi.waitFor(() => {
        expect(document.querySelector("#script-command")).toBeNull();
        expect(document.querySelector("#script-prompt")).not.toBeNull();
        expect(document.body.textContent).toContain("Agent Settings");
        expect(document.body.textContent).toContain("Build");
        expect(document.body.textContent).toContain("Full access");
        expect(document.body.textContent).toContain("Auto-submit");
        expect(document.body.textContent).toContain("manual only");
      });
      expect(document.body.textContent).not.toContain("Run automatically on worktree creation");
    } finally {
      await mounted.cleanup();
    }
  });

  it("blocks saving agent actions when the selected provider is unavailable", async () => {
    const mounted = await mountControl({
      providers: [
        {
          ...TEST_PROVIDERS[0]!,
          status: "warning",
        },
      ],
    });

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await chooseAgentIcon();
      await page.getByLabelText("Name").fill("Review");
      await page
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Review the current branch.");
      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(document.body.textContent).toContain(
          "Select a ready provider before saving an agent action.",
        );
      });
      expect(mounted.onSaveAction).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("saves agent actions with editable prefill mode when auto-submit is disabled", async () => {
    const mounted = await mountControl();

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await chooseAgentIcon();
      await page.getByLabelText("Name").fill("Review");
      await page
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Review the current branch.");
      await page.getByRole("checkbox", { name: /Auto-submit/i }).click();
      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(mounted.onSaveAction).toHaveBeenCalledWith({
          scope: "project",
          previousAction: null,
          value: {
            kind: "agent",
            name: "Review",
            icon: "agent",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                reasoningEffort: "medium",
              },
            },
            prompt: "Review the current branch.",
            submitPromptOnLaunch: false,
            runtimeMode: "full-access",
            interactionMode: "default",
            keybinding: null,
          },
        });
      });
    } finally {
      await mounted.cleanup();
    }
  });
});

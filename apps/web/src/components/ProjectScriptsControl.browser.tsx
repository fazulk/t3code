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

async function mountControl(options?: {
  scripts?: ProjectScript[];
  providers?: ReadonlyArray<ServerProvider>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onAddScript = vi.fn();
  const screen = await render(
    <ProjectScriptsControl
      scripts={options?.scripts ?? []}
      keybindings={[]}
      providers={options?.providers ?? TEST_PROVIDERS}
      onRunScript={() => undefined}
      onAddScript={onAddScript}
      onUpdateScript={() => undefined}
      onDeleteScript={() => undefined}
    />,
    { container: host },
  );

  return {
    onAddScript,
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

  it("adds command actions with the existing shell payload", async () => {
    const mounted = await mountControl();

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await page.getByLabelText("Name").fill("Lint");
      await page.getByLabelText("Command").fill("bun run lint");
      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(mounted.onAddScript).toHaveBeenCalledWith({
          kind: "shell",
          name: "Lint",
          command: "bun run lint",
          icon: "play",
          runOnWorktreeCreate: false,
          keybinding: null,
        });
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
        expect(document.querySelector("#script-type")).toBeNull();
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

  it("adds agent actions with the selected model selection and prompt", async () => {
    const mounted = await mountControl();

    try {
      await page.getByRole("button", { name: "Add action" }).click();
      await chooseAgentIcon();
      await page.getByLabelText("Name").fill("Review");
      await page
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Review the current branch.");
      await page.getByRole("button", { name: "Save action" }).click();

      await vi.waitFor(() => {
        expect(mounted.onAddScript).toHaveBeenCalledWith({
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
        });
      });
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
      expect(mounted.onAddScript).not.toHaveBeenCalled();
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
        expect(mounted.onAddScript).toHaveBeenCalledWith({
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
        });
      });
    } finally {
      await mounted.cleanup();
    }
  });
});

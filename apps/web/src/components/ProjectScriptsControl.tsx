import type {
  ClaudeModelOptions,
  CodexModelOptions,
  ModelSelection,
  ProjectScript,
  ProjectScriptIcon,
  ProviderInteractionMode,
  ProviderKind,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import { isAgentProjectScript, isShellProjectScript } from "@t3tools/shared/projectScripts";
import {
  normalizeClaudeModelOptionsWithCapabilities,
  normalizeCodexModelOptionsWithCapabilities,
} from "@t3tools/shared/model";
import {
  BotIcon,
  BugIcon,
  ChevronDownIcon,
  FlaskConicalIcon,
  HammerIcon,
  LockIcon,
  LockOpenIcon,
  ListChecksIcon,
  PenLineIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react";
import React, { type FormEvent, type KeyboardEvent, useCallback, useMemo, useState } from "react";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import {
  actionPreferenceKey,
  commandForGlobalAction,
  commandForProjectScript,
  nextResolvedActionId,
  primaryProjectScript,
  type ActionScope,
} from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { isMacPlatform } from "~/lib/utils";
import {
  getProviderModelCapabilities,
  getProviderModels,
  getProviderSnapshot,
} from "~/providerModels";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { TraitsPicker } from "./chat/TraitsPicker";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Group, GroupSeparator } from "./ui/group";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
  { id: "agent", label: "Agent" },
];

const runtimeModeConfig: Record<
  RuntimeMode,
  {
    label: string;
    description: string;
    icon: typeof LockIcon;
  }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  if (icon === "agent") return <BotIcon className={className} />;
  return <PlayIcon className={className} />;
}

type ProjectScriptInputBase = {
  name: string;
  icon: ProjectScriptIcon;
  keybinding: string | null;
};

export type NewShellProjectScriptInput = ProjectScriptInputBase & {
  kind: "shell";
  command: string;
  runOnWorktreeCreate: boolean;
};

export type NewAgentProjectScriptInput = ProjectScriptInputBase & {
  kind: "agent";
  modelSelection: ModelSelection;
  prompt: string;
  submitPromptOnLaunch: boolean;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
};

export type NewProjectScriptInput = NewShellProjectScriptInput | NewAgentProjectScriptInput;

export interface ScopedAction {
  scope: ActionScope;
  action: ProjectScript;
}

export interface SaveScopedActionInput {
  scope: ActionScope;
  previousAction: ScopedAction | null;
  value: NewProjectScriptInput;
}

interface ProjectScriptsControlProps {
  projectScripts: readonly ProjectScript[];
  globalActions: readonly ProjectScript[];
  keybindings: ResolvedKeybindingsConfig;
  providers?: ReadonlyArray<ServerProvider> | undefined;
  preferredActionKey?: string | null;
  onRunAction: (action: ScopedAction) => void;
  onSaveAction: (input: SaveScopedActionInput) => Promise<void> | void;
  onDeleteAction: (action: ScopedAction) => Promise<void> | void;
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (normalized.startsWith("f") && normalized.length <= 3) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

function keybindingFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const keyToken = normalizeShortcutKeyToken(event.key);
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(navigator.platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (parts.length === 0) {
    return null;
  }
  parts.push(keyToken);
  return parts.join("+");
}

function defaultAgentSelection(providers: ReadonlyArray<ServerProvider>): {
  provider: ProviderKind;
  model: string;
} {
  const readyProvider = providers.find(
    (provider) => provider.enabled && provider.status === "ready" && provider.models.length > 0,
  );
  if (readyProvider) {
    return {
      provider: readyProvider.provider,
      model: readyProvider.models[0]?.slug ?? "",
    };
  }

  const firstProviderWithModels = providers.find((provider) => provider.models.length > 0);
  if (firstProviderWithModels) {
    return {
      provider: firstProviderWithModels.provider,
      model: firstProviderWithModels.models[0]?.slug ?? "",
    };
  }

  return {
    provider: "codex",
    model: "",
  };
}

function commandForScopedAction(scope: ActionScope, actionId: string) {
  return scope === "global" ? commandForGlobalAction(actionId) : commandForProjectScript(actionId);
}

function displayNameForAction(scope: ActionScope, action: ProjectScript): string {
  if (scope === "project" && isShellProjectScript(action) && action.runOnWorktreeCreate) {
    return `${action.name} (setup)`;
  }
  return action.name;
}

export default function ProjectScriptsControl({
  projectScripts,
  globalActions,
  keybindings,
  providers = [],
  preferredActionKey = null,
  onRunAction,
  onSaveAction,
  onDeleteAction,
}: ProjectScriptsControlProps) {
  const addScriptFormId = React.useId();
  const defaultSelection = useMemo(() => defaultAgentSelection(providers), [providers]);
  const modelOptionsByProvider = useMemo<
    Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>
  >(
    () => ({
      codex: getProviderModels(providers, "codex").map(({ slug, name }) => ({ slug, name })),
      claudeAgent: getProviderModels(providers, "claudeAgent").map(({ slug, name }) => ({
        slug,
        name,
      })),
    }),
    [providers],
  );

  const scopedProjectScripts = useMemo<ScopedAction[]>(
    () => projectScripts.map((action) => ({ scope: "project" as const, action })),
    [projectScripts],
  );
  const scopedGlobalActions = useMemo<ScopedAction[]>(
    () => globalActions.map((action) => ({ scope: "global" as const, action })),
    [globalActions],
  );
  const scopedActions = useMemo(
    () => [...scopedProjectScripts, ...scopedGlobalActions],
    [scopedGlobalActions, scopedProjectScripts],
  );

  const [editingAction, setEditingAction] = useState<ScopedAction | null>(null);
  const [scope, setScope] = useState<ActionScope>("project");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentProvider, setAgentProvider] = useState<ProviderKind>(defaultSelection.provider);
  const [agentModel, setAgentModel] = useState(defaultSelection.model);
  const [agentModelOptions, setAgentModelOptions] = useState<
    CodexModelOptions | ClaudeModelOptions | undefined
  >(undefined);
  const [agentInteractionMode, setAgentInteractionMode] =
    useState<ProviderInteractionMode>("default");
  const [agentRuntimeMode, setAgentRuntimeMode] = useState<RuntimeMode>("full-access");
  const [submitPromptOnLaunch, setSubmitPromptOnLaunch] = useState(true);
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const isEditing = editingAction !== null;
  const isAgentAction = icon === "agent";
  const isGlobalScope = scope === "global";
  const dropdownItemClassName =
    "data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground";
  const selectedAgentModels = useMemo(
    () => getProviderModels(providers, agentProvider),
    [agentProvider, providers],
  );
  const selectedAgentCapabilities = useMemo(
    () => getProviderModelCapabilities(selectedAgentModels, agentModel, agentProvider),
    [agentModel, agentProvider, selectedAgentModels],
  );
  const showsAgentTraits =
    selectedAgentCapabilities.reasoningEffortLevels.length > 0 ||
    selectedAgentCapabilities.supportsThinkingToggle ||
    selectedAgentCapabilities.supportsFastMode ||
    selectedAgentCapabilities.contextWindowOptions.length > 1;

  const primaryAction = useMemo(() => {
    if (preferredActionKey) {
      const preferred = scopedActions.find(
        ({ scope, action }) => actionPreferenceKey(scope, action.id) === preferredActionKey,
      );
      if (preferred) {
        return preferred;
      }
      const legacyProjectAction = scopedProjectScripts.find(
        ({ action }) => action.id === preferredActionKey,
      );
      if (legacyProjectAction) {
        return legacyProjectAction;
      }
    }

    const primaryProjectAction = primaryProjectScript(projectScripts);
    if (primaryProjectAction) {
      return { scope: "project" as const, action: primaryProjectAction };
    }

    const primaryGlobalAction = globalActions[0];
    return primaryGlobalAction ? { scope: "global" as const, action: primaryGlobalAction } : null;
  }, [globalActions, preferredActionKey, projectScripts, scopedActions, scopedProjectScripts]);

  const selectScriptIcon = useCallback(
    (nextIcon: ProjectScriptIcon) => {
      setIcon(nextIcon);
      if (nextIcon !== "agent") {
        return;
      }

      setRunOnWorktreeCreate(false);
      setAgentProvider((current) => {
        const currentModels = modelOptionsByProvider[current];
        if (currentModels.length > 0) {
          return current;
        }
        return defaultSelection.provider;
      });
      setAgentModel((current) => {
        if (current.length > 0) {
          return current;
        }
        return defaultSelection.model;
      });
    },
    [defaultSelection.model, defaultSelection.provider, modelOptionsByProvider],
  );

  const resetDialogState = useCallback(() => {
    setEditingAction(null);
    setScope("project");
    setName("");
    setCommand("");
    setPrompt("");
    setAgentProvider(defaultSelection.provider);
    setAgentModel(defaultSelection.model);
    setAgentModelOptions(undefined);
    setAgentInteractionMode("default");
    setAgentRuntimeMode("full-access");
    setSubmitPromptOnLaunch(true);
    setIcon("play");
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(false);
    setKeybinding("");
    setValidationError(null);
  }, [defaultSelection.model, defaultSelection.provider]);

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromEvent(event);
    if (!next) return;
    setKeybinding(next);
  };

  const openAddDialog = useCallback(() => {
    resetDialogState();
    setDialogOpen(true);
  }, [resetDialogState]);

  const handleGlobalScopeChange = useCallback((checked: boolean) => {
    setScope(checked ? "global" : "project");
    if (checked) {
      setRunOnWorktreeCreate(false);
    }
  }, []);

  const openEditDialog = useCallback(
    (nextAction: ScopedAction) => {
      setEditingAction(nextAction);
      setScope(nextAction.scope);
      setName(nextAction.action.name);
      setIcon(nextAction.action.icon);
      setIconPickerOpen(false);
      setKeybinding(
        keybindingValueForCommand(
          keybindings,
          commandForScopedAction(nextAction.scope, nextAction.action.id),
        ) ?? "",
      );
      setValidationError(null);

      if (isAgentProjectScript(nextAction.action)) {
        setCommand("");
        setPrompt(nextAction.action.prompt);
        setAgentProvider(nextAction.action.modelSelection.provider);
        setAgentModel(nextAction.action.modelSelection.model);
        setAgentModelOptions(nextAction.action.modelSelection.options);
        setAgentInteractionMode(nextAction.action.interactionMode);
        setAgentRuntimeMode(nextAction.action.runtimeMode);
        setSubmitPromptOnLaunch(nextAction.action.submitPromptOnLaunch);
        setRunOnWorktreeCreate(false);
      } else {
        setCommand(nextAction.action.command);
        setPrompt("");
        setAgentProvider(defaultSelection.provider);
        setAgentModel(defaultSelection.model);
        setAgentModelOptions(undefined);
        setAgentInteractionMode("default");
        setAgentRuntimeMode("full-access");
        setSubmitPromptOnLaunch(true);
        setRunOnWorktreeCreate(
          nextAction.scope === "global" ? false : nextAction.action.runOnWorktreeCreate,
        );
      }

      setDialogOpen(true);
    },
    [defaultSelection.model, defaultSelection.provider, keybindings],
  );

  const submitAddScript = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }

    setValidationError(null);

    try {
      const nextActionId = nextResolvedActionId({
        name: trimmedName,
        scope,
        projectScripts,
        globalActions,
        previousAction: editingAction,
      });
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForScopedAction(scope, nextActionId),
      });

      const payload: NewProjectScriptInput = isAgentAction
        ? (() => {
            const trimmedPrompt = prompt.trim();
            if (trimmedPrompt.length === 0) {
              throw new Error("Description is required.");
            }

            const selectedProvider = getProviderSnapshot(providers, agentProvider);
            if (!selectedProvider?.enabled || selectedProvider.status !== "ready") {
              throw new Error("Select a ready provider before saving an agent action.");
            }
            if (!selectedProvider.models.some((model) => model.slug === agentModel)) {
              throw new Error("Select a live model from the chosen provider before saving.");
            }

            const modelSelection: ModelSelection = (() => {
              if (agentProvider === "codex") {
                const options = normalizeCodexModelOptionsWithCapabilities(
                  getProviderModelCapabilities(selectedProvider.models, agentModel, "codex"),
                  agentModelOptions as CodexModelOptions | undefined,
                );
                return options
                  ? {
                      provider: "codex",
                      model: agentModel,
                      options,
                    }
                  : {
                      provider: "codex",
                      model: agentModel,
                    };
              }

              const options = normalizeClaudeModelOptionsWithCapabilities(
                getProviderModelCapabilities(selectedProvider.models, agentModel, "claudeAgent"),
                agentModelOptions as ClaudeModelOptions | undefined,
              );
              return options
                ? {
                    provider: "claudeAgent",
                    model: agentModel,
                    options,
                  }
                : {
                    provider: "claudeAgent",
                    model: agentModel,
                  };
            })();

            return {
              kind: "agent",
              name: trimmedName,
              icon,
              modelSelection,
              prompt: trimmedPrompt,
              submitPromptOnLaunch,
              runtimeMode: agentRuntimeMode,
              interactionMode: agentInteractionMode,
              keybinding: keybindingRule?.key ?? null,
            };
          })()
        : (() => {
            const trimmedCommand = command.trim();
            if (trimmedCommand.length === 0) {
              throw new Error("Command is required.");
            }

            return {
              kind: "shell",
              name: trimmedName,
              command: trimmedCommand,
              icon,
              runOnWorktreeCreate: isGlobalScope ? false : runOnWorktreeCreate,
              keybinding: keybindingRule?.key ?? null,
            };
          })();

      await onSaveAction({
        scope,
        previousAction: editingAction,
        value: payload,
      });
      setDialogOpen(false);
      setIconPickerOpen(false);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
    }
  };

  const confirmDeleteScript = useCallback(() => {
    if (!editingAction) return;
    setDeleteConfirmOpen(false);
    setDialogOpen(false);
    void onDeleteAction(editingAction);
  }, [editingAction, onDeleteAction]);

  const renderActionItem = useCallback(
    ({ scope, action }: ScopedAction) => {
      const shortcutLabel = shortcutLabelForCommand(
        keybindings,
        commandForScopedAction(scope, action.id),
      );

      return (
        <MenuItem
          key={`${scope}:${action.id}`}
          className={`group ${dropdownItemClassName}`}
          onClick={() => onRunAction({ scope, action })}
        >
          <ScriptIcon icon={action.icon} className="size-4" />
          <span className="truncate">{displayNameForAction(scope, action)}</span>
          <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
            {shortcutLabel && (
              <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                {shortcutLabel}
              </MenuShortcut>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-0 top-1/2 size-6 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"
              aria-label={`Edit ${action.name}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openEditDialog({ scope, action });
              }}
            >
              <SettingsIcon className="size-3.5" />
            </Button>
          </span>
        </MenuItem>
      );
    },
    [dropdownItemClassName, keybindings, onRunAction, openEditDialog],
  );

  return (
    <>
      {primaryAction ? (
        <Group aria-label="Actions">
          <Button
            size="xs"
            variant="outline"
            onClick={() => onRunAction(primaryAction)}
            title={`Run ${primaryAction.action.name}`}
          >
            <ScriptIcon icon={primaryAction.action.icon} />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              {primaryAction.action.name}
            </span>
          </Button>
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu highlightItemOnHover={false}>
            <MenuTrigger render={<Button size="icon-xs" variant="outline" aria-label="Actions" />}>
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {scopedProjectScripts.map(renderActionItem)}
              {scopedProjectScripts.length > 0 && scopedGlobalActions.length > 0 ? (
                <MenuSeparator />
              ) : null}
              {scopedGlobalActions.map(renderActionItem)}
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add action
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      ) : (
        <Button size="xs" variant="outline" onClick={openAddDialog} title="Add action">
          <PlusIcon className="size-3.5" />
          <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
            Add action
          </span>
        </Button>
      )}

      <Dialog
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setIconPickerOpen(false);
          }
        }}
        onOpenChangeComplete={(open) => {
          if (open) return;
          resetDialogState();
        }}
        open={dialogOpen}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Action" : "Add Action"}</DialogTitle>
            <DialogDescription>
              Actions are commands or agent launches you can run from the top bar or keybindings.
              Global actions are available in every project.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={addScriptFormId} className="space-y-4" onSubmit={submitAddScript}>
              <div className="space-y-1.5">
                <Label htmlFor="script-name">Name</Label>
                <div className="flex items-center gap-2">
                  <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="size-9 shrink-0 hover:bg-popover active:bg-popover data-pressed:bg-popover data-pressed:shadow-xs/5 data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)]"
                          aria-label="Choose icon"
                        />
                      }
                    >
                      <ScriptIcon icon={icon} className="size-4.5" />
                    </PopoverTrigger>
                    <PopoverPopup align="start">
                      <div className="grid grid-cols-3 gap-2">
                        {SCRIPT_ICONS.map((entry) => {
                          const isSelected = entry.id === icon;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs ${
                                isSelected
                                  ? "border-primary/70 bg-primary/10"
                                  : "border-border/70 hover:bg-accent/60"
                              }`}
                              onClick={() => {
                                selectScriptIcon(entry.id);
                                setIconPickerOpen(false);
                              }}
                            >
                              <ScriptIcon icon={entry.id} className="size-4" />
                              <span>{entry.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverPopup>
                  </Popover>
                  <Input
                    id="script-name"
                    autoFocus
                    placeholder={isAgentAction ? "Review" : "Test"}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="script-keybinding">Keybinding</Label>
                <Input
                  id="script-keybinding"
                  placeholder="Press shortcut"
                  value={keybinding}
                  readOnly
                  onKeyDown={captureKeybinding}
                />
                <p className="text-xs text-muted-foreground">
                  Press a shortcut. Use <code>Backspace</code> to clear.
                </p>
              </div>

              {isAgentAction ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Agent Settings</Label>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <ProviderModelPicker
                          provider={agentProvider}
                          model={agentModel}
                          lockedProvider={null}
                          providers={providers}
                          modelOptionsByProvider={modelOptionsByProvider}
                          triggerVariant="outline"
                          triggerClassName="max-w-full justify-between text-foreground"
                          onProviderModelChange={(provider, model) => {
                            setAgentProvider(provider);
                            setAgentModel(model);
                          }}
                        />
                        {showsAgentTraits ? (
                          <TraitsPicker
                            provider={agentProvider}
                            models={selectedAgentModels}
                            model={agentModel}
                            prompt={prompt}
                            onPromptChange={setPrompt}
                            modelOptions={agentModelOptions}
                            onModelOptionsChange={(nextOptions) => {
                              setAgentModelOptions(
                                nextOptions as CodexModelOptions | ClaudeModelOptions | undefined,
                              );
                            }}
                            triggerVariant="outline"
                            triggerClassName="max-w-full justify-between text-foreground"
                          />
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0"
                          onClick={() =>
                            setAgentInteractionMode((current) =>
                              current === "plan" ? "default" : "plan",
                            )
                          }
                          title={
                            agentInteractionMode === "plan"
                              ? "Plan mode — click to return to normal build mode"
                              : "Default mode — click to enter plan mode"
                          }
                        >
                          <BotIcon className="size-4" />
                          {agentInteractionMode === "plan" ? "Plan" : "Build"}
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={agentRuntimeMode}
                          onValueChange={(value) => setAgentRuntimeMode(value as RuntimeMode)}
                        >
                          <SelectTrigger
                            variant="default"
                            size="sm"
                            className="w-auto shrink-0 border-input font-medium"
                            aria-label="Runtime mode"
                            title={runtimeModeConfig[agentRuntimeMode].description}
                          >
                            {React.createElement(runtimeModeConfig[agentRuntimeMode].icon, {
                              className: "size-4",
                            })}
                            <SelectValue>{runtimeModeConfig[agentRuntimeMode].label}</SelectValue>
                          </SelectTrigger>
                          <SelectPopup alignItemWithTrigger={false}>
                            {runtimeModeOptions.map((mode) => {
                              const option = runtimeModeConfig[mode];
                              const OptionIcon = option.icon;
                              return (
                                <SelectItem key={mode} value={mode} className="min-w-64 py-2">
                                  <div className="grid min-w-0 gap-0.5">
                                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                                      <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                      {option.label}
                                    </span>
                                    <span className="text-muted-foreground text-xs leading-4">
                                      {option.description}
                                    </span>
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectPopup>
                        </Select>
                        <label className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border/70 px-3 text-sm font-medium">
                          <Checkbox
                            aria-label="Auto-submit"
                            checked={submitPromptOnLaunch}
                            onCheckedChange={(checked) => setSubmitPromptOnLaunch(Boolean(checked))}
                          />
                          <span>Auto-submit</span>
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="script-prompt">Description</Label>
                    <Textarea
                      id="script-prompt"
                      placeholder="Review the current branch and summarize the highest-risk changes."
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                    <span>Global</span>
                    <Switch
                      aria-label="Global"
                      checked={isGlobalScope}
                      onCheckedChange={(checked) => handleGlobalScopeChange(Boolean(checked))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="script-command">Command</Label>
                    <Textarea
                      id="script-command"
                      placeholder="bun run test"
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                    />
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                    <span>Global</span>
                    <Switch
                      aria-label="Global"
                      checked={isGlobalScope}
                      onCheckedChange={(checked) => handleGlobalScopeChange(Boolean(checked))}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                    <span>Run automatically on worktree creation</span>
                    <Switch
                      checked={runOnWorktreeCreate}
                      disabled={isGlobalScope}
                      onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
                    />
                  </label>
                  {isGlobalScope ? (
                    <p className="text-xs text-muted-foreground">
                      Global shell actions cannot run automatically on worktree creation.
                    </p>
                  ) : null}
                </>
              )}

              {validationError && <p className="text-sm text-destructive">{validationError}</p>}
            </form>
          </DialogPanel>
          <DialogFooter>
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button form={addScriptFormId} type="submit">
              {isEditing ? "Save changes" : "Save action"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete action "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDeleteScript}>
              Delete action
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

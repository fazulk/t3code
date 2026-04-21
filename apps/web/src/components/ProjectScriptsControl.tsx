import type {
  AgentActionConfig,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
  ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import {
  BotIcon,
  BugIcon,
  ChevronDownIcon,
  FlaskConicalIcon,
  GlobeIcon,
  HammerIcon,
  ListChecksIcon,
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
  commandForProjectScript,
  nextProjectScriptId,
  primaryProjectScript,
} from "~/projectScripts";
import { type ScopedProjectScript, type ScriptScope } from "~/scopedProjectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { isMacPlatform } from "~/lib/utils";
import { type AgentActionDefaults } from "~/lib/agentActionDefaults";
import { AgentActionFields } from "./AgentActionFields";
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
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
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

function cloneAgentActionConfig(config: AgentActionConfig): AgentActionConfig {
  if (config.provider === "codex") {
    return {
      ...config,
      modelSelection: config.modelSelection.options
        ? {
            ...config.modelSelection,
            options: { ...config.modelSelection.options },
          }
        : { ...config.modelSelection },
    };
  }

  return {
    ...config,
    modelSelection: config.modelSelection.options
      ? {
          ...config.modelSelection,
          options: { ...config.modelSelection.options },
        }
      : { ...config.modelSelection },
  };
}

function createAgentActionConfigFromDefaults(defaults: AgentActionDefaults): AgentActionConfig {
  if (defaults.provider === "codex") {
    return {
      provider: "codex",
      modelSelection: defaults.modelSelection.options
        ? {
            ...defaults.modelSelection,
            options: { ...defaults.modelSelection.options },
          }
        : { ...defaults.modelSelection },
      runtimeMode: defaults.runtimeMode,
      interactionMode: defaults.interactionMode,
    };
  }

  return {
    provider: "claudeAgent",
    modelSelection: defaults.modelSelection.options
      ? {
          ...defaults.modelSelection,
          options: { ...defaults.modelSelection.options },
        }
      : { ...defaults.modelSelection },
    runtimeMode: defaults.runtimeMode,
    interactionMode: defaults.interactionMode,
  };
}

export interface NewProjectScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  agentConfig: AgentActionConfig | null;
  scope: ScriptScope;
  runOnWorktreeCreate: boolean;
  keybinding: string | null;
}

interface ProjectScriptsControlProps {
  scripts: ScopedProjectScript[];
  keybindings: ResolvedKeybindingsConfig;
  providerStatuses: ReadonlyArray<ServerProvider>;
  settings: UnifiedSettings;
  agentActionDefaults: AgentActionDefaults;
  preferredScriptId?: string | null;
  onRunScript: (script: ScopedProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<void> | void;
  onUpdateScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void> | void;
  onDeleteScript: (scriptId: string) => Promise<void> | void;
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

export default function ProjectScriptsControl({
  scripts,
  keybindings,
  providerStatuses,
  settings,
  agentActionDefaults,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const addScriptFormId = React.useId();
  const [editingScript, setEditingScript] = useState<ScopedProjectScript | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [scope, setScope] = useState<ScriptScope>("project");
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [agentConfig, setAgentConfig] = useState<AgentActionConfig | null>(null);
  const [keybinding, setKeybinding] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const primaryScript = useMemo<ScopedProjectScript | null>(() => {
    if (preferredScriptId) {
      const preferred = scripts.find((script) => script.id === preferredScriptId);
      if (preferred) return preferred;
    }
    return primaryProjectScript(scripts) as ScopedProjectScript | null;
  }, [preferredScriptId, scripts]);
  const editingScriptId = editingScript?.id ?? null;
  const isEditing = editingScript !== null;
  const isGlobalScope = scope === "global";
  const isAgentIcon = icon === "agent";
  const existingIdsForScope = useMemo(
    () => scripts.filter((script) => script.scope === scope).map((script) => script.id),
    [scope, scripts],
  );
  const dropdownItemClassName =
    "data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground";

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

  const submitAddScript = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError(isAgentIcon ? "Prompt is required." : "Command is required.");
      return;
    }
    if (isAgentIcon && !agentConfig) {
      setValidationError("Agent settings are required.");
      return;
    }

    setValidationError(null);
    try {
      const scriptIdForValidation =
        editingScriptId ?? nextProjectScriptId(trimmedName, existingIdsForScope);
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const payload = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        agentConfig: isAgentIcon && agentConfig ? cloneAgentActionConfig(agentConfig) : null,
        scope,
        runOnWorktreeCreate: isGlobalScope ? false : runOnWorktreeCreate,
        keybinding: keybindingRule?.key ?? null,
      } satisfies NewProjectScriptInput;
      if (editingScriptId) {
        await onUpdateScript(editingScriptId, payload);
      } else {
        await onAddScript(payload);
      }
      setDialogOpen(false);
      setIconPickerOpen(false);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
    }
  };

  const openAddDialog = () => {
    setEditingScript(null);
    setName("");
    setCommand("");
    setIcon("play");
    setIconPickerOpen(false);
    setScope("project");
    setRunOnWorktreeCreate(false);
    setAgentConfig(null);
    setKeybinding("");
    setValidationError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (script: ScopedProjectScript) => {
    setEditingScript(script);
    setName(script.name);
    setCommand(script.command);
    setIcon(script.icon);
    setIconPickerOpen(false);
    setScope(script.scope);
    setRunOnWorktreeCreate(script.runOnWorktreeCreate);
    setAgentConfig(script.agentConfig ? cloneAgentActionConfig(script.agentConfig) : null);
    setKeybinding(keybindingValueForCommand(keybindings, commandForProjectScript(script.id)) ?? "");
    setValidationError(null);
    setDialogOpen(true);
  };

  const confirmDeleteScript = useCallback(() => {
    if (!editingScriptId) return;
    setDeleteConfirmOpen(false);
    setDialogOpen(false);
    void onDeleteScript(editingScriptId);
  }, [editingScriptId, onDeleteScript]);

  return (
    <>
      {primaryScript ? (
        <Group aria-label="Actions">
          <Button
            size="xs"
            variant="outline"
            onClick={() => onRunScript(primaryScript)}
            title={`Run ${primaryScript.name}`}
          >
            <ScriptIcon icon={primaryScript.icon} />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              {primaryScript.name}
            </span>
          </Button>
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu highlightItemOnHover={false}>
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="Script actions" />}
            >
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {scripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  keybindings,
                  commandForProjectScript(script.id),
                );
                return (
                  <React.Fragment key={script.id}>
                    <MenuItem
                      className={`group ${dropdownItemClassName}`}
                      onClick={() => onRunScript(script)}
                    >
                      <ScriptIcon icon={script.icon} className="size-4" />
                      <span className="truncate">
                        {script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name}
                      </span>
                      <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end pr-7">
                        {script.scope === "global" && (
                          <GlobeIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                        )}
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
                          aria-label={`Edit ${script.name}`}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openEditDialog(script);
                          }}
                        >
                          <SettingsIcon className="size-3.5" />
                        </Button>
                      </span>
                    </MenuItem>
                  </React.Fragment>
                );
              })}
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
          setEditingScript(null);
          setName("");
          setCommand("");
          setIcon("play");
          setScope("project");
          setRunOnWorktreeCreate(false);
          setAgentConfig(null);
          setKeybinding("");
          setValidationError(null);
        }}
        open={dialogOpen}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Action" : "Add Action"}</DialogTitle>
            <DialogDescription>
              Actions run from the top bar or keybindings. Turn on Use in any project to save one
              globally on this client.
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
                                if (entry.id === "agent" && !agentConfig) {
                                  setAgentConfig(
                                    createAgentActionConfigFromDefaults(agentActionDefaults),
                                  );
                                }
                                setIcon(entry.id);
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
                    placeholder="Test"
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
              <div className="space-y-1.5">
                <Label htmlFor="script-command">{isAgentIcon ? "Prompt" : "Command"}</Label>
                <Textarea
                  id="script-command"
                  placeholder={
                    isAgentIcon ? "Review the repo and explain the failing test." : "bun test"
                  }
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
              {isAgentIcon && agentConfig ? (
                <AgentActionFields
                  value={agentConfig}
                  providerStatuses={providerStatuses}
                  settings={settings}
                  prompt={command}
                  onPromptChange={setCommand}
                  onChange={(nextAgentConfig) => {
                    setAgentConfig(nextAgentConfig);
                  }}
                />
              ) : null}
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                <span className="space-y-1">
                  <span className="block">Run automatically on worktree creation</span>
                  {isGlobalScope && (
                    <span className="block text-xs text-muted-foreground">
                      Setup automation is project-only.
                    </span>
                  )}
                </span>
                <Switch
                  checked={runOnWorktreeCreate}
                  disabled={isGlobalScope}
                  onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                <span>Global action</span>
                <Switch
                  checked={isGlobalScope}
                  onCheckedChange={(checked) => {
                    const nextScope = checked ? "global" : "project";
                    setScope(nextScope);
                    if (checked) {
                      setRunOnWorktreeCreate(false);
                    }
                  }}
                />
              </label>
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

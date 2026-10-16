import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  ProviderInstanceId,
  type EnvironmentId,
  type GlobalAction,
  type GlobalActionTarget,
  type ModelSelection,
  type ProjectScriptIcon,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import React, { type FormEvent, useMemo, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { nextProjectScriptId } from "~/projectScripts";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { ScriptIcon, ScriptIconGrid } from "./projectScriptEditor";
import { scheduledTaskDefaultModel } from "./settings/scheduledTasksSettings.logic";
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
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

type WorkspaceChoice = ThreadEnvMode | "default";

const TARGET_LABELS: Record<GlobalActionTarget, string> = {
  "new-thread": "New thread",
  "current-thread": "Current thread",
};

const WORKSPACE_LABELS: Record<WorkspaceChoice, string> = {
  default: "Project default",
  local: "Project checkout",
  worktree: "New worktree",
};

/** `action` is the one being edited, or null to add a new action. */
export interface GlobalActionEditorRequest {
  readonly action: GlobalAction | null;
}

/**
 * Adds, edits, and deletes environment global actions. `onSave` receives the
 * whole next list, matching how the setting is stored.
 */
export function GlobalActionEditorDialog(props: {
  environmentId: EnvironmentId;
  request: GlobalActionEditorRequest | null;
  actions: readonly GlobalAction[];
  onSave: (next: readonly GlobalAction[]) => Promise<AtomCommandResult<unknown, unknown>>;
  onClose: () => void;
}) {
  const { request, onClose } = props;
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      {request ? (
        <GlobalActionEditorPopup key={request.action?.id ?? "new"} {...props} request={request} />
      ) : null}
    </Dialog>
  );
}

/** The form, mounted per request so each opening starts from that action. */
function GlobalActionEditorPopup({
  environmentId,
  request,
  actions,
  onSave,
  onClose,
}: {
  environmentId: EnvironmentId;
  request: GlobalActionEditorRequest;
  actions: readonly GlobalAction[];
  onSave: (next: readonly GlobalAction[]) => Promise<AtomCommandResult<unknown, unknown>>;
  onClose: () => void;
}) {
  const canEdit = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const formId = React.useId();
  const [name, setName] = useState(request.action?.name ?? "");
  const [prompt, setPrompt] = useState(request.action?.prompt ?? "");
  const [icon, setIcon] = useState<ProjectScriptIcon>(request.action?.icon ?? "play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [model, setModel] = useState<ModelSelection | null>(request.action?.modelSelection ?? null);
  const [workspace, setWorkspace] = useState<WorkspaceChoice>(
    request.action?.workspace ?? "default",
  );
  const [target, setTarget] = useState<GlobalActionTarget>(request.action?.target ?? "new-thread");
  const [autoSubmit, setAutoSubmit] = useState(request.action?.autoSubmit ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, null),
      ),
    [providers, settings],
  );
  const pickerSelection = model ?? scheduledTaskDefaultModel(settings, null, instanceEntries);
  const pickerInstanceId =
    pickerSelection?.instanceId ?? instanceEntries[0]?.instanceId ?? ProviderInstanceId.make("");
  const pickerModel = pickerSelection?.model ?? "";
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers, pickerInstanceId, pickerModel),
    [settings, providers, pickerInstanceId, pickerModel],
  );

  const persist = async (next: readonly GlobalAction[]) => {
    setSaving(true);
    const result = await onSave(next);
    setSaving(false);
    if (result._tag === "Success") {
      onClose();
    } else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Failed to save action.");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (trimmedName.length === 0 || trimmedPrompt.length === 0) {
      setError(trimmedName.length === 0 ? "Name is required." : "Prompt is required.");
      return;
    }
    const id =
      request.action?.id ??
      nextProjectScriptId(
        trimmedName,
        actions.map((action) => action.id),
      );
    const next: GlobalAction = {
      id,
      name: trimmedName,
      prompt: trimmedPrompt,
      icon,
      ...(target === "current-thread"
        ? { target }
        : {
            ...(model ? { modelSelection: model } : {}),
            ...(workspace === "default" ? {} : { workspace }),
          }),
      ...(autoSubmit ? {} : { autoSubmit }),
    };
    void persist(
      request.action
        ? actions.map((action) => (action.id === id ? next : action))
        : [...actions, next],
    );
  };

  const remove = async (id: string) => {
    const message = `Delete global action "${name.trim() || "Untitled"}"?`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (confirmed) await persist(actions.filter((action) => action.id !== id));
  };

  const isEditing = request.action !== null;
  return (
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Edit Global Action" : "Add Global Action"}</DialogTitle>
        <DialogDescription>
          Global actions appear under every project's actions. Running one sends this prompt in the
          current thread or in a new thread in that project.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form id={formId} onSubmit={submit}>
          <fieldset className="space-y-4" disabled={saving || !canEdit}>
            <div className="space-y-1.5">
              <Label htmlFor="global-action-name">Name</Label>
              <div className="flex items-center gap-2">
                <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className="size-9 shrink-0"
                        aria-label="Choose icon"
                      />
                    }
                  >
                    <ScriptIcon icon={icon} className="size-4.5" />
                  </PopoverTrigger>
                  <PopoverPopup align="start">
                    <ScriptIconGrid
                      icon={icon}
                      onSelect={(next) => {
                        setIcon(next);
                        setIconPickerOpen(false);
                      }}
                    />
                  </PopoverPopup>
                </Popover>
                <Input
                  id="global-action-name"
                  autoFocus
                  placeholder="Review branch"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="global-action-prompt">Prompt</Label>
              <Textarea
                id="global-action-prompt"
                className="max-h-64 overflow-y-auto"
                placeholder="/review Look over the current branch for bugs"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="global-action-target">Run in</Label>
              <Select
                value={target}
                onValueChange={(value) => setTarget(value as GlobalActionTarget)}
              >
                <SelectTrigger size="sm" id="global-action-target">
                  <SelectValue>{TARGET_LABELS[target]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="new-thread">{TARGET_LABELS["new-thread"]}</SelectItem>
                  <SelectItem value="current-thread">{TARGET_LABELS["current-thread"]}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="global-action-auto-submit">Auto submit</Label>
                <p className="text-xs text-muted-foreground">
                  Off leaves the prompt in the composer for you to edit and send.
                </p>
              </div>
              <Switch
                id="global-action-auto-submit"
                checked={autoSubmit}
                onCheckedChange={(checked) => setAutoSubmit(Boolean(checked))}
              />
            </div>
            {target === "new-thread" && (
              <>
                <div className="space-y-1.5">
                  <Label>Model</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={model ? "custom" : "default"}
                      onValueChange={(value) =>
                        setModel(value === "custom" ? pickerSelection : null)
                      }
                    >
                      <SelectTrigger size="sm" aria-label="Model source">
                        <SelectValue>
                          {model ? "Choose a model" : "Current thread's model"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="default">Current thread's model</SelectItem>
                        <SelectItem value="custom">Choose a model</SelectItem>
                      </SelectPopup>
                    </Select>
                    {model ? (
                      <ProviderModelPicker
                        environmentId={environmentId}
                        disabled={saving || !canEdit}
                        activeInstanceId={pickerInstanceId}
                        model={pickerModel}
                        lockedProvider={null}
                        instanceEntries={instanceEntries}
                        modelOptionsByInstance={modelOptionsByInstance}
                        isComposerOwned={false}
                        onInstanceModelChange={(instanceId, nextModel) =>
                          setModel({ instanceId, model: nextModel })
                        }
                      />
                    ) : null}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="global-action-workspace">Workspace</Label>
                  <Select
                    value={workspace}
                    onValueChange={(value) => setWorkspace(value as WorkspaceChoice)}
                  >
                    <SelectTrigger size="sm" id="global-action-workspace">
                      <SelectValue>{WORKSPACE_LABELS[workspace]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="default">{WORKSPACE_LABELS.default}</SelectItem>
                      <SelectItem value="local">{WORKSPACE_LABELS.local}</SelectItem>
                      <SelectItem value="worktree">{WORKSPACE_LABELS.worktree}</SelectItem>
                    </SelectPopup>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A new worktree branches from the project checkout's current branch.
                  </p>
                </div>
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </fieldset>
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        {isEditing && (
          <Button
            type="button"
            variant="destructive-outline"
            className="mr-auto"
            disabled={saving || !canEdit}
            onClick={() => request.action && void remove(request.action.id)}
          >
            Delete
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button form={formId} type="submit" disabled={saving || !canEdit}>
          {saving ? "Saving…" : isEditing ? "Save changes" : "Save action"}
        </Button>
      </DialogFooter>
    </DialogPopup>
  );
}

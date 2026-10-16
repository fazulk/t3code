import type { EnvironmentId } from "@t3tools/contracts";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import { useGlobalActions } from "../../hooks/useGlobalActions";
import { GlobalActionEditorDialog, type GlobalActionEditorRequest } from "../globalActionEditor";
import { ScriptIcon } from "../projectScriptEditor";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useScopedSettingsWriteAllowed } from "./useScopedSettings";

/** One environment's global actions, which every project's actions menu lists. */
export function GlobalActionsSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const { actions, save } = useGlobalActions(environmentId);
  const canWriteSettings = useScopedSettingsWriteAllowed();
  const [request, setRequest] = useState<GlobalActionEditorRequest | null>(null);

  return (
    <SettingsSection id="global-actions" title="Global actions">
      <SettingsRow
        title="Global actions"
        description="Saved prompts listed under every project's actions. Each runs in the current thread or a new one."
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={!canWriteSettings}
            onClick={() => setRequest({ action: null })}
          >
            <PlusIcon className="size-3.5" />
            Add global action
          </Button>
        }
      />
      {actions.length === 0 ? (
        <p className="px-3 py-2 text-base text-muted-foreground sm:px-4 sm:text-sm">
          No global actions configured.
        </p>
      ) : (
        actions.map((action) => (
          <SettingsRow
            key={action.id}
            className="group py-2"
            title={
              <span className="flex min-w-0 items-center gap-2">
                <ScriptIcon icon={action.icon} className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{action.name}</span>
              </span>
            }
            description={<span className="block max-w-full truncate">{action.prompt}</span>}
            control={
              <span className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Edit ${action.name}`}
                  disabled={!canWriteSettings}
                  onClick={() => setRequest({ action })}
                >
                  <SettingsIcon className="size-3.5" />
                </Button>
              </span>
            }
          />
        ))
      )}
      <GlobalActionEditorDialog
        environmentId={environmentId}
        request={request}
        actions={actions}
        onSave={save}
        onClose={() => setRequest(null)}
      />
    </SettingsSection>
  );
}

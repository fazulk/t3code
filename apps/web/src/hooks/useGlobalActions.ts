import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, GlobalAction, ModelSelection, ProjectId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useEnvironmentSettings } from "./useSettings";

const NO_GLOBAL_ACTIONS: readonly GlobalAction[] = [];

/** What the thread a global action is invoked from lends it. */
export interface GlobalActionHost {
  readonly projectId: ProjectId;
  /** The composer's model, which a new thread uses when the action has none. */
  readonly readModelSelection: () => ModelSelection | null;
  readonly insertPrompt: (text: string) => void;
  /** Absent until the thread has started; current-thread actions then fill the composer. */
  readonly sendPrompt?: (text: string) => Promise<void>;
}

/**
 * The environment's global actions. `run` sends the prompt in the invoking
 * thread or starts a new thread with it, or, when the action doesn't submit,
 * leaves it in that thread's composer; `save` replaces the whole list.
 */
export function useGlobalActions(environmentId: EnvironmentId) {
  const router = useRouter();
  const newThread = useNewThreadHandler();
  const actions = useEnvironmentSettings(
    environmentId,
    (settings) => settings.globalActions ?? NO_GLOBAL_ACTIONS,
  );
  const canLaunch = useAtomValue(serverEnvironment.runGlobalAction.permissionAtom(environmentId));
  const runCommand = useAtomCommand(serverEnvironment.runGlobalAction, "global action run");
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "global actions update");

  /** Only launching a submitted new thread goes through the server's guarded command. */
  const canRun = useCallback(
    (action: GlobalAction) =>
      action.target === "current-thread" || action.autoSubmit === false || canLaunch,
    [canLaunch],
  );

  const run = useCallback(
    async (action: GlobalAction, host: GlobalActionHost) => {
      const submit = action.autoSubmit !== false;
      if (action.target === "current-thread") {
        if (!submit || !host.sendPrompt) {
          host.insertPrompt(action.prompt);
          return;
        }
        await host.sendPrompt(action.prompt).catch((error: unknown) =>
          toastManager.add({
            type: "error",
            title: `Could not run ${action.name}`,
            description: error instanceof Error ? error.message : "The message was not sent.",
          }),
        );
        return;
      }
      const modelSelection = host.readModelSelection();
      if (!submit) {
        const session = await newThread(
          scopeProjectRef(environmentId, host.projectId),
          action.workspace ? { envMode: action.workspace } : undefined,
        );
        if (session === null) return;
        const store = useComposerDraftStore.getState();
        store.setPrompt(session.draftId, action.prompt);
        const draftModel = action.modelSelection ?? modelSelection;
        if (draftModel) {
          store.setModelSelection(session.draftId, draftModel, { replaceOptions: true });
        }
        return;
      }
      const result = await runCommand({
        environmentId,
        input: {
          actionId: action.id,
          projectId: host.projectId,
          ...(modelSelection ? { modelSelection } : {}),
          creationSource: "web",
        },
      });
      if (result._tag === "Success") {
        await router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams({ environmentId, threadId: result.value.threadId }),
        });
      }
    },
    [environmentId, newThread, router, runCommand],
  );

  const save = useCallback(
    (next: readonly GlobalAction[]) =>
      updateSettings({ environmentId, input: { patch: { globalActions: next } } }),
    [environmentId, updateSettings],
  );

  return { actions, canRun, run, save };
}

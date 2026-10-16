import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  GlobalActionError,
  MessageId,
  ThreadId,
  type GlobalActionRunInput,
  type GlobalActionRunResult,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as ServerSettings from "../serverSettings.ts";

export class GlobalActionService extends Context.Service<
  GlobalActionService,
  {
    /**
     * Start a new thread in the project and send the action's prompt. The
     * action's model wins, then the invoking thread's, then the project
     * default. The action's workspace wins over the project default, and a
     * new worktree branches from the checkout's current branch. Current-thread
     * and unsent actions never reach the server: clients handle them in their
     * own composer.
     */
    readonly run: (
      input: GlobalActionRunInput,
    ) => Effect.Effect<GlobalActionRunResult, GlobalActionError>;
  }
>()("t3/globalActions/GlobalActionService") {}

const fail = (message: string) => (cause?: unknown) =>
  new GlobalActionError({ message, ...(cause === undefined ? {} : { cause }) });

export const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectService.ProjectService;
  const projectFiles = yield* T3ProjectFileLoader.T3ProjectFileLoader;
  const git = yield* GitWorkflow.GitWorkflowService;
  const threadLaunch = yield* ThreadLaunch.ThreadLaunchService;

  const run: GlobalActionService["Service"]["run"] = Effect.fn("GlobalActionService.run")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({
        "global_action.id": input.actionId,
        "project.id": input.projectId,
      });
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(fail("Could not read settings.")),
      );
      const action = settings.globalActions.find((candidate) => candidate.id === input.actionId);
      if (action === undefined) return yield* fail("This global action no longer exists.")();
      const project = Option.getOrUndefined(
        yield* projects
          .getById(input.projectId)
          .pipe(Effect.mapError(fail("Could not read the project."))),
      );
      if (project === undefined) return yield* fail("The project was not found.")();

      const projectFile = Option.getOrNull(yield* projectFiles.load(project.workspaceRoot));
      const defaults = resolveProjectSettings(settings, project.id, project, projectFile).settings;
      const modelSelection =
        action.modelSelection ?? input.modelSelection ?? defaults.defaultModelSelection;
      if (modelSelection === null)
        return yield* fail(
          `"${action.name}" has no model. Pick one on the action, or set a default model in Settings.`,
        )();

      const workspaceStrategy =
        (action.workspace ?? defaults.defaultThreadEnvMode) === "worktree"
          ? yield* git.localStatus({ cwd: project.workspaceRoot }).pipe(
              Effect.map((status) =>
                !status.isRepo
                  ? { type: "root" as const }
                  : status.refName === null
                    ? { type: "worktree" as const, baseRef: "HEAD" }
                    : {
                        type: "worktree" as const,
                        baseRef: status.refName,
                        ...(defaults.newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
                      },
              ),
              Effect.mapError(fail("Could not read the project's git status.")),
            )
          : { type: "root" as const };

      const uuid = yield* randomUuidV4;
      const result = yield* threadLaunch
        .launch({
          commandId: CommandId.make(`global-action:${uuid}`),
          threadId: ThreadId.make(uuid),
          projectId: project.id,
          title: action.name,
          modelSelection,
          runtimeMode: defaults.defaultRuntimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          workspaceStrategy,
          initialMessage: {
            messageId: MessageId.make(`global-action-message:${uuid}`),
            text: action.prompt,
            attachments: [],
          },
          createdBy: "user",
          creationSource: input.creationSource ?? "web",
        })
        .pipe(Effect.mapError((error) => fail(error.message)(error)));
      return { threadId: result.threadId };
    },
  );

  return GlobalActionService.of({ run });
});

export const layer = Layer.effect(GlobalActionService, make);

import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  type GlobalAction,
  type ModelSelection,
  type Project,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as GlobalActionService from "./GlobalActionService.ts";

const projectId = ProjectId.make("project:test");
const codex: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
const claude: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
};
const review: GlobalAction = {
  id: "review",
  name: "Review branch",
  prompt: "Review the current branch for bugs",
  icon: "test",
};

const project: Project = {
  id: projectId,
  title: "test",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  deletedAt: null,
};

/** Runs one action and returns the launch it produced, or the failure message. */
const runAction = (
  settings: Partial<ServerSettings>,
  input: { actionId?: string; modelSelection?: ModelSelection } = {},
) =>
  Effect.gen(function* () {
    const launches = yield* Ref.make<ReadonlyArray<ThreadLaunch.ThreadLaunchInput>>([]);
    const layer = GlobalActionService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerSettingsService.layerTest({ projectSettingsFolded: true, ...settings }),
          Layer.mock(ProjectService.ProjectService)({
            getById: () => Effect.succeed(Option.some(project)),
          }),
          Layer.mock(T3ProjectFileLoader.T3ProjectFileLoader)({
            load: () => Effect.succeed(Option.none()),
          }),
          Layer.mock(GitWorkflow.GitWorkflowService)({
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasPrimaryRemote: true,
                isDefaultRef: false,
                refName: "feature/current",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
          }),
          Layer.mock(ThreadLaunch.ThreadLaunchService)({
            launch: (input) =>
              Ref.update(launches, (all) => [...all, input]).pipe(
                Effect.as({ threadId: input.threadId! } as ThreadLaunch.ThreadLaunchResult),
              ),
          }),
        ),
      ),
    );
    const result = yield* GlobalActionService.GlobalActionService.pipe(
      Effect.flatMap((service) => service.run({ actionId: review.id, projectId, ...input })),
      Effect.provide(layer),
      Effect.result,
    );
    const [launch] = yield* Ref.get(launches);
    return result._tag === "Failure"
      ? { error: result.failure.message, launch }
      : { threadId: result.success.threadId, launch };
  });

it.effect("launches with the project's defaults, branching from the current branch", () =>
  Effect.gen(function* () {
    const { launch, threadId } = yield* runAction({
      globalActions: [review],
      defaultModelSelection: codex,
      defaultThreadEnvMode: "worktree",
      newWorktreesStartFromOrigin: true,
      projectSettingsOverrides: { [projectId]: { defaultModelSelection: claude } },
    });
    assert.equal(launch?.threadId, threadId);
    assert.equal(launch?.title, "Review branch");
    assert.equal(launch?.initialMessage?.text, "Review the current branch for bugs");
    assert.deepStrictEqual(launch?.modelSelection, claude);
    assert.deepStrictEqual(launch?.workspaceStrategy, {
      type: "worktree",
      baseRef: "feature/current",
      startFromOrigin: true,
    });
  }),
);

it.effect("lets the action's model and workspace override the project's defaults", () =>
  Effect.gen(function* () {
    const { launch } = yield* runAction({
      globalActions: [{ ...review, modelSelection: claude, workspace: "local" }],
      defaultModelSelection: codex,
      defaultThreadEnvMode: "worktree",
    });
    assert.deepStrictEqual(launch?.modelSelection, claude);
    assert.deepStrictEqual(launch?.workspaceStrategy, { type: "root" });
  }),
);

it.effect("prefers the invoking thread's model to the project default", () =>
  Effect.gen(function* () {
    const { launch } = yield* runAction(
      { globalActions: [review], defaultModelSelection: codex },
      { modelSelection: claude },
    );
    assert.deepStrictEqual(launch?.modelSelection, claude);
    const overridden = yield* runAction(
      { globalActions: [{ ...review, modelSelection: codex }] },
      { modelSelection: claude },
    );
    assert.deepStrictEqual(overridden.launch?.modelSelection, codex);
  }),
);

it.effect("refuses to launch when no model is chosen anywhere", () =>
  Effect.gen(function* () {
    const { launch, error } = yield* runAction({
      globalActions: [review],
      defaultModelSelection: null,
    });
    assert.isUndefined(launch);
    assert.include(error, "has no model");
  }),
);

it.effect("reports an action deleted since the client listed it", () =>
  Effect.gen(function* () {
    const { launch, error } = yield* runAction(
      { globalActions: [review] },
      { actionId: "removed" },
    );
    assert.isUndefined(launch);
    assert.equal(error, "This global action no longer exists.");
  }),
);

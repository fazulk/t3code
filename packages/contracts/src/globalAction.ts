import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ThreadEnvMode } from "./environment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2CreationSource } from "./orchestrationV2.ts";
import { ProjectScriptIcon } from "./project.ts";

/** Where a global action's prompt goes. */
export const GlobalActionTarget = Schema.Literals(["new-thread", "current-thread"]);
export type GlobalActionTarget = typeof GlobalActionTarget.Type;

/**
 * A saved prompt, listed under every project's actions, that runs in the
 * thread it was invoked from or in a new thread in that project.
 */
export const GlobalAction = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  /** Absent starts a new thread. */
  target: Schema.optionalKey(GlobalActionTarget),
  /** New threads only. Absent uses the invoking thread's model, then the project's default. */
  modelSelection: Schema.optionalKey(ModelSelection),
  /** New threads only. Absent uses the project's default workspace for new threads. */
  workspace: Schema.optionalKey(ThreadEnvMode),
  /**
   * False leaves the prompt in the composer for the user to send. Absent
   * sends it right away.
   */
  autoSubmit: Schema.optionalKey(Schema.Boolean),
});
export type GlobalAction = typeof GlobalAction.Type;

export const GlobalActionRunInput = Schema.Struct({
  actionId: TrimmedNonEmptyString,
  projectId: ProjectId,
  /** The invoking thread's model, used when the action has none of its own. */
  modelSelection: Schema.optional(ModelSelection),
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type GlobalActionRunInput = typeof GlobalActionRunInput.Type;

export const GlobalActionRunResult = Schema.Struct({
  threadId: ThreadId,
});
export type GlobalActionRunResult = typeof GlobalActionRunResult.Type;

export class GlobalActionError extends Schema.TaggedError<GlobalActionError>()(
  "GlobalActionError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

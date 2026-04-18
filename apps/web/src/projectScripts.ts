import {
  GLOBAL_ACTION_RUN_COMMAND_PATTERN,
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  type KeybindingCommand,
  type ProjectScript,
} from "@t3tools/contracts";
import { Schema } from "effect";

export type ActionScope = "project" | "global";

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

export const commandForProjectScript = (scriptId: string): KeybindingCommand =>
  SCRIPT_RUN_COMMAND_PATTERN.make(`script.${scriptId}.run`);

export const commandForGlobalAction = (actionId: string): KeybindingCommand =>
  GLOBAL_ACTION_RUN_COMMAND_PATTERN.make(`global-action.${actionId}.run`);

export const actionPreferenceKey = (scope: ActionScope, actionId: string): string =>
  `${scope}:${actionId}`;

export function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!Schema.is(SCRIPT_RUN_COMMAND_PATTERN)(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function globalActionIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!Schema.is(GLOBAL_ACTION_RUN_COMMAND_PATTERN)(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = GLOBAL_ACTION_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  // This last-resort fallback only triggers after exhausting thousands of suffixes.
  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

export function nextResolvedActionId(input: {
  name: string;
  scope: ActionScope;
  projectScripts: readonly ProjectScript[];
  globalActions: readonly ProjectScript[];
  previousAction?: { scope: ActionScope; action: Pick<ProjectScript, "id"> } | null;
}): string {
  if (input.previousAction?.scope === input.scope) {
    return input.previousAction.action.id;
  }

  const targetActions = input.scope === "global" ? input.globalActions : input.projectScripts;
  const targetIds = new Set(targetActions.map((action) => action.id));

  if (input.previousAction && !targetIds.has(input.previousAction.action.id)) {
    return input.previousAction.action.id;
  }

  return nextProjectScriptId(input.name, targetIds);
}

export function primaryProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  const regular = scripts.find((script) => !script.runOnWorktreeCreate);
  return regular ?? scripts[0] ?? null;
}

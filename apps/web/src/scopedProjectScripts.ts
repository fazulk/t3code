import type { ProjectScript } from "@t3tools/contracts";

export type ScriptScope = "project" | "global";
export type ScopedProjectScript = ProjectScript & { scope: ScriptScope };

interface ProjectScriptCollection {
  environmentId: string;
  id: string;
  scripts: ReadonlyArray<ProjectScript>;
}

export function mergeScopedProjectScripts(input: {
  projectScripts: ReadonlyArray<ProjectScript>;
  globalProjectScripts: ReadonlyArray<ProjectScript>;
}): ScopedProjectScript[] {
  return [
    ...input.projectScripts.map((script) => ({ ...script, scope: "project" as const })),
    ...input.globalProjectScripts.map((script) => ({ ...script, scope: "global" as const })),
  ];
}

export function validateScopedProjectScriptId(input: {
  candidateId: string;
  scope: ScriptScope;
  currentProjectRef?: { environmentId: string; id: string } | null;
  currentScript?: ScopedProjectScript | null;
  globalProjectScripts: ReadonlyArray<ProjectScript>;
  loadedProjects: ReadonlyArray<ProjectScriptCollection>;
}): string | null {
  if (input.scope === "global") {
    const collidesWithProjectAction = input.loadedProjects.some((project) =>
      project.scripts.some((script) => {
        if (script.id !== input.candidateId) {
          return false;
        }
        return !(
          input.currentScript?.scope === "project" &&
          input.currentScript.id === input.candidateId &&
          input.currentProjectRef &&
          project.environmentId === input.currentProjectRef.environmentId &&
          project.id === input.currentProjectRef.id
        );
      }),
    );
    return collidesWithProjectAction
      ? "This action id is already used by a project action. Rename it before saving globally."
      : null;
  }

  const collidesWithGlobalAction = input.globalProjectScripts.some((script) => {
    if (script.id !== input.candidateId) {
      return false;
    }
    return !(
      input.currentScript?.scope === "global" && input.currentScript.id === input.candidateId
    );
  });
  return collidesWithGlobalAction
    ? "This action id is already used by a global action. Rename it before saving to this project."
    : null;
}

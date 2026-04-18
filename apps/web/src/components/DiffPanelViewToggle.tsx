import { useNavigate, useSearch } from "@tanstack/react-router";
import { GitBranchIcon, ListIcon } from "lucide-react";

import { ToggleGroup, Toggle } from "./ui/toggle-group";

export type DiffView = "turns" | "git";

export const DIFF_VIEW_SEARCH_KEY = "diffView";

export function useDiffView(): DiffView {
  return useSearch({
    strict: false,
    select: (s: Record<string, unknown>) =>
      s[DIFF_VIEW_SEARCH_KEY] === "git" ? "git" : "turns",
  });
}

export function DiffPanelViewToggle() {
  const diffView = useDiffView();
  const navigate = useNavigate();

  return (
    <ToggleGroup
      className="shrink-0 [-webkit-app-region:no-drag]"
      variant="outline"
      size="xs"
      value={[diffView]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "git" || next === "turns") {
          // Type assertion: tanstack-router can't infer search types without an explicit `to`.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          void (navigate as any)({
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              [DIFF_VIEW_SEARCH_KEY]: next === "git" ? "git" : undefined,
            }),
          });
        }
      }}
    >
      <Toggle aria-label="Git diff view" value="git">
        <GitBranchIcon className="size-3" />
      </Toggle>
      <Toggle aria-label="Turn diff view" value="turns">
        <ListIcon className="size-3" />
      </Toggle>
    </ToggleGroup>
  );
}

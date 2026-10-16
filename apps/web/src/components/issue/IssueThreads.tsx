import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  threadIssueKeyOf,
  threadIssueKeysEqual,
} from "@t3tools/contracts";
import type { EnvironmentId, IssueDetail, ProjectId, ThreadIssueKey } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
} from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { setPendingIssueLink } from "~/lib/pendingIssueLinks";
import { useRightPanelStore } from "~/rightPanelStore";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { issueTrackerPresentation } from "./issuePresentation";

function threadIssueKeyFromDetail(detail: IssueDetail): ThreadIssueKey {
  return { tracker: detail.tracker, host: detail.host, scope: detail.scope, key: detail.key };
}

/** What a thread started from an issue is asked; left in the composer for the reader to edit. */
export function issueThreadPrompt(
  detail: Pick<IssueDetail, "tracker" | "displayKey" | "title" | "url">,
): string {
  const tracker = issueTrackerPresentation(detail.tracker).providerName;
  return `Work on ${tracker} issue ${detail.displayKey}: ${detail.title}\n\n${detail.url}`;
}

/**
 * Starts a thread with the issue in its composer and beside it, and links the two once the first
 * message creates the thread. A worktree draft gets its own branch and folder on send, the same as
 * any thread started in New worktree mode.
 *
 * The thread can run in any project on the issue's environment: a tracker such as Jira is not tied
 * to one repository. The link keeps the project the issue is read through, so it stays readable
 * from a thread in another project.
 */
export function IssueStartThreadMenu({
  environmentId,
  detail,
}: {
  environmentId: EnvironmentId;
  detail: IssueDetail;
}) {
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const newThread = useNewThreadHandler();
  const projects = useProjects();
  const [starting, setStarting] = useState(false);
  // Scoped to the issue it was made on: the panel stays mounted as the reader moves between issues.
  const [choice, setChoice] = useState<{ issue: string; projectId: ProjectId } | null>(null);
  if (!canOperate) return null;

  const issueId = threadIssueKeyOf(threadIssueKeyFromDetail(detail));
  const candidates = projects
    .filter((project) => project.environmentId === environmentId)
    .toSorted(
      (a, b) =>
        Number(b.id === detail.projectId) - Number(a.id === detail.projectId) ||
        a.title.localeCompare(b.title),
    );
  const projectId =
    choice?.issue === issueId && candidates.some((project) => project.id === choice.projectId)
      ? choice.projectId
      : detail.projectId;

  const start = async (envMode: "local" | "worktree") => {
    if (starting) return;
    setStarting(true);
    const opened = await newThread(scopeProjectRef(environmentId, projectId), {
      envMode,
      branch: null,
      worktreePath: null,
    }).catch(() => null);
    setStarting(false);
    if (opened === null) {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Try again from the project, or open a thread first.",
      });
      return;
    }
    const threadRef = scopeThreadRef(environmentId, opened.threadId);
    const issueKey = threadIssueKeyFromDetail(detail);
    setPendingIssueLink(threadRef, {
      ...issueKey,
      projectId: detail.projectId,
      url: detail.url,
      source: "manual",
    });
    useComposerDraftStore.getState().setPrompt(opened.draftId, issueThreadPrompt(detail));
    useRightPanelStore.getState().openIssue(threadRef, {
      environmentId,
      projectId: detail.projectId,
      ...issueKey,
      url: detail.url,
    });
  };

  return (
    <Menu>
      <MenuTrigger
        disabled={starting}
        render={<Button size="xs" variant="outline" aria-label="Start a thread on this issue" />}
      >
        <MessageSquarePlusIcon aria-hidden className="size-3.5" />
        {starting ? "Starting..." : "Start thread"}
        <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <MenuItem onClick={() => void start("worktree")}>
          <GitBranchIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>In a new worktree</span>
            <span className="text-xs text-muted-foreground">
              Its own branch and folder, made when you send. Nothing you have open moves.
            </span>
          </span>
        </MenuItem>
        <MenuItem onClick={() => void start("local")}>
          <FolderGit2Icon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>In this repository</span>
            <span className="text-xs text-muted-foreground">
              Works on the branch the project is already on.
            </span>
          </span>
        </MenuItem>
        {candidates.length > 1 ? (
          <>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>
                <FolderIcon aria-hidden />
                <span className="min-w-0 truncate">
                  {candidates.find((project) => project.id === projectId)?.title ?? "Project"}
                </span>
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuRadioGroup
                  value={projectId}
                  onValueChange={(next) =>
                    setChoice({ issue: issueId, projectId: next as ProjectId })
                  }
                >
                  {candidates.map((project) => (
                    <MenuRadioItem key={project.id} value={project.id}>
                      <span className="truncate">{project.title}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The threads on this environment that link the issue. Read from the thread shells the client
 * already holds, so it costs no request and stays current as links change.
 */
export function IssueLinkedThreads({
  environmentId,
  detail,
}: {
  environmentId: EnvironmentId;
  detail: IssueDetail;
}) {
  const shells = useThreadShells();
  const projects = useProjects();
  const navigate = useNavigate();
  const issueKey = threadIssueKeyFromDetail(detail);
  const linked = shells
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        (thread.issues ?? []).some((link) => threadIssueKeysEqual(link, issueKey)),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (linked.length === 0) return null;
  const projectTitle = (projectId: string) =>
    projects.find((project) => project.environmentId === environmentId && project.id === projectId)
      ?.title;
  return (
    <section className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-1.5">
      <h3 className="px-1.5 pt-0.5 pb-1 text-xs font-medium text-foreground/80">
        {linked.length === 1 ? "1 linked thread" : `${linked.length} linked threads`}
      </h3>
      {linked.map((thread) => (
        <button
          key={thread.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(environmentId, thread.id)),
            })
          }
        >
          <MessageSquareIcon aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {thread.title || "Untitled thread"}
          </span>
          <span className="shrink-0 truncate text-xs text-muted-foreground">
            {projectTitle(thread.projectId)} · {formatRelativeTimeLabel(thread.updatedAt)}
          </span>
        </button>
      ))}
    </section>
  );
}

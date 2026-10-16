import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  threadIssueKeyOf,
  threadIssueKeysEqual,
  type IssueListEntry,
  type ScopedThreadRef,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import { Link2Icon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useServerConfigs, useThreadShell } from "../../state/entities";
import { issueEnvironment } from "../../state/issues";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestCandidatePicker } from "../pullRequest/PullRequestCandidatePicker";
import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { issueDisplayLabel } from "../issue/issueDetail.logic";
import { IssueGlyph, resolveIssueStatePresentation } from "../issue/issuePresentation";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

/**
 * The thread details panel's issue rows, one per linked issue, beside the pull request rows. A
 * row opens the issue in the right panel; the snapshot the server keeps on the link supplies the
 * key, title and state, so no tracker read happens on render. Until the first snapshot lands the
 * row shows what the link itself carries.
 */
export function ThreadDetailsIssueRows({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  // A draft cannot be linked until its first send creates the thread.
  if (thread === null) return null;
  const links = thread.issues ?? [];
  return (
    <>
      {links.map((link) => {
        const state =
          link.snapshot === null ? null : resolveIssueStatePresentation(link.snapshot.state);
        const label =
          link.snapshot === null
            ? issueDisplayLabel(link.scope, link.key)
            : `${link.snapshot.displayKey}: ${link.snapshot.title}`;
        return (
          <Tooltip key={threadIssueKeyOf(link)}>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  part="row"
                  aria-label={link.url}
                  onClick={(event) => {
                    event.stopPropagation();
                    useRightPanelStore.getState().openIssue(threadRef, {
                      projectId: link.projectId,
                      tracker: link.tracker,
                      host: link.host,
                      scope: link.scope,
                      key: link.key,
                      url: link.url,
                    });
                  }}
                />
              }
            >
              {state === null ? (
                <IssueGlyph.issue aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              ) : (
                <state.Icon aria-hidden className={cn("size-4 shrink-0", state.toneClassName)} />
              )}
              <span className={cn("min-w-0 flex-1 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                {label}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              {state === null ? "Issue not read yet" : state.label}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      <ThreadDetailsIssueLinkPicker threadRef={threadRef} links={links} />
    </>
  );
}

/**
 * Searches the environment's trackers for an issue to link, so nobody has to paste its URL. Not
 * narrowed to the thread's project: a tracker such as Jira is not tied to one repository.
 */
function ThreadDetailsIssueLinkPicker({
  threadRef,
  links,
}: {
  threadRef: ScopedThreadRef;
  links: ReadonlyArray<ThreadIssueLink>;
}) {
  const { environmentId } = threadRef;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const capable = useServerConfigs().get(environmentId)?.environment.capabilities.issues === true;
  const link = useAtomCommand(threadEnvironment.linkIssue, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const sentQuery = useDebouncedValue(query.trim(), 300);
  const listQuery = useEnvironmentQuery(
    open && canOperate && capable
      ? issueEnvironment.list({
          environmentId,
          input: { state: "open", limit: 20, ...(sentQuery ? { query: sentQuery } : {}) },
        })
      : null,
  );
  if (!canOperate || !capable) return null;

  const candidates = (listQuery.data?.entries ?? []).filter(
    (entry) => !links.some((existing) => threadIssueKeysEqual(existing, entry)),
  );
  const select = async (entry: IssueListEntry) => {
    if (pending) return;
    setPending(true);
    const result = await link({
      environmentId,
      input: {
        threadId: threadRef.threadId,
        tracker: entry.tracker,
        host: entry.host,
        scope: entry.scope,
        key: entry.key,
        projectId: entry.projectId,
        url: entry.url,
        source: "manual",
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not link the issue",
        description: readableFailure(squashAtomCommandFailure(result), "The server refused it."),
      });
      return;
    }
    setOpen(false);
    setQuery("");
  };

  return (
    <PullRequestCandidatePicker
      icon={<Link2Icon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
      label="Link issue"
      allowed
      disabledReason=""
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search issues"
      isPending={listQuery.isPending && listQuery.data === null}
      error={listQuery.data === null ? listQuery.error : null}
      candidates={candidates}
      emptyLabel="No open issues to link."
      noMatchLabel="No open issue matches that."
      errorLabel="The issues could not be read."
      truncated={false}
      truncatedLabel=""
      candidateKey={(entry) => threadIssueKeyOf(entry)}
      disabled={pending}
      onSelect={(entry) => void select(entry)}
      trigger={
        <ThreadDetailsControl part="row" tone="muted" aria-label="Link issue">
          <Link2Icon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span className={cn("min-w-0 flex-1 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
            Link issue
          </span>
        </ThreadDetailsControl>
      }
    >
      {(entry) => (
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">{entry.displayKey}</span> {entry.title}
        </span>
      )}
    </PullRequestCandidatePicker>
  );
}

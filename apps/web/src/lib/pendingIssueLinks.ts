import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadIssueKey, ThreadIssueLink } from "@t3tools/contracts";

export type PendingIssueLink = ThreadIssueKey &
  Pick<ThreadIssueLink, "projectId" | "url" | "source">;

// A thread started from an issue is a draft until its first send, and a draft cannot be linked.
// The issue waits here for that send. Kept in memory only: the hand-off prompt names the issue
// too, and agents link the issues they are asked to work on.
const pending = new Map<string, PendingIssueLink>();

/** One issue per draft: a second hand-off into the same draft replaces the first. */
export function setPendingIssueLink(threadRef: ScopedThreadRef, link: PendingIssueLink): void {
  pending.set(scopedThreadKey(threadRef), link);
}

/** Removes and returns the issue waiting on this thread, once it exists on the server. */
export function takePendingIssueLink(threadRef: ScopedThreadRef): PendingIssueLink | null {
  const key = scopedThreadKey(threadRef);
  const link = pending.get(key) ?? null;
  pending.delete(key);
  return link;
}

#!/bin/bash
# Run from a terminal: ./update-app.sh [codex|claude] [--dry-run]
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./update-app.sh [codex|claude] [--dry-run]

Launch an interactive agent to sync upstream/main, rebase and push the current branch,
build the macOS desktop app, and replace /Applications/T3 Code (Nightly).app.
Quit and relaunch T3 Code after installation.
Defaults to Codex. --dry-run prints the instructions without launching an agent.
Requires a clean checkout; commit or stash your work first.
USAGE
}

fail() {
  printf 'update-app: %s\n' "$1" >&2
  exit 1
}

agent=codex
dry_run=false
for argument in "$@"; do
  case "$argument" in
    codex|claude) agent="$argument" ;;
    --dry-run) dry_run=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "Unknown argument: $argument" ;;
  esac
done

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$repo_dir"
branch="$(git symbolic-ref --quiet --short HEAD)" || fail 'Check out a branch first.'
[[ "$branch" != main ]] || fail 'Run this from the feature branch you want to rebase.'

prompt="$(cat <<'PROMPT'
Update this T3 Code checkout and install its macOS desktop build. Follow AGENTS.md.
The invoking terminal's directory is the checkout; keep working in it.

1. Preflight: require macOS, a clean working tree (including untracked files),
   a feature branch, and no unfinished rebase, merge, or cherry-pick. Stop and
   explain any blocker. Do not commit, stash, reset, or discard existing work.
   Record the starting branch and commit. Use backup/update-app/<starting-branch>
   as the single rotating backup branch, locally and on origin; reuse it on
   every update rather than creating dated branches. Do not create a pull request.
   Confirm origin points to https://github.com/fazulk/t3code.git (the SSH
   equivalent is fine), then fetch the starting branch from origin. Record its
   exact remote commit before rebasing, and require it to be an ancestor of the
   starting local commit; otherwise stop rather than overwrite remote work.
   Record the exact remote backup commit too (or its absence). Before
   changing history, create or replace the local backup at the starting local
   commit. Stop if the backup is checked out in another worktree.

2. The true upstream is https://github.com/pingdotgg/t3code.git. Confirm the
   upstream remote points there (the SSH equivalent is fine); stop if it does
   not. Fetch upstream main explicitly. Fast-forward local main to the fetched
   upstream/main, then rebase the starting branch onto main. Never reset a
   diverged main. Respect other worktrees: if main is checked out elsewhere,
   require that checkout to be clean and fast-forward it there; otherwise use
   a guarded ref update without switching this checkout away from its branch.
   Resolve rebase conflicts automatically: I explicitly authorize this for this
   workflow. Understand both sides, retain upstream improvements, and preserve
   this branch's features. Do not silently drop commits or use ours/theirs for
   whole files. Review the resulting changes and run focused tests for conflict
   resolutions. If you cannot preserve the intended behavior, stop and explain
   the unresolved decision. On failure, leave a clear recovery command and the
   backup ref.

3. After a successful rebase, install dependencies with `vp i -- --yes`.
   Read the current scripts/build-desktop-artifact.ts and package scripts in
   case upstream changed the build process. Build a fresh unsigned host-arch
   macOS ZIP using the existing artifact builder, which also rebuilds the
   server, web client, and Electron app. Use a fresh temporary output directory
   so no stale artifact can be selected. With the current builder the command
   is `node scripts/build-desktop-artifact.ts --platform mac --target zip
   --arch <arm64-or-x64> --build-version <version> --output-dir <temp-dir>
   --verbose`. Ensure inherited T3CODE_DESKTOP_SKIP_BUILD, T3CODE_DESKTOP_SIGNED,
   or T3CODE_DESKTOP_MOCK_UPDATES settings cannot skip the rebuild, request
   signing, or enable mock updates.
   Do not run repository-wide tests, lint, or typechecks. If a build fails,
   stop and report it; do not install an older artifact or make unrelated fixes.

4. After the build succeeds, publish the rebased starting branch to origin.
   In one atomic push, replace the rotating remote backup with the recorded
   remote starting commit and push HEAD to refs/heads/<starting-branch>.
   Use --force-with-lease=refs/heads/<starting-branch>:<recorded-remote-commit>
   and an explicit lease for the backup ref using its recorded commit (an empty
   expected value if it did not exist). If atomic push is unsupported, stop.
   Never use plain --force or refresh the expected commit to bypass rejection.
   If the lease fails, stop and explain that the remote changed. Verify the
   remote branch matches HEAD. Do not push main or upstream. Report the remote
   backup branch and published commit.

5. Install destination: /Applications/T3 Code (Nightly).app. Preserve the Nightly
   product name and com.t3tools.t3code bundle identifier. For the current builder,
   use the server package's base version plus `-nightly.YYYYMMDD.<unix-seconds>`
   as the build version. Verify the generated bundle's identity before copying.
   Extract the fresh ZIP with ditto into a temporary directory. Use ditto to
   stage the complete app under a unique sibling path in /Applications, keeping
   executable permissions, symlinks, and bundle metadata. Verify the staged
   bundle before replacing the destination. Move the old app to a uniquely
   named backup outside the checkout, then move the staged app into place;
   restore the old app if the final move fails. Keep that backup and report
   its path. Do not merge files into the existing bundle. If /Applications is
   not writable, stop and give me the exact installation command to run.

6. After installation, automatically quit and relaunch the app. This session
   may itself run inside T3 Code, so do not quit it directly from the agent.
   First report the upstream commit, rebased branch and commit, build version,
   installed app path, backup paths, and a restart log path. Then schedule a
   short-delayed, fully detached helper outside the checkout (for example,
   Node child_process.spawn with detached:true, stdin ignored, stdout/stderr
   redirected to that log, followed by unref). The helper must survive T3 Code
   shutting down. It should use AppleScript to gracefully quit the exact app
   at /Applications/T3 Code (Nightly).app, wait for quitting to complete, then
   use `open` on that exact app path. Do not kill processes by name or pattern,
   and do not force-quit. If graceful quitting fails or times out, log the
   failure instead of killing it. Report that restart is scheduled; do not
   claim you observed the new app launch from this session.

Never touch ~/.t3/userdata, my settings, credentials, or live database. Do not
start a server or browser. Distinguish successful packaging and installation
from actually launching and testing the app.
PROMPT
)"

if "$dry_run"; then
  printf 'Agent: %s\nCheckout: %s\nBranch: %s\n\n%s\n' "$agent" "$repo_dir" "$branch" "$prompt"
  exit 0
fi

[[ "$(uname -s)" == Darwin ]] || fail 'This installer supports macOS only.'
command -v "$agent" >/dev/null 2>&1 || fail "$agent is not on PATH."
if ! command -v vp >/dev/null 2>&1; then
  [[ -x "$repo_dir/node_modules/.bin/vp" ]] || fail 'vp is not on PATH and node_modules/.bin/vp is missing. Install Vite+ or the checkout dependencies first.'
  export PATH="$repo_dir/node_modules/.bin:$PATH"
fi
for operation in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
  [[ ! -e "$(git rev-parse --git-path "$operation")" ]] || fail "Finish the active Git operation ($operation) first."
done
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || fail 'Commit or stash your changes (including this script) before running.'
[[ -t 0 && -t 1 ]] || fail 'Run this in an interactive terminal for the agent session.'

printf 'Starting %s in %s on %s.\n' "$agent" "$repo_dir" "$branch"
case "$agent" in
  codex) exec codex --cd "$repo_dir" "$prompt" ;;
  claude) exec claude "$prompt" ;;
esac

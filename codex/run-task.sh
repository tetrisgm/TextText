#!/usr/bin/env bash
# Run one Codex task in an isolated git worktree.
#
#   codex/run-task.sh T1-mac-nested-sync [base-branch]
#
# Creates ../write-codex/<task>/ as a worktree on branch codex/<task>,
# CoW-clones node_modules (APFS, near-instant) so npm builds work offline
# inside the Codex sandbox, then runs Codex headless against the brief.
# Output lands in ../write-codex/<task>.log and <task>.last.txt.
#
# The loop: run tasks (in parallel if their briefs' file ownership is
# disjoint), then the maintainer reviews each worktree's diff, merges,
# and runs the full verify ladder. Codex exit codes are unreliable
# (nonzero after finished work is common); judge by the diff, not the code.
set -euo pipefail

TASK="${1:?usage: codex/run-task.sh <task-name> [base-branch]}"
BASE="${2:-main}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BRIEF="$REPO/codex/tasks/$TASK.md"
[ -f "$BRIEF" ] || { echo "no brief at codex/tasks/$TASK.md" >&2; exit 64; }

WT_ROOT="$(dirname "$REPO")/write-codex"
WT="$WT_ROOT/$TASK"
mkdir -p "$WT_ROOT"

if [ ! -d "$WT" ]; then
  git -C "$REPO" worktree add -b "codex/$TASK" "$WT" "$BASE"
  # CoW node_modules so tsc/next build work offline in the sandbox.
  if [ -d "$REPO/node_modules" ] && [ ! -d "$WT/node_modules" ]; then
    cp -Rc "$REPO/node_modules" "$WT/node_modules"
  fi
fi

echo ">> codex on $TASK (worktree $WT)"
codex exec -C "$WT" -s workspace-write -c 'mcp_servers={}' \
  -o "$WT_ROOT/$TASK.last.txt" \
  < "$BRIEF" > "$WT_ROOT/$TASK.log" 2>&1 || \
  echo ">> codex exited nonzero for $TASK (often fine; judge the diff)"
echo ">> done: diff with  git -C $WT diff $BASE --stat"

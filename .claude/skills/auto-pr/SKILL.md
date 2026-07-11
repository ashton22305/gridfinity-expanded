---
name: auto-pr
description: Create a pull request from pending working-tree changes. First an Opus subagent syncs CLAUDE.md and AGENTS.md with the changes, then a Haiku subagent branches, commits, pushes, and opens the PR. Use when the user asks to PR/push their pending changes.
---

# Auto PR

Turn the current pending changes into a pull request in three phases. Do not
edit code yourself in this flow, and do not skip or reorder the phases.

## 1. Inventory the pending changes

- Run `git status --porcelain` and `git diff HEAD --stat` (covers staged and
  unstaged). If the working tree is clean, tell the user there is nothing to
  PR and stop.
- Write a short change summary — what changed and why, drawn from the diff and
  the conversation — plus a suggested kebab-case branch name and a short
  imperative PR title. Both subagents start with no context, so this summary
  is the only knowledge of the work they get.
- Note any validation already run this session (build, lint, check:manifold)
  so the PR body can list it truthfully.

## 2. Sync the docs — Opus (required)

Spawn the `docs-sync` agent (Agent tool, `subagent_type: "docs-sync"`). Its
definition pins Opus — do not override the model. The prompt must include:

- the change summary and the list of changed files,
- the instruction to update CLAUDE.md and AGENTS.md only where the pending
  changes make them stale, matching each file's existing structure, headings,
  and tone.

When it returns, verify with `git status --porcelain` that it touched only
documentation files; revert anything else it changed before continuing.

## 3. Branch, commit, push, PR — Haiku

Spawn the `pr-push` agent (Agent tool, `subagent_type: "pr-push"`). Its
definition pins Haiku — do not override the model. The prompt must include
the change summary, the suggested branch name, the PR title, and the
validation notes from phase 1.

## 4. Report

Relay the PR URL and a one-line description of what was pushed. If either
agent failed, report exactly what happened and leave the working tree as it
is — do not retry the push yourself.

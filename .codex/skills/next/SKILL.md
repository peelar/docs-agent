---
name: next
description: >-
  Repo-specific $next workflow for Paige. Use when the user
  writes "$next", says "next", or asks Codex to pick up the next GitHub issue
  in this repository. Inspect the ordered issue backlog, planning docs, repo
  instructions, Eve docs for changed runtime surfaces, and current main branch
  state before choosing one issue. Normally propose the smallest coherent slice
  and wait for approval. When the $loop skill delegates one linked issue,
  implement and ship that issue under the named loop's advance approval. Verify
  each issue, and when agent behavior changes, add an executable eval or present
  an end-user scenario the user can run manually.
---

# Next

## Purpose

Use this workflow to pick and ship the next coherent Paige
backlog item. This repo does not use the global `$next` draft-PR publishing
loop. Work is intended to land directly on `main` after validation and explicit
commit approval.

GitHub Issues are the backlog source of truth. `docs/internal/ROADMAP.md` is the
fallback ordering source when GitHub Projects or custom priority fields are not
available.

The `$loop` skill is the single source of truth for defining and running named
multi-issue loops. This skill owns exactly one selected or delegated issue.

## Workflow

1. Identify the repository.
   - Prefer `gh repo view --json nameWithOwner,url`.
   - Otherwise use `git remote get-url origin` and convert it to `owner/repo`.
   - If the current directory is not this repository, stop and ask for the
     target checkout.
2. Inspect local state before planning.
   - Run `git status --short`, `git branch --show-current`, and inspect the
     upstream/main state.
   - Outside a named loop, this repo ships directly from `main`. If not on
     `main`, switch only when user or unrelated changes will not be disturbed.
   - When `$loop` delegated the issue, treat the existing worktree as a baseline,
     preserve unrelated changes, and follow its non-blocking and path-scoped
     commit contract.
   - Pull or otherwise verify current `origin/main` before editing when network
     and credentials allow it.
3. Read planning and operating context.
   - Always read `AGENTS.md`.
   - Read `docs/internal/MANIFEST.md`, `docs/internal/ROADMAP.md`, and any
     relevant docs they reference.
   - Read relevant ADRs in `docs/internal/adr/` or
     `docs/internal/decisions/` when present.
   - Read `docs/internal/REPOSITORY_MODEL.md` when repository setup, sandbox
     behavior, writeback, watched repositories, or provenance are involved.
   - Read `docs/internal/USER_TESTING.md` and existing files under `evals/`
     when the task changes agent behavior or test coverage.
   - Before writing Eve runtime code, tools, channels, skills, sandbox config,
     evals, or instructions, read the relevant installed Eve docs under
     `node_modules/eve/docs/`.
   - Keep `agent/instructions.md` short and stable. Put scenario choreography,
     tool-order expectations, and regression assertions in `evals/`, test
     fixtures, or manual scenarios instead.
4. Inspect the ordered GitHub issue backlog.
   - Use GitHub tools when available; otherwise use `gh`.
   - For a loop-delegated issue, inspect that issue, its linked loop queue, and
     its dependencies. Treat the orchestrator's assignment as fixed; do not
     substitute or close a different issue.
   - Prefer the agreed ordered backlog view, project view, priority field, or
     milestone order when one exists.
   - If no richer GitHub ordering is available, use the ordered issue table in
     `docs/internal/ROADMAP.md`.
   - Fetch enough details for the top issues: title, body, labels, milestone,
     comments, links, and current state.
   - Do not treat GitHub's default issue list as product order unless the repo
     explicitly adopted that ordering.
5. Reconcile earlier ordered issues before selecting new work.
   - Outside a named loop, walk open issues from the top of the active backlog.
     If an earlier issue is already satisfied on `main`, verify its acceptance
     criteria against source, docs, tests, evals, and recent commits. Comment
     with that evidence and close it only when completion is proven on `main`.
     Treat local-only or ambiguous completion as a backlog problem.
   - For a loop-delegated issue, skip backlog reconciliation. Verify dependency
     state and return evidence to the orchestrator when the assignment is not
     dependency-ready.
6. Assess whether the next open issue is still coherent.
   - Check that dependencies appear before dependent work.
   - Check for duplicate, stale, conditional, vague, or placeholder issues.
   - Check that the issue still matches `docs/internal/MANIFEST.md`,
     `docs/internal/ROADMAP.md`, repo docs, current code, and latest user
     feedback.
   - Outside a named loop, treat material disagreements as backlog problems and
     suggest `$refine` rather than selecting premature implementation work.
   - For a loop-delegated issue, resolve underspecified details under `$loop`'s
     assumption and handover contract.
7. Select exactly one issue when the backlog is coherent.
   - Outside a named loop, select the next coherent issue.
   - For a loop-delegated issue, accept the assigned issue after verifying its
     dependencies.
   - Prefer the smallest vertical slice that proves behavior.
   - Do not widen scope because adjacent cleanup looks convenient.
   - Ignore later-phase issues until the active milestone is complete unless
     the user explicitly redirects.
8. Propose the design before editing.
   - Explain the selected issue, why it matters, what changes, repo-specific
     gates, proposed implementation shape, tradeoffs, acceptance criteria, and
     any unresolved scope question.
   - Ask at most one scope question at a time. Include a recommended answer.
   - Try to answer questions from the repo, issues, docs, and code before
     asking the user.
   - Outside a named loop, wait for explicit user approval before implementation.
   - For a loop-delegated issue, state the intended slice briefly and continue
     under the named loop's advance approval.
9. Implement only the accepted slice.
   - Preserve unrelated user or local changes.
   - Follow existing repo patterns and Eve conventions.
   - Add tests or eval coverage proportional to risk.
   - Update docs only when the task changes the product contract, public
     workflow, development loop, or user-test surface.
10. When the slice changes agent behavior, prove it for an end user.
    - Prefer an executable Eve eval when the behavior can be asserted through
      stable tool calls, outputs, or final response checks.
    - If an executable eval would be too brittle, too slow, blocked by missing
      product support, or outside the accepted slice, add or update a manual
      scenario under `evals/scenarios/manual/` or present a copy-paste scenario
      in the final response.
    - The scenario must be written as an end-user prompt, not as an internal
      implementation checklist.
    - State what the user should expect to see and which command or manual
      flow runs it.
11. Verify before handoff.
    - Run the narrowest meaningful checks during development.
    - Always run `pnpm check` before finalizing, per `AGENTS.md`.
    - If an eval was added or changed, run the targeted eval when practical.
      If not practical, say exactly why and provide the manual scenario.
12. Ship directly on `main`.
    - Do not open a PR.
    - Do not create or update a draft PR.
    - Outside a named loop, after checks pass, propose a conventional commit
      message and end with `Commit? [Y/n]`, as required by `AGENTS.md`.
    - Outside a named loop, on approval, commit on `main`, push `origin main`,
      comment on the GitHub issue with the commit, checks, eval or scenario
      evidence, and close the issue.
    - For a loop-delegated issue, use `$loop`'s advance approval to commit, push,
      comment, and close without prompting, then return the verified result to
      the loop orchestrator.
    - If pushing or issue updates fail, report the failure visibly with the
      exact command or API error. Do not pretend the issue was shipped.
13. Summarize what changed, what was verified, what eval or scenario covers the
    behavior, and what remains.

## Backlog Problem Format

Use this format outside a named loop. If the backlog has ordering, dependency,
duplication, stale-state, or product-shape problems, do not propose a next task.
Respond with:

```markdown
**Backlog Assessment**
List the concrete issue-order, dependency, duplication, stale-state, or product
problems. Explain why they would make `$next` select the wrong work.

**Recommended Cleanup**
Name the smallest issue or docs cleanup that would restore a coherent next
slice. Suggest `$refine` when issue creation or editing is the right move.

**Waiting For Direction**
Ask for explicit approval or direction only when the cleanup was not already
approved.
```

## Design Proposal Format

Outside a named loop, when the backlog is coherent, respond before
implementation with:

```markdown
**Next Task**
Name the GitHub issue and the slice you propose.

**Why This Matters**
Explain the product or engineering reason briefly.

**Proposed Design**
Describe the modules, data flow, boundaries, and Eve docs consulted or still
needed. Keep it simple enough that a non-author can repeat it back.

**Repo-Specific Gates**
Summarize relevant `AGENTS.md`, manifest, roadmap, repository-model,
user-testing, and Eve-doc constraints.

**Behavior Proof**
State whether this slice changes agent behavior. If yes, propose the eval or
manual end-user scenario that will prove it.

**Tradeoffs**
Call out important choices, risks, and what is intentionally deferred.

**Acceptance Criteria**
List the concrete behavior that counts as done.

**Scope Question**
Ask exactly one unresolved high-value question, with a recommended answer. If
there are no meaningful unknowns, say so.

**Waiting For Approval**
Ask the user to approve or adjust the proposal before implementation.
```

## Useful Commands

```bash
gh repo view --json nameWithOwner,url
gh issue list --repo OWNER/REPO --state open --limit 20 --json number,title,url,body,labels,milestone,createdAt,updatedAt
gh issue view NUMBER --repo OWNER/REPO --comments --json number,title,state,url,body,comments,labels,milestone,createdAt,updatedAt
gh issue comment NUMBER --repo OWNER/REPO --body-file /tmp/issue-comment.md
gh issue close NUMBER --repo OWNER/REPO --comment "Implemented on main in COMMIT. Verified with ..."
git switch main
git pull --ff-only origin main
pnpm check
pnpm eval --list
pnpm eval:feature -- EVAL_NAME --skip-report --verbose
git commit -m "type(scope): summary"
git push origin main
```

Do not use `gh pr create`, `gh pr edit`, or draft-PR closing keywords in this
repo-specific `$next` workflow.

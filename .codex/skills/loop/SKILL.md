---
name: loop
description: >-
  Define and run long-running, self-verifying coding loops around a GitHub epic
  or bounded issue set. Use when the user says "defining a loop," asks to
  define or create a loop for an epic, or asks to run or continue a named loop
  under docs/internal/loops/. Shape or refine a new epic when needed, create
  concise LOOP.md and HANDOVER.md files, then execute linked issues
  sequentially with advance approval, fresh subagent context when available,
  durable assumption logging, and minimal blocking.
---

# Loop

Use GitHub issues as the implementation source of truth. Keep each named loop
as a small durable router under `docs/internal/loops/<loop-name>/`.

## Choose a Branch

- If the user is defining a loop, follow **Define** and stop after presenting
  the created contract and launch prompt.
- If the user explicitly asks to run or continue a named loop, follow **Run**.
- Defining a loop does not authorize implementation. Running the named loop
  authorizes the linked scope as described below.

## Define

1. Read the repository truth.
   - Read `AGENTS.md`, the manifest, roadmap, relevant ADRs, and the live GitHub
     epic and issues.
   - Use the repository's existing epic, tracking, milestone, and ordering
     conventions. Do not create a parallel backlog system.
2. Reconcile the epic.
   - For an existing epic, verify that its implementation issues form a bounded,
     dependency-ordered set and that every issue has a concrete proof mechanism.
   - Do not copy issue specifications into the loop files.
   - Resolve minor gaps with repo evidence. Ask one question only when a missing
     decision would materially change the product contract or epic boundary.
3. Shape a new epic only when needed.
   - Use `$brainstorm` against the repository until material product decisions
     settle.
   - Use `$refine` to check plausible open and closed duplicates and draft the
     issue set. Defining a new epic explicitly expands refinement to this one
     proposed batch.
   - Draft one tracking epic and the smallest self-contained implementation
     issues, each with scope, dependencies, acceptance criteria, and verification.
   - Show the complete GitHub write batch and wait for one explicit approval
     before creating or editing issues. Definition authorizes local loop files,
     not external writes.
4. Create or reconcile `docs/internal/loops/<loop-name>/` using a stable
   kebab-case name. Never overwrite existing handover evidence.
5. Write a concise `LOOP.md` with exactly these concerns:

```markdown
# <Loop name>

Scope: <one sentence>. Epic: [#N](URL). Issues: [#A](URL) -> [#B](URL).

Governance: Work one issue at a time through `$next`. Use a fresh subagent or
compact between issues. Make reversible repo-aligned assumptions, preserve
unrelated work, and record material assumptions or gaps in `HANDOVER.md`.

Exit: Every linked implementation issue is shipped and closed with its required
proof, and the repository's complete handoff gate passes.
```

6. Initialize `HANDOVER.md` as:

```markdown
# Handover

No material assumptions or gaps.
```

7. Report the folder, linked scope, and the launch prompt: `Run the <name>
   loop.` Do not start implementation in the definition branch.

## Run

### Establish Authority and State

1. Require an explicit request to run or continue a named loop.
2. Read its `LOOP.md`, `HANDOVER.md`, live epic and issues, `AGENTS.md`, roadmap,
   relevant contracts, and current repository state.
3. Treat the run request as advance approval for implementation, conventional
   commits, pushes, issue comments, and issue closure only for the issues linked
   by that loop. Do not create issues, widen the product outcome, or perform
   unrelated external actions without new approval.
4. Capture the starting branch, upstream state, `git status`, and existing diffs.
   A dirty or divergent worktree is context, not a blocker. Preserve unrelated
   changes, never reset or stash them without approval, and stage only intended
   paths. If writeback cannot yet be reconciled safely, continue local in-scope
   work and record the gap for a later retry.
5. Build the remaining queue from live issue state and dependencies. Tracking
   issues organize the queue; do not implement them as feature slices.

### Execute One Issue at a Time

1. Prefer one fresh-context subagent for each issue when subagents are available.
   - Run code-writing workers sequentially in the shared checkout.
   - Give the worker only the repository path, issue, loop files, and instruction
     to use `$next`; do not pass the parent transcript or intended solution.
   - Keep orchestration, cross-issue state, and completion checks in the root.
2. If subagents are unavailable, execute the same contract in the current
   thread and compact before selecting the next issue when compaction exists.
3. Require the issue worker to:
   - re-read the live issue and relevant repository and Eve contracts;
   - make the smallest reversible, repo-aligned assumption for underspecified
     details and record every material assumption, gap, or scope repair;
   - implement the smallest coherent slice plus only prerequisites required to
     make the linked outcome work;
   - run focused proof, behavior proof where applicable, `pnpm check`, and
     `pnpm check:full`;
   - update `HANDOVER.md` before shipping;
   - commit intentionally, push, comment with verification evidence, and close
     the issue without an approval pause; and
   - return the commit, checks, issue state, assumptions, and remaining gaps.
4. After each worker, independently inspect the diff, commit, checks, GitHub
   state, and handover entry. Continue only from verified current state.
5. Compact or discard issue-local context, refresh the queue, and select the
   next dependency-ready issue.

### Keep Moving

- Do not block on a detail merely because it is not fully defined. Prefer a
  reversible choice consistent with the epic, repository contract, and nearby
  patterns; record it in `HANDOVER.md`.
- Treat a failing check as a repair loop, not an immediate stop. Exhaust safe
  in-scope fixes and report the exact irreducible failure.
- Bound every live eval, integration test, end-to-end test, and external
  verifier with two independent clocks: a short startup/no-progress watchdog
  and a total wall-clock timeout covering process startup and cleanup. Use the
  repository's supervised runner when one exists; never rely only on a
  framework's per-test timeout. Without a repo contract, default to two minutes
  without progress and ten minutes total, and never exceed twenty minutes for
  one command without explicit user approval.
- On timeout, capture the last progress and command, terminate the complete
  process tree, and remove only resources created by that run. Confirm no
  orphan process, sandbox, container, lock, or temporary state remains before
  continuing.
- Retry a timed-out verifier at most once, and only after changing a concrete
  suspected cause. If the supervised retry reaches the same failure, record
  the blocker and continue every dependency-independent issue. Do not close the
  unverified issue and do not run the same command again unchanged.
- Interrupt and replace an issue worker that spends a verifier budget without
  producing new implementation or evidence. Hand the preserved worktree and
  exact failure to a fresh-context worker instead of waiting indefinitely.
- If one issue cannot progress, record the blocker, continue every independent
  issue, then revisit deferred issues after the queue advances.
- If credentials or an external service block writeback, continue safe local
  implementation and verification, then retry the external step before exit.
- Never fail open, close an unverified issue, hide a failed side effect, or call
  an incomplete loop complete.
- Stop the whole loop only when no remaining in-scope issue can make meaningful
  progress without new authority, unavailable credentials, or a material
  product decision that repository evidence cannot resolve.

### Maintain the Handover

Keep `HANDOVER.md` a cumulative, compact ledger. Remove the initial sentinel
when adding the first entry. Use one line per issue when there is anything to
record:

```markdown
- #N - Assumed: ...; Gap: ...; Follow-up: ...
```

Omit empty fields. Do not duplicate implementation status, acceptance criteria,
commit summaries, or check logs that already live in GitHub.

### Exit

Complete the loop only when:

- every linked implementation issue is closed with implementation and proof
  evidence;
- the final `pnpm check:full` passes on the resulting repository state;
- no in-scope commit or required GitHub write remains local or failed; and
- `HANDOVER.md` contains every material assumption, gap, deviation, and
  unresolved follow-up in its compact ledger.

If those conditions cannot be met after all independent work is exhausted,
report the loop as incomplete with the exact remaining blockers and evidence.

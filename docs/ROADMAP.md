# Roadmap

## Current Appetite

The first proof should stay narrow enough to validate with one configured
GitHub working documentation repository cloned or materialized into the Eve
Vercel sandbox. The appetite is one focused milestone: prove that the agent can
materialize the repository, enforce allowed repository actions, reason about a
PR-like change, prepare a minimal patch when warranted, run checks, export a
diff, automatically collect required workspace setup, and publish approved
changes back to GitHub.

This appetite rules out multi-channel routing, continuous monitoring,
source-repository integration, context-repository integration, and broad
documentation platform support until the core sandboxed working-repository loop
is reliable.

## Milestones

| Milestone | Goal | Done When | Issues |
| --- | --- | --- | --- |
| M0 | Project setup and operating rules | README, root instructions, and planning docs establish the Eve-first docs maintainer contract. | #5 |
| M1 | Sandboxed GitHub working-repository loop | The agent materializes one GitHub working repository in the Eve Vercel sandbox, enforces allowed repository actions, prepares and checks minimal patches, exports diffs, can push approved changes to a draft PR, and detects missing setup automatically before normal work. | #6, #1, #2, #4, #7, #11 |
| M2 | Safety and regression coverage | The sandboxed repository workflow is covered for successful paths and fail-closed behavior. | #3 |
| M3 | Later integrations | Context repositories, source evidence, multi-channel surfaces, monitoring, and broader docs platform support are considered only after M1 and M2 are reliable. | TBD |

## M1 Slice Plan

0. Establish project setup and operating rules.
   Capture the README, root instructions, validation commands, and docs-as-code
   rules needed before implementing the scenario-backed workflow.

1. Define repository model.
   Capture the working documentation repository as the primary mutable target
   inside the Eve Vercel sandbox, plus the typed input contract and explicit
   no-fallback behavior.

2. Materialize the GitHub working repository.
   Parse the repository input, reject unsupported sources, default the ref when
   omitted, clone or materialize into `/workspace/working-docs`, detect the docs
   root when omitted, and record provenance.

3. Add a policy-aware repository action runner.
   Gate clone, read, search, patch, run-checks, and export-diff actions against
   the repository contract and fail closed for unsupported actions or paths.

4. Patch, check, and export inside the sandbox.
   Emit the impact report, prepare minimal Markdown or MDX patches, run checks,
   and export a reviewable diff artifact through the action runner.

5. Add automatic setup gate.
   Check required workspace configuration at the start of each turn, guide the
   model into setup mode when fields are missing or stale, and enforce the same
   setup boundary inside docs-maintenance and writeback tools.

6. Push approved changes to GitHub.
   After explicit approval, create a branch, push the sandboxed diff, and open a
   draft PR in the working repository with report, evidence, checks, and
   uncertainty.

7. Add safety and regression coverage.
   Cover successful materialization, denied actions, unsupported sources,
   patch/check/diff behavior, approval-required writeback, and primary report
   decisions.

## Ordered Backlog

Use this table as the agreed fallback order when GitHub Projects or custom issue
ordering cannot be read.

| Order | Issue | Why Now | Depends On |
| --- | --- | --- | --- |
| 0 | #5 Establish project setup and docs-maintainer operating rules | Gives contributors and agents the stable Eve-first setup needed before the workflow implementation. | None |
| 1 | #6 Define working docs and context repository model | Makes the central mutable docs repository and sandbox boundary explicit before workflow schemas harden. | #5 |
| 2 | #1 Materialize a GitHub working repository in the sandbox | Proves the first real repository boundary before inspection, patching, or writeback. | #6 |
| 3 | #2 Add a policy-aware repository action runner | Makes `allowedActions` enforceable before patches and checks can use the repository. | #1, #6 |
| 4 | #4 Patch, check, and export diffs inside the sandbox | Turns repository access into useful docs work without granting push authority yet. | #1, #2, #6 |
| 5 | #11 Add automatic setup gate for required workspace configuration | Makes setup drift visible and collectible on every turn before docs work or writeback run in any channel. | #1, #2, #4, #6, #7 |
| 6 | #7 Push approved sandbox changes to a draft GitHub PR | Adds controlled writeback after sandbox-local behavior is proven. | #1, #2, #4, #6 |
| 7 | #3 Add safety evals for the sandboxed GitHub repository workflow | Locks in successful paths and fail-closed behavior after the full working-repository loop exists. | #1, #2, #4, #7, #11, #6 |

## Later

- Read-only source/context repository access beyond the first working docs repo.
- Eve channel setup for GitHub, Slack, Linear, Discord, or other team surfaces.
- Vercel Connect-backed access to private team context.
- Scheduled stale-doc detection.
- Persistent style and information-architecture maps.
- Multi-docs-platform support.
- AI-readable docs outputs such as `llms.txt`, structured Markdown bundles, MCP
  documentation endpoints, or task-specific knowledge packs.

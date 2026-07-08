# Roadmap

## Current Appetite

The first proof should stay narrow enough to validate in local development with
fixtures and one real working documentation repository. The appetite is one
focused milestone: prove that the agent can inspect a PR-like change, reason
against a docs-as-code repository, produce a useful documentation impact report,
and prepare a minimal patch when warranted.

This appetite rules out live provider integration, multi-channel routing,
continuous monitoring, source-repository integration, and broad documentation
platform support until the core working-documentation-repository loop is
reliable.

## Milestones

| Milestone | Goal | Done When | Issues |
| --- | --- | --- | --- |
| M0 | Project setup and operating rules | README, root instructions, and planning docs establish the Eve-first, fixture-first docs maintainer contract. | #5 |
| M1 | Repository model and fixture-backed judgment loop | The agent distinguishes the working documentation repository from optional context repositories, emits structured impact reports, and prepares minimal docs patches when needed. | #6, #1, #2 |
| M2 | Real working documentation repository smoke path | The fixture workflow can be pointed at a real docs checkout or clone, such as a fork of Saleor docs, while preserving provenance, patch minimality, and checks. | #4 |
| M3 | Eve eval coverage | The primary documentation decisions are regression-tested after the repository contract and real-docs-repo path exist. | #3 |
| M4 | Provider-backed working docs repo workflow | The agent can use scoped GitHub App access for the working documentation repository, then prepare or open reviewable draft docs PRs with human approval. | #7 |
| M5 | Read-only context repositories | The agent can inspect selected source or product repositories as evidence without treating them as patch targets. | #8 |
| M6 | Proactive documentation operations | The agent can monitor selected signals for stale or missing docs and route reviewable work to maintainers. | TBD |

## M1 Slice Plan

0. Establish project setup and operating rules.
   Capture the README, root instructions, validation commands, and docs-as-code
   rules needed before implementing the fixture-backed workflow.

1. Define repository model.
   Capture the working documentation repository as the primary mutable target
   and context repositories as optional read-only evidence sources.

2. Define fixture scenario shape.
   Capture a PR-like diff, working docs repository fixture, linked context,
   expected impact category, and expected evidence.

3. Define the documentation impact report contract.
   Include impact decision, affected pages, proposed action, evidence,
   considered-but-not-edited pages, uncertainty, patch summary, and check result.

4. Build sandbox-backed fixture inspection.
   Let the agent inspect a Docusaurus-style docs tree and code change without
   live GitHub or external provider credentials.

5. Prepare minimal patch output.
   When the report says docs are affected, produce a focused Markdown or MDX
   diff following existing page conventions.

6. Add a real working docs repository smoke path.
   Point the same workflow at a real docs checkout or clone, starting with a
   fork of Saleor docs, without live provider setup.

7. Add Eve eval coverage.
   Cover docs-needed, no-docs-needed, changelog-only, and ask-maintainer cases.

## Ordered Backlog

Use this table as the agreed fallback order when GitHub Projects or custom issue
ordering cannot be read.

| Order | Issue | Why Now | Depends On |
| --- | --- | --- | --- |
| 0 | #5 Establish project setup and docs-maintainer operating rules | Gives contributors and agents the stable Eve-first, fixture-first setup needed before the workflow implementation. | None |
| 1 | #6 Define working docs and context repository model | Makes the central mutable docs repository explicit before workflow schemas harden. | #5 |
| 2 | #1 Build fixture-backed docs impact report workflow | Establishes the core product judgment and report contract before integrations. | #5, #6 |
| 3 | #2 Add minimal patch preparation for working docs repository fixtures | Turns the report into a reviewable docs change without broad rewrite behavior. | #1 |
| 4 | #4 Add working documentation repository workflow for real docs repos | Bridges fixtures to a realistic Saleor-docs-fork style workflow while staying provider-light. | #1, #2, #6 |
| 5 | #3 Add Eve eval scenarios for primary documentation decisions | Locks in behavior after the repo contract and first real-docs path exist. | #1, #2, #4 |
| 6 | #7 Add GitHub App draft PR workflow for the working docs repository | Adds controlled write autonomy in the central docs repository after local patch behavior works. | #4, #6 |
| 7 | #8 Add read-only context repository support for source evidence | Adds source-code evidence without broadening write authority beyond the working docs repo. | #4, #6 |

## Later

- GitHub App installation and scoped provider access for the working
  documentation repository.
- Human approval gates for opening pull requests or posting comments.
- Eve channel setup for GitHub, Slack, Linear, Discord, or other team surfaces.
- Vercel Connect-backed access to private team context.
- Read-only source/context repository access beyond the first working docs repo.
- Scheduled stale-doc detection.
- Persistent style and information-architecture maps.
- Multi-docs-platform support.
- AI-readable docs outputs such as `llms.txt`, structured Markdown bundles, MCP
  documentation endpoints, or task-specific knowledge packs.

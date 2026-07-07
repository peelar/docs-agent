# Roadmap

## Current Appetite

The first proof should stay narrow enough to validate in local development with
fixtures and Eve evals. The appetite is one focused milestone: prove that the
agent can inspect a PR-like change and docs tree, produce a useful documentation
impact report, and prepare a minimal patch when warranted.

This appetite rules out live provider integration, multi-channel routing,
continuous monitoring, and broad documentation platform support until the core
judgment loop is reliable.

## Milestones

| Milestone | Goal | Done When | Issues |
| --- | --- | --- | --- |
| M0 | Project setup and operating rules | README, root instructions, and planning docs establish the Eve-first, fixture-first docs maintainer contract. | #5 |
| M1 | Fixture-backed documentation impact workflow | The agent can run against local fixture scenarios, emit structured impact reports, prepare minimal docs patches when needed, and pass Eve evals for the main decision paths. | #1, #2, #3 |
| M2 | Live repo preparation | The fixture workflow can be pointed at a real local checkout or cloned repository while preserving provenance, patch minimality, and checks. | #4 |
| M3 | Provider-backed workflow | The agent can use scoped access for GitHub and selected context systems, then prepare or open reviewable docs PRs with human approval. | TBD |
| M4 | Proactive documentation operations | The agent can monitor selected signals for stale or missing docs and route reviewable work to maintainers. | TBD |

## M1 Slice Plan

0. Establish project setup and operating rules.
   Capture the README, root instructions, validation commands, and docs-as-code
   rules needed before implementing the fixture-backed workflow.

1. Define fixture scenario shape.
   Capture a PR-like diff, docs tree, linked context, expected impact category,
   and expected evidence.

2. Define the documentation impact report contract.
   Include impact decision, affected pages, proposed action, evidence,
   considered-but-not-edited pages, uncertainty, patch summary, and check result.

3. Build sandbox-backed fixture inspection.
   Let the agent inspect a Docusaurus-style docs tree and code change without
   live GitHub or external provider credentials.

4. Prepare minimal patch output.
   When the report says docs are affected, produce a focused Markdown or MDX
   diff following existing page conventions.

5. Add Eve eval coverage.
   Cover docs-needed, no-docs-needed, changelog-only, and ask-maintainer cases.

## Ordered Backlog

Use this table as the agreed fallback order when GitHub Projects or custom issue
ordering cannot be read.

| Order | Issue | Why Now | Depends On |
| --- | --- | --- | --- |
| 0 | #5 Establish project setup and docs-maintainer operating rules | Gives contributors and agents the stable Eve-first, fixture-first setup needed before the workflow implementation. | None |
| 1 | #1 Build fixture-backed docs impact report workflow | Establishes the core product judgment and report contract before integrations. | #5 |
| 2 | #2 Add minimal patch preparation for Docusaurus-style fixtures | Turns the report into a reviewable docs change without broad rewrite behavior. | #1 |
| 3 | #3 Add Eve eval scenarios for primary documentation decisions | Locks in behavior before adding live repos and provider access. | #1, #2 |
| 4 | #4 Add local checkout workflow for real documentation repos | Bridges fixtures to realistic repo work while staying provider-light. | #1, #2, #3 |

## Later

- GitHub integration through scoped provider access.
- Human approval gates for opening pull requests or posting comments.
- Eve channel setup for GitHub, Slack, Linear, Discord, or other team surfaces.
- Vercel Connect-backed access to private team context.
- Scheduled stale-doc detection.
- Persistent style and information-architecture maps.
- Multi-docs-platform support.
- AI-readable docs outputs such as `llms.txt`, structured Markdown bundles, MCP
  documentation endpoints, or task-specific knowledge packs.

# Project Manifest

## Product Stance

This project is an open-source documentation maintainer agent for software teams
that manage docs as code. Its first job is not to broadly generate prose. Its
job is to inspect engineering context, decide whether documentation is affected,
and make the smallest reviewable docs change when the evidence supports it.

The agent is built around Eve as the durable runtime. Eve's filesystem-first
project model is the organizing contract for instructions, tools, skills,
subagents, channels, connections, schedules, sandbox behavior, and evals.

## User And Problem

The primary user is a maintainer, developer advocate, technical writer, or
engineer responsible for keeping product documentation aligned with code and
product changes. Today, a pull request can change behavior without making it
clear whether docs are stale, which page should change, or whether a docs patch
is safe to merge.

Reviewers need an agent that behaves like a careful documentation coworker: it
should assemble the relevant context, explain the docs impact, and avoid writing
when the right answer is no change, changelog only, or ask a maintainer.

## MVP

The MVP proves the documentation judgment loop with local fixtures and a real
working documentation repository. Given a PR-like code change, a
Docusaurus-style docs target, and fixture issue or product context, the agent
emits a documentation impact report. When a docs change is warranted, it
prepares a minimal Markdown or MDX patch with provenance and check results.

The first milestone does not need live GitHub, Slack, Linear, Notion, or
Discord integration. Fixture scenarios should be shaped like the future live
workflow so the agent's behavior can move to real integrations later without
changing the product contract.

## Repository Model

The central project concept is the **working documentation repository**. This is
the docs-as-code repository a user provides during onboarding. It is the primary
mutable target: the agent inspects it, applies local patches to it, and later
uses GitHub App authority to create branches or draft PRs in it.

The first realistic working documentation repository can be a fork of Saleor
docs. This gives the agent a real docs tree and real checks without requiring
access to Saleor Slack, Linear, or source repositories.

**Context repositories** are separate. They are optional, read-only sources of
evidence, such as the application or product code repository that the
documentation describes. For Saleor, a future context repository could be
`saleor/saleor`. Context repositories help the agent understand behavior, but
they are not patch targets.

## Not MVP

- Live GitHub pull request creation.
- Chat SDK adapter work or multi-surface chat routing.
- Slack, Discord, Linear, Notion, or support-thread context ingestion.
- Continuous monitoring of repositories, releases, support channels, or
  community discussions.
- Source or context repository integration.
- Broad docs platform support beyond Docusaurus-style Markdown and MDX.
- Large rewrites, new documentation sections, or autonomous publishing.
- `llms.txt`, structured documentation bundles, MCP docs endpoints, or other
  AI-reader publishing outputs.

## Principles

- Prefer no docs change over a weak or generic docs patch.
- Treat the documentation impact report as the core output; patches are a
  consequence of the report, not the other way around.
- Keep patches small enough for a human reviewer to understand quickly.
- Cite the evidence used: code diff, fixture issue context, existing page
  pattern, considered pages, and remaining uncertainty.
- Distinguish the working documentation repository from read-only context
  repositories in every provenance trail and permission decision.
- Follow Eve's installed documentation as the source of truth for runtime
  structure and channel behavior.
- Keep style knowledge inspectable in project files, fixtures, evals, or future
  skills rather than hiding it only in prompts.
- Prove the real working-documentation-repository loop before adding broad
  evals or provider integrations.
- Build evals before expanding Slack, Linear, source-repository, or proactive
  integrations so behavior can be regression tested as tools and channels
  become more capable.

## First Workflow

A maintainer gives the agent a fixture scenario containing:

- a working documentation repository fixture or real checkout;
- a PR-like code change or injected context pack;
- linked issue or product context;
- optional existing docs conventions or expected style notes.

The agent inspects the scenario in an Eve sandbox, identifies affected docs
surfaces in the working documentation repository, decides whether a docs change
is needed, and emits a documentation impact report. If a change is needed, it
prepares a minimal docs patch and records which checks ran.

## Success Signals

- The agent correctly says "no docs change required" for changes that do not
  affect public behavior.
- The agent chooses an existing page instead of creating unnecessary new pages.
- The agent makes minimal diffs that match local docs conventions.
- The report names pages considered but not edited.
- The report distinguishes evidence-backed claims from uncertainty.
- Fixture evals cover docs-needed, no-docs-needed, changelog-only, and
  maintainer-question scenarios.
- A Docusaurus-style build or relevant docs check can be run and reported when
  the fixture provides one.

## Open Questions

- Which fixture format should represent a PR-like code change, working docs
  repository, linked issue, and expected outcome?
- Should the first patch output be a git diff file, a working-tree edit inside
  the sandbox, or both?
- What is the minimum onboarding shape for a working documentation repository:
  Git URL only, GitHub App installation, or both?
- How much style knowledge belongs in root instructions versus a load-on-demand
  Eve skill?
- Which docs check should be mandatory for the first working docs repository
  fixture: build, typecheck, link check, or a lighter smoke check?

## Truth Surfaces

- GitHub Issues: executable backlog and completion source of truth.
- `docs/ROADMAP.md`: milestones, appetite, dependencies, and fallback order.
- `docs/adr/`: durable decision records, created through `$to-adr`.
- `AGENTS.md`: agent rules and source-of-truth pointers only.
- Installed Eve docs under `node_modules/eve/docs/`: source of truth for Eve
  project layout, runtime behavior, channels, tools, sandbox, connections,
  schedules, subagents, and evals.

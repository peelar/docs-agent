# eve Agent App

This project uses the eve framework. Before writing code, read the relevant guide
from the installed eve package docs. In most installs, those docs are at
`node_modules/eve/docs/`. In workspaces or local package installs, resolve the
installed `eve` package location first and read its `docs/` directory. If
package docs are unavailable, use https://eve.dev/docs as a fallback.

## Planning Sources

- GitHub Issues are the executable backlog and completion source of truth.
- Read `docs/MANIFEST.md` before product or positioning changes.
- Read `docs/ROADMAP.md` before selecting implementation order.
- Read relevant ADRs in `docs/adr/` before touching related architecture or
  product contracts.
- Update planning docs in the same PR when a change alters product scope,
  durable architecture, or the development workflow.

## Docs Maintainer Rules

- Treat the documentation impact report as the primary output; patches follow
  from the report.
- Prefer no docs change over weak, broad, or unsupported documentation edits.
- Keep documentation patches small, reviewable, and grounded in existing page
  structure, terminology, and examples.
- Cite provenance for every docs decision: code or diff evidence, context used,
  pages considered, checks run, and remaining uncertainty.
- During the first milestone, assume local fixtures, local repo state, or a
  working documentation repository checkout. Do not assume live GitHub App,
  Slack, Linear, Notion, Discord, or source repository access.
- Distinguish the working documentation repository from optional read-only
  context repositories in planning, provenance, permissions, and patch targets.

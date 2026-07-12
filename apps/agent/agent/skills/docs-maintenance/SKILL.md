---
name: docs-maintenance
description: Always load before a documentation-impact or working-repository workflow. Use when asked to investigate documentation impact, verify whether docs need to change, prepare or revise documentation, or produce a checked documentation diff.
---

# Docs Maintenance

## Route the work

1. Follow the current dynamic setup instructions. Reuse configured setup.
2. Establish the requested reader outcome, change context, source evidence, and
   likely documentation surface.
3. When the input fits `run_docs_maintenance_scenario`, use it as the complete
   repository workflow. Answer from its report; do not repeat its work with
   lower-level repository tools.
4. Otherwise, inspect the working documentation repository before deciding.

## Decide and author

- Verify relevant current pages and nearby conventions. A no-change conclusion
  still needs repository evidence and a clean diff.
- Use `get_docs_profile` before writing.
- Record the smallest reader-solving choice with `editorial_recommendation`.
- Keep localized changes inline. For substantial work, keep the originating
  signal and Eve session, use `owned_docs_work`, and create a `content_plan`
  before drafting.
- Use `authoring_workspace` for complete multi-file drafts, revision, checks,
  and one reviewable diff.
- Stop when evidence or a consequential product decision is missing.

## Report and publish

Report the decision, evidence, pages considered, checks, changed files or clean
diff, and remaining uncertainty. Sandbox drafting needs no approval. Publishing
always requires explicit approval through `publish_working_repository_pr`.

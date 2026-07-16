# Repository boundary

All configured repositories use one authenticated shallow Git cache under
`/workspace/repositories`.

- `config.ts` is the fixed catalog. Repository IDs resolve to configured GitHub
  coordinates and a role; the model cannot supply arbitrary origins.
- `git.ts` initializes and incrementally fetches Git objects. GitHub App tokens
  are brokered at the sandbox firewall and never enter commands, remotes, or
  tool results.
- `shared/github.ts` resolves one GitHub App token through the configured
  documentation-repository installation and uses it for every GitHub API
  operation. GitHub's verified repository visibility decides Git transport:
  public repositories fetch without credentials, while private repositories
  receive the shared token through the sandbox firewall.
- `inspection.ts` lists, searches, reads, and compares immutable revisions
  directly from Git objects, so read operations do not need a populated
  working tree.
- `service.ts` exposes those bounded read operations through the `repository`
  Eve tool.
- `documentation/` defines the future approval-gated writeback workflow over
  the same Git workspace.
- `metadata/` remains a deferred GitHub API surface for releases, issues, pull
  requests, tags, and commits.

The role is the authority boundary:

- `evidence` repositories can be fetched and inspected but never enter a
  writeback workflow.
- the `documentation` repository can later use a working tree, but commit,
  push, and draft-PR operations still require explicit approval.

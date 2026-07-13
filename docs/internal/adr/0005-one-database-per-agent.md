# ADR-0005: Use One Database Per Agent

Status: Accepted
Date: 2026-07-13
Supersedes: None

## Context

Paige currently deploys one Eve agent and one paired operator app against one
app-owned SQLite/libSQL database. The schema contains `workspace_id` columns and
the runtime currently uses a canonical `default` workspace. Earlier planning
left both database-per-workspace and database-per-agent open as possible future
Turso models.

The accepted product direction is that Paige may later become a multi-tenant
SaaS with shared application runtime. That creates a consequential storage
choice now: use workspace rows as a tenant boundary inside one shared database,
or keep every agent's product state in its own database.

This ADR chooses the isolation boundary without introducing the SaaS control
plane, provisioning service, account model, or request-time tenant routing.

## Decision

Every Paige agent owns exactly one application database. No other Paige agent
may read from or write to that database.

For the current product:

- one Paige installation contains one agent;
- its Eve app and paired server-side operator app use the same agent-owned
  database through `DOCS_AGENT_DATABASE_URL` and, when required, a
  database-scoped `DOCS_AGENT_DATABASE_AUTH_TOKEN`;
- another agent, including one owned by the same person or organization, must
  use another database and credential;
- database selection is deployment configuration, never browser input,
  provider input, model input, `workspace_id`, or `tenant_id`;
- `workspace_id` remains an internal domain scope inside one agent database and
  is not a cross-agent authorization boundary;
- database credentials remain server-only and are never exposed to operators,
  models, tools, client bundles, logs, or artifacts.

If a SaaS layer is intentionally introduced later, the default topology will
use shared application runtime with one database per agent. An application-owned
control plane must authenticate agent membership, map provider installations
and sessions to an agent, and bind every operation to the corresponding
database before any agent state is accessed. Management credentials used to
provision databases must stay outside agent runtimes.

Shared runtime is an accepted direction, not current implementation scope. The
current module-global database client, one-database migration path, connector
configuration, operator allowlist, and single-agent Eve runtime remain valid
until SaaS work begins. They must not be generalized into a shared database or
request-supplied tenant scope.

## Options Considered

- One shared application database with row-scoped agents or workspaces: simpler
  fleet operations and global queries, but every query becomes an isolation
  boundary and existing unscoped Chat SDK tables would need redesign. Rejected.
- One database and dedicated runtime deployment per agent forever: closest to
  the current implementation and strongly isolated, but multiplies deployment,
  connector, observability, and upgrade operations. Retained as a possible
  dedicated deployment option, not the default SaaS topology.
- Shared application runtime with one database per agent: preserves a strong
  product-state boundary while avoiding one full deployment per agent. Accepted
  as the future topology, with authenticated routing and fleet operations
  required before implementation.

## Consequences

- The current environment-selected singleton database client is correct only
  because one process serves one agent.
- The agent and web apps share typed services and one agent database; the word
  `shared` must never imply sharing that database with another agent.
- Existing `workspace_id` columns may organize one agent's domain state but must
  not become an excuse to store several agents in one database.
- Current migrations target one configured database. A future shared runtime
  needs provisioning, schema-version tracking, compatibility policy, fleet
  migrations, restore, and deletion orchestration.
- Eve route authentication alone is not enough for a shared runtime. The
  application must enforce agent ownership for session creation, continuation,
  streaming, callbacks, approvals, and schedules.
- Provider connectors that are process-global today need authenticated
  installation-to-agent routing before multiple agents share a process.
- Cross-agent analytics cannot depend on joining agent databases. A future SaaS
  control plane may store bounded lifecycle, health, and billing projections,
  but not silently copy agent content.
- Current isolation relies on unique deployment configuration and
  database-scoped credentials. Paige does not yet assert an immutable agent
  identity stored inside the database, so accidental credential reuse across
  deployments remains an explicit operational risk.

## Links

- [Architecture contract](../../ARCHITECTURE.md)
- [ADR-0001: Persist Docs Signals In An App-Owned Database](./0001-docs-signal-persistence.md)
- [ADR-0002: Use Separate Eve And Next.js Apps In A Turborepo](./0002-turborepo-agent-and-web-apps.md)
- [Deployment guide](../../DEPLOYMENT.md)
- [Turso Platform API](https://docs.turso.tech/api-reference/introduction)
- [Turso database tokens](https://docs.turso.tech/api-reference/databases/create-token)

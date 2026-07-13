# Vercel Deployment

The repository root owns workspace orchestration; it is not a deployable app.
Create two Vercel projects from this repository:

| Project | Root Directory | Owns |
| --- | --- | --- |
| Agent | `apps/agent` | Eve routes, channels, tools, sandboxes, workflows, and runtime variables |
| Operator | `apps/web` | Authenticated pages, server-side control-plane reads, and audited operator actions |

These two projects are two server surfaces of one Paige agent. Both must use
Node 24.18.0 and the same agent-owned durable database. Configure
`DOCS_AGENT_DATABASE_URL` in both projects and a token scoped to that database
as `DOCS_AGENT_DATABASE_AUTH_TOKEN` when the provider requires it. Do not reuse
that database URL or token for another Paige agent, even when the agents have
the same owner or deployment account. Do not use an organization-level Turso
management token as an application database token.

The database URL and token are server-only. They must not be exposed through
`NEXT_PUBLIC_*`, browser payloads, model context, tool output, logs, or
artifacts. Operators access typed product projections through the authenticated
web app; they do not receive direct database access.

The agent's Vercel build applies the committed Drizzle migrations before Eve
builds. Make sure that migration has completed before either project serves
code expecting a new schema.

The current deployment model contains no SaaS registry or tenant router. A
second agent requires a second database and separately scoped credential. See
the [architecture contract](./ARCHITECTURE.md) and
[ADR-0005](./internal/adr/0005-one-database-per-agent.md).

## Agent Project

Configure a credential for the gateway model selected by `EVE_GATEWAY_MODEL`,
or rely on the linked Vercel project's OIDC support. Set
`DOCS_AGENT_SLACK_CONNECTOR` and `DOCS_AGENT_LINEAR_CONNECTOR` when their UIDs
differ from the defaults. Attach each connector and inbound trigger to this
project as described in [Slack and Linear](./TEAM_CONTEXT.md).

After deployment, verify the public Eve health route:

```sh
curl https://<agent-origin>/eve/v1/health
```

## Operator Project

Set `DOCS_AGENT_EVE_URL` to the agent deployment origin. Production operator
access also requires:

```text
DOCS_AGENT_OPERATOR_ACCESS=github
BETTER_AUTH_SECRET=<at least 32 characters>
BETTER_AUTH_URL=https://<operator-origin>
GITHUB_CLIENT_ID=<oauth-app-client-id>
GITHUB_CLIENT_SECRET=<oauth-app-client-secret>
DOCS_AGENT_APPROVED_GITHUB_LOGINS=<comma-separated-logins>
```

Register this GitHub OAuth callback:

```text
<BETTER_AUTH_URL>/api/auth/callback/github
```

Keep `DOCS_AGENT_APPROVED_GITHUB_LOGINS` server-only. Missing or invalid
configuration leaves protected access unavailable. Local and test access modes
are rejected on a Vercel production deployment.

The GitHub session cookie belongs only to the operator origin. It is not an Eve
credential and must never be forwarded to the separately deployed agent.

The operator's Status page performs server-side connector and repository
checks. Attach the provider connectors it needs to inspect, while keeping their
inbound Slack and Linear triggers pointed at the agent project.

## Verify The Pair

Open the authenticated `/status` page and confirm the database, Eve runtime,
working repository, GitHub writeback, Slack, and Linear checks. Reachability is
not delivery proof: send a real Slack mention or Linear Agent Session event
before treating a connector as complete.

See [User Testing](./internal/USER_TESTING.md#operator-github-oauth-smoke) for the
production auth smoke and
[Connector Installation Handoffs](./internal/USER_TESTING.md#connector-installation-handoffs)
for provider verification.

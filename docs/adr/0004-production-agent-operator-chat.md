# ADR-0004: Production agent operator chat

Status: Accepted
Date: 2026-07-20

## Context

The operator chat previously depended on a local Eve server and sent local-only
authentication from the browser. Operators need this screen to talk to the
deployed Paige agent without exposing a production credential to browser code.

## Decision

The local web app proxies same-origin `/eve/**` requests to Paige's public
production alias. The proxy accepts only local operator requests and adds a
Vercel OIDC token on the server. The setup provisioner discovers and verifies
the production alias, then writes its URL and the token only to the web app's
local environment.

## Consequences

- Web chat and production channels use the same deployed agent.
- The browser never receives the Vercel identity token.
- `pnpm dev` starts only the operator app; local agent work uses `pnpm dev:agent`.
- Setup fails when no reachable public production alias exists.

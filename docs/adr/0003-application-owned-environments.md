# ADR-0003: Application-owned environments

Status: Accepted
Date: 2026-07-18

## Context

Paige's agent and web applications need some of the same values, including the
shared database connection. A root environment file made application ownership
unclear and also exposed local processes to unrelated Vercel deployment
metadata.

## Decision

Each application owns its `.env.local` and loads it through its normal runtime.
Shared values may be repeated. The setup provisioner pulls Vercel configuration
once, validates it, writes only the values each application needs, and removes
the temporary pull. Paige does not use a root `.env.local`.

## Consequences

- The agent and web application have explicit configuration boundaries.
- Shared database values are intentionally duplicated in generated local files.
- Root commands delegate to application scripts instead of loading secrets.
- Adding an environment variable requires assigning it to an application.

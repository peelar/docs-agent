# Workspace repository configuration

## Context

Paige needs one documentation repository and optional evidence repositories
before repository work can begin. The setup must be shared by a Slack team,
while corrections and abandoned setup attempts must not affect teammates.
Accepting arbitrary repositories during later tool calls would weaken the
access boundary.

## Decision

Store one active repository configuration per verified Slack workspace in
libSQL. Keep the draft proposal in Eve conversation state. Normalize GitHub
URLs, remove duplicates, validate access for each real repository, and require
explicit confirmation before activating the whole proposal. Resolve all later
repository IDs from the active configuration. Give the documentation
repository write-capable access and evidence repositories read-only access.

## Consequences

Teammates immediately share confirmed setup. Corrections remain private until
confirmed. Concurrent changes use revision checks instead of silent
overwrites. Repository features require configured database storage and a
verified Slack workspace identity.

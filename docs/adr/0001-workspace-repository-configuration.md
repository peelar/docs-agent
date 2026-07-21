# Agent repository configuration

## Context

Paige needs one documentation repository and optional evidence repositories
before repository work can begin. One database belongs to one Paige agent, and
the setup must be shared across every channel connected to that agent. Channel
identities must not choose or partition repository access. Corrections and
abandoned setup attempts must remain inside their conversation.
Accepting arbitrary repositories during later tool calls would weaken the
access boundary. Arbitrary web retrieval would create the same weakness by
letting the agent read repository content outside the configured catalog.

## Decision

Store one active repository configuration for the agent in libSQL. Keep the
draft proposal in Eve conversation state. Normalize GitHub
URLs, remove duplicates, validate access for each real repository, and require
explicit confirmation before activating the whole proposal. Resolve all later
repository IDs from the active configuration. Give the documentation
repository write-capable access and evidence repositories read-only access.
Disable arbitrary web fetch and search tools. A repository access failure must
remain visible instead of being bypassed through another network or shell
capability.

## Consequences

Every connected channel immediately shares confirmed setup. Corrections remain
private until confirmed. Concurrent changes use revision checks instead of
silent overwrites. Repository features require configured database storage but
do not require a Slack, Linear, Teams, or other channel identity.
Repository outages, missing access, and rate limits can reduce availability,
but they cannot silently widen Paige's evidence authority.

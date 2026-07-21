# ADR-0005: Slack reaction ownership

Status: Accepted
Date: 2026-07-21

## Context

Slack users need immediate evidence that Paige accepted an explicit request,
but routine Eve reasoning and tool statuses make the channel feel noisy. Emoji
can also carry useful social meaning that depends on the conversation. Treating
all of these as one lifecycle-to-emoji mapping would either make acceptance
unreliable or make Paige's expression rigid.

## Decision

The Slack harness owns protocol feedback. It adds an `eyes` working reaction to
accepted direct messages and explicit mentions, removes it when the turn stops
working, and suppresses routine reasoning and tool statuses. Passive messages
in followed threads do not receive this harness acknowledgement.

For long-running turns, the harness may post a small, bounded set of generic
progress messages. It checks elapsed time at Eve's durable action boundaries,
posts the first update after one minute and at most one later update, and never
includes tool names or raw trace details. These updates are reassurance, not a
workflow log or a substitute for the final response.

Paige may add one discretionary reaction to the message that started the
current Slack turn. A turn-scoped tool provides that capability without
exposing arbitrary Slack message identifiers. The harness and tool share the
same reaction validation, target, adapter, and add/remove operation.

Reactions never represent approval, rejection, success, failure, or another
authoritative workflow state. Eve replies and input cards continue to carry
those meanings.

## Consequences

- Immediate acceptance remains deterministic and does not depend on a model
  tool call.
- Long-running work remains visibly active without restoring noisy tool traces
  or creating an unbounded stream of status messages.
- Paige can react naturally under light rules without a hardcoded semantic
  emoji matrix.
- A reaction API failure is logged but does not prevent accepted work from
  running or completed work from being delivered.
- Slack reaction behavior remains channel-specific while Eve session and
  approval contracts stay platform-independent.

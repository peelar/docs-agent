# Session index and continuation boundary

## Context

Operators need one place to find Paige activity from Slack and the local web
chat. Eve already owns durable session history and continuation. Copying that
history into Paige storage would introduce a second source of truth, while
putting continuation tokens in URLs or the shared database would make a
read-only activity view capable of resuming conversations.

## Decision

Store only session registry metadata in Paige's libSQL database: Eve session
ID, source, title, status, and timestamps. Read activity directly
from Eve's event stream. Keep Slack and local web conversations separate.

Register Slack metadata from Eve's durable `message.received` hook rather than
after channel dispatch. Indexing is therefore part of the turn: storage failure
fails the turn, while a later message can enrich an earlier partial lifecycle
row. Store Chat SDK subscriptions, locks, deduplication keys, lists, and queues
in the same libSQL database so webhook coordination survives restarts and
multiple instances.

A new local conversation begins at `/agent` and receives `/agent/<sessionId>`
only after its first message creates an Eve session. Store only the latest
continuation token in that browser, keyed by the opaque Eve session ID. The
sessions index receives changed database snapshots over server-sent events;
the web process polls libSQL, so no message broker is required.

## Consequences

The index does not backfill sessions created before this feature is deployed.
Activity detail stays read-only and can be opened without a continuation token.
A local conversation can be resumed only in the browser that holds its latest
token. Eve remains the source of truth for history and Paige storage remains
small and operational. One Paige agent owns one database; the registry and Chat
SDK state have no tenant or workspace partition.

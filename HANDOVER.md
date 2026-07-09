# Handover

## #20 Decide persistence for docs signals and workflow state

Decision: docs signals and workflow state belong in an app-owned
Drizzle/libSQL database, not repo-local JSON, Eve session state, GitHub
comments, Slack, or Linear.

Design: ADR-0001 records the storage choice, the minimum signal records, the
query needs, and fail-visible behavior. `docs/REPOSITORY_MODEL.md` carries the
same boundary in product terms.

User effect: future Slack, Linear, watched-repository, and scheduled docs work
can survive restarts and handoffs without pretending provider comments are the
source of truth.

Behavior verification: read ADR-0001 and the repository model. The expected
behavior is that durable signal capture requires database storage; one-off
answers may still be given, but queued signal/workflow claims must not be
silently dropped when storage is unavailable.

## #28 Add database foundation and migrate setup persistence

Decision: setup persistence now uses the same app-owned Drizzle/libSQL database
boundary as future signal state, while remaining a separate setup record.

Design: add a `workspace_setup` table, Drizzle config, migration script, and a
runtime DB client. Local dev defaults to `.docs-agent/docs-agent.sqlite`.
Deployed runtimes require `DOCS_AGENT_DATABASE_URL`. A valid legacy
`.docs-agent/config.json` is imported only when the database has no setup row;
new writes go only to the database.

User effect: users keep the same setup tools and setup-mode behavior, but setup
state is durable in the real app store instead of a JSON side file. Missing or
broken storage is reported before docs maintenance proceeds.

Behavior verification: run `pnpm check`. Behaviorally, first-run setup should
still ask for the working documentation repository, configured setup should be
remembered across turns, legacy JSON setup should import once, and deployed
runtime without `DOCS_AGENT_DATABASE_URL` should fail visibly.

## #21 Add a docs signal work queue

Decision: docs signals are provider-neutral workflow records in the app
database. They are not setup config, Slack state, Linear state, or docs patches.

Design: add `docs_signals`, source, link, artifact, and event tables. Raw source
text and provider ids live in source rows; model summaries and extracted claims
live on the signal. The runtime owns workspace scoping and exposes small tools
to create, list, read, and lifecycle-update signals.

User effect: Slack, Linear, watched releases, and future scheduled scans can all
create the same kind of durable docs work item before channel-specific behavior
exists.

Behavior verification: run `pnpm check`. Behaviorally, creating the same Slack
thread or Linear permalink twice should return one signal, open-signal lists
should hide closed signals, lifecycle updates should append events, and missing
or stale storage should fail visibly.

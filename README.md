<div align="center">
  <img src="./assets/paige/paige-magpie-512.png" alt="Paige, the documentation agent" width="320" />

  <h1>Paige</h1>

  <p><strong>A documentation agent that follows the work and keeps your docs accurate.</strong></p>
</div>

Paige is an open-source documentation agent for software teams. Product truth
rarely arrives as a tidy writing task: it is scattered across Slack threads,
Linear issues, releases, pull requests, and support notes. Paige follows those
signals, checks what the documentation actually says, and keeps the public story
accurate.

Paige starts with a documentation impact report. The result may be a small
Markdown or MDX patch, a changelog entry, no documentation change, or a question
for a maintainer. Patches are prepared and checked in an isolated repository
workspace, and publishing remains behind explicit approval.

## How It Works

```text
Slack · Linear · Releases · Repositories
                    ↓
             Provenance and evidence
                    ↓
        Documentation impact decision
                    ↓
    No change · Question · Changelog · Patch
                    ↓
             Approved draft PR
```

## Technical Overview

| Concern | Implementation |
| --- | --- |
| Agent runtime | [Eve](https://eve.dev) |
| Team context | Explicit Slack mentions and Linear Agent Sessions |
| Repository evidence | GitHub working repository plus optional read-only watched repositories |
| Isolation | Eve sandbox with the working documentation repository at `/workspace/working-docs` |
| Durable state | Drizzle with local SQLite or a deployed libSQL-compatible database |
| Writeback | Small checked diff, followed by an explicitly approved branch and draft PR |
| Regression proof | Live Eve evals covering patches, no-change decisions, signals, safety, and conversation |

## Run Locally

Use Node 24.18.0.

```sh
pnpm install
pnpm eval
pnpm dev
```

Local state uses `.docs-agent/docs-agent.sqlite` when
`DOCS_AGENT_DATABASE_URL` is not set. A deployed runtime must set
`DOCS_AGENT_DATABASE_URL` and, when required by the provider,
`DOCS_AGENT_DATABASE_AUTH_TOKEN`. Missing required persistence fails visibly
before documentation work continues.

## Connect Team Context

Slack uses Eve's Slack channel and Vercel Connect. Set
`DOCS_AGENT_SLACK_CONNECTOR`, or create the default `slack/docs-agent`
connector and attach its trigger to `/eve/v1/slack`. Paige handles explicit app
mentions and DMs, fetches new thread context, and records substantive threads as
documentation signals.

Linear uses Eve's Linear Agent Session channel and Vercel Connect. Set
`DOCS_AGENT_LINEAR_CONNECTOR`, or create the default `linear/docs-agent`
connector and attach its trigger to `/eve/v1/linear`. Paige handles delegated or
prompted Agent Sessions without crawling or editing Linear issues.

See [Paige's identity and asset guide](./docs/IDENTITY.md) for the visual assets
and the manual Slack display-name and avatar setup.

<div align="center">
  <img src="./assets/paige/paige-magpie-512.png" alt="Paige, the documentation agent" width="320" />

  <h1>Paige</h1>

  <p><strong>A documentation agent that decides what should change—and what should not.</strong></p>
</div>

Paige is an open-source documentation agent for software teams. Bring it a
product signal from a conversation, issue, release, or repository. Paige checks
what the documentation and source evidence actually say before deciding whether
anything should change.

A workspace question may end as a sourced answer, an explicit abstention, or a
recommendation without creating documentation work. When a documentation
change is requested and supported by evidence, Paige can prepare and check a
reviewable draft in an isolated repository workspace. Publishing remains behind
explicit approval. Documentation is Paige's only mutable product domain;
watched, context, and source repositories remain read-only evidence.

Paige is in public alpha. The stable path today is an explicit request or team
signal, bounded source inspection, and a sourced answer, no-change conclusion,
recommendation, or—when justified—a reviewable draft. Continuous watch
execution is not part of the current claim.

## Get Started

The [`setup` skill](./.agents/skills/setup/SKILL.md) is the go-to way to start
with this repository. In Codex, run `$setup`. It installs Paige, connects your
documentation repository and integrations, and checks that everything is ready.

For manual local setup, use Node 24.18.0.

```sh
pnpm install
pnpm eval --list
pnpm dev
```

`pnpm dev` starts the Eve app and operator app together. Use
`pnpm dev:agent --no-ui` or `pnpm dev:web` to run one app by itself.
Portless keeps their local addresses stable while assigning internal ports:

| App | Local address |
| --- | --- |
| Operator UI | <http://paige.localhost:1355> |
| Eve agent | <http://agent.paige.localhost:1355> |

## How It Works

```text
Slack · Linear · Releases · Repositories
                    ↓
       Bounded, attributable evidence
                    ↓
      Answer · Abstain · Recommendation
                    │ explicit docs request
                    ↓
         Documentation decision
                    ↓
       No change · Question · Changelog · Patch
                    │ patch + approval
                    ↓
             Approved draft PR
```

## Technical Overview

| Concern | Implementation |
| --- | --- |
| Agent runtime | [Eve](https://eve.dev) |
| Operator app | Next.js control plane with explicit local access or allowlisted GitHub authentication |
| Workspace | pnpm and Turborepo with `apps/agent` and `apps/web` |
| Team context | Explicit Slack mentions and Linear Agent Sessions |
| Repository evidence | GitHub working repository plus optional read-only watched repositories |
| Isolation | Eve sandbox with the working documentation repository at `/workspace/working-docs` |
| Durable state | Drizzle with local SQLite or a deployed libSQL-compatible database |
| Writeback | Small checked diff, followed by an explicitly approved branch and draft PR |
| Regression proof | Live Eve evals covering patches, no-change decisions, signals, safety, and conversation |

## Guides

- [Local development](./docs/DEVELOPMENT.md)
- [Vercel deployment](./docs/DEPLOYMENT.md)
- [Slack and Linear](./docs/TEAM_CONTEXT.md)

Maintainer documentation lives under [`docs/internal`](./docs/internal/MANIFEST.md).

## Contributing and Support

Read [Contributing](./CONTRIBUTING.md) before proposing substantial work. Use
[Support](./SUPPORT.md) for public questions and [Security](./SECURITY.md) for
private vulnerability reports. Participation follows the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Paige is available under the [Apache License 2.0](./LICENSE).

# Local Development

Use Node 24.18.0 (see `.node-version`) and the pnpm version managed by
Corepack. Paige needs no hand-written config or manual database migration.

## Start Paige

```sh
corepack enable
pnpm install
pnpm --filter docs-agent dev
```

On the first run, enter `/model` in Eve and choose AI Gateway via Project
(recommended) or provide a model key. Eve saves the local credential for later
runs. Keep the agent running.

In a second terminal, start the operator app:

```sh
pnpm dev:web
```

Open the printed URL and use **Status** to configure the workspace. Enter the
working documentation repository URL and the installed GitHub connector. Leave
the ref as `main` and the docs root empty unless the repository needs different
values. Watched repositories, Slack, and Linear are optional.

Paige creates and migrates `.docs-agent/docs-agent.sqlite` automatically. Use
`pnpm dev --no-ui` when the Eve terminal UI is not needed.

## Validate Changes

Install Playwright's browser once, then run the required repository gate:

```sh
pnpm --filter @docs-agent/web exec playwright install chromium
pnpm check
```

See [Deployment](./DEPLOYMENT.md) for production and [Team Context](./TEAM_CONTEXT.md)
for Slack and Linear installation.

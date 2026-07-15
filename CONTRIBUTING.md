# Contributing to Paige

Paige is an early open-source project. Contributions are welcome, but the bar
is not “make the agent do more.” The bar is making documentation decisions more
trustworthy, inspectable, and useful to maintainers.

## Before You Start

- Open an issue before substantial product, architecture, integration, or UI
  work. A small bug fix or documentation correction does not need ceremony.
- Keep changes generic. `peelar/saleor-docs` is the dogfood repository, not a
  product-specific workflow to encode.
- Do not add silent fallbacks or success-shaped stubs for required integrations.
- Preserve explicit approval before publication or another external side
  effect.

The project is in public alpha. Some proposed features may be rejected because
they widen authority faster than Paige can prove the behavior safely.

## Development

Use Node 24.18.0 and pnpm 11.12.0.

```sh
pnpm install
pnpm check
```

`pnpm check` is the fast affected-package loop. Before handing over a complete
change, run:

```sh
pnpm check:full
```

The full check owns linting, typechecks, deterministic tests, builds, browser
tests, and repository smoke checks. Do not replace it with a hand-picked list
of commands that happens to pass locally.

See [Local Development](./docs/DEVELOPMENT.md) for setup and focused commands.

## What Good Contributions Look Like

- A bug report includes the input, expected behavior, actual behavior, and the
  boundary that failed.
- A behavior change includes a deterministic test or Eve eval that would catch
  a regression.
- An integration fails visibly when credentials, permissions, or provider state
  are missing.
- A documentation patch names the evidence used and keeps claims within the
  current runtime.
- A pull request is small enough to review without reconstructing an unrelated
  refactor.

## Pull Requests

Explain the problem first, then the behavioral change. Include the checks you
ran and any proof that still depends on a real provider, deployment, or human
review.

Use conventional commit messages when preparing commits, for example:

```text
fix(agent): preserve no-change decisions
docs: explain repository approval boundary
```

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](./LICENSE).

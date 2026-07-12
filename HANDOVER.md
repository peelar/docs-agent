# Handover

## #37: real GitHub OAuth deployment smoke

The deterministic implementation and browser coverage are complete, but this
workspace has no linked web deployment or configured `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, GitHub OAuth client credentials, or approved-login allowlist.
The issue contract requires a real GitHub OAuth smoke in a preview or
production-like deployment before closure. Follow the scenario in
`docs/USER_TESTING.md`, attach non-secret evidence to #37, and close it only when
that smoke passes.

## #32: repository-backed instruction regression proof

The instruction-boundary implementation, deterministic checks, signal workflow
eval, and focused skill-routing eval are complete. The required
`saleor-docs-user-tests` and `watched-repositories` suites cannot reach their
repository workflows in this environment because `configure_working_repository`
fails visibly with `no GitHub connector is configured`. This is the same
external boundary observed in the pre-refactor baseline. Configure Eve's GitHub
connector, run the two commands recorded in `docs/USER_TESTING.md`, attach the
non-secret results to #32, and close it only when both suites pass.

# Handover

## #37: real GitHub OAuth deployment smoke

The deterministic implementation and browser coverage are complete, but this
workspace has no linked web deployment or configured `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, GitHub OAuth client credentials, or approved-login allowlist.
The issue contract requires a real GitHub OAuth smoke in a preview or
production-like deployment before closure. Follow the scenario in
`docs/USER_TESTING.md`, attach non-secret evidence to #37, and close it only when
that smoke passes.

# Paige Manifest

## Mission

Paige is a documentation agent for software teams. It should understand product
signals, inspect the relevant evidence, and decide what documentation should
change—or whether nothing should change.

## Current Product

Paige currently responds only to direct messages in Slack. Chat SDK handles the
Slack transport and Eve runs the model conversation.

Paige can inspect every configured repository through one authenticated,
Git-backed repository tool. Each sandbox keeps a shallow Git object cache that
supports exact-revision reads and comparisons without requiring a populated
working tree. Evidence repositories remain read-only. The documentation
repository uses the same Git foundation but is the only role eligible for a
future approval-gated writeback workflow. GitHub metadata remains a typed
implementation shell. There is no documentation workflow, product database,
or automated writeback.

## Stack

- Eve
- Chat SDK
- Vercel Connect
- Microsandbox
- Next.js and React
- Drizzle and libSQL
- pnpm and Turborepo

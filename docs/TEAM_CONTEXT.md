# Slack And Linear

Slack and Linear are app-scoped integrations managed through
[Vercel Connect](https://vercel.com/kb/guide/vercel-connect). Provider consent
and administrator approval are human steps. The authenticated Status page shows
connector creation, provider installation, trigger delivery, and repository or
provider grants separately; use its handoffs rather than treating token
issuance as completed setup.

## Slack

Slack uses Eve's Chat SDK channel with the Chat SDK Slack adapter. Set
`DOCS_AGENT_SLACK_CONNECTOR`, or use the default `slack/docs-agent`, and attach
the connector trigger to:

```text
/eve/v1/slack
```

The current channel accepts app mentions and direct messages. An accepted
mention enrolls its thread for scoped participation. Ordinary channel messages
are discarded before Chat SDK sees their content unless the thread has active
presence and a durable subscription. The default policy replies to useful
follow-ups, stays silent for unrelated conversation, and expires presence after
seven days of inactivity. Operators can narrow entry and continuation from the
Settings page.

Subscribe the Slack app to these bot events:

- `app_mention`
- `message.channels`
- `message.groups`
- `message.im`

Grant the corresponding `app_mentions:read`, `channels:history`,
`groups:history`, and `im:history` scopes, plus `chat:write` and `users:read` for
reply delivery and user attribution. The adapter may also need conversation
read scopes when it resolves channel metadata; follow the installed Slack
adapter's manifest when configuring a custom app.

### Real-time Search

During a fresh user-triggered Slack turn, Paige can run one bounded
`assistant.search.context` request to fill a concrete context gap. Add
`search:read.public` for public messages. Add `search:read.private`,
`search:read.mpim`, or `search:read.im` only for surfaces the workspace intends
to support; those scopes require the requesting user's Slack consent.

The request uses the event's request-scoped `action_token`. Only a derived
summary and source permalinks enter the Eve conversation. Raw search results and
the token are discarded, and retrieved Slack context is not proof for a public
documentation claim.

See Slack's [Real-time Search API guide](https://docs.slack.dev/apis/web-api/real-time-search-api/)
for current distribution, consent, and scope requirements.

## Linear

Linear uses Eve's Agent Session channel. Set `DOCS_AGENT_LINEAR_CONNECTOR`, or
use the default `linear/docs-agent`, and attach the connector trigger to:

```text
/eve/v1/linear
```

The provider app needs `app:assignable` and `app:mentionable`, and its webhook
categories must include `AgentSessionEvent`. Paige handles `created` and
`prompted` Agent Session events. The channel continues the same Eve session and
uses native Linear Agent Activities for progress and responses; it does not
crawl or edit Linear issues merely because a session was delegated.

## Install And Verify

Follow the exact CLI or browser actions shown on the Status page. The supported
flow creates a Vercel Connect client, completes provider installation, and
attaches its trigger to the route above. Then send a real Slack mention or
delegate a real Linear Agent Session and recheck Status.

The complete manual procedure lives in
[Connector Installation Handoffs](./internal/USER_TESTING.md#connector-installation-handoffs).
See [Paige Identity](./IDENTITY.md) for the Slack display name and avatar.

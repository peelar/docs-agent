import { connectSlackCredentials } from "@vercel/connect/eve";
import {
  DEFAULT_SLACK_CONNECTOR,
  resolveSlackConnector,
  SLACK_CONNECTOR_ENV,
} from "@docs-agent/control-plane/provider-config";
import { slackChannel } from "eve/channels/slack";

export { DEFAULT_SLACK_CONNECTOR, SLACK_CONNECTOR_ENV };

const slackConnector = resolveSlackConnector();

export default slackChannel({
  credentials: connectSlackCredentials(slackConnector),
  threadContext: { since: "last-agent-reply" },
});

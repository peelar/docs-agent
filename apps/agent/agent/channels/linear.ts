import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  DEFAULT_LINEAR_CONNECTOR,
  resolveLinearConnector,
  LINEAR_CONNECTOR_ENV,
} from "@docs-agent/control-plane/provider-config";
import { linearChannel } from "eve/channels/linear";

export { DEFAULT_LINEAR_CONNECTOR, LINEAR_CONNECTOR_ENV };

const linearConnector = resolveLinearConnector();

export default linearChannel({
  credentials: connectLinearCredentials(linearConnector),
});

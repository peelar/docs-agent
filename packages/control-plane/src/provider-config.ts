export const SLACK_CONNECTOR_ENV = "DOCS_AGENT_SLACK_CONNECTOR";
export const DEFAULT_SLACK_CONNECTOR = "slack/docs-agent";
export const LINEAR_CONNECTOR_ENV = "DOCS_AGENT_LINEAR_CONNECTOR";
export const DEFAULT_LINEAR_CONNECTOR = "linear/docs-agent";
export const EVE_RUNTIME_URL_ENV = "DOCS_AGENT_EVE_URL";
export const DEFAULT_EVE_RUNTIME_URL = "http://127.0.0.1:2000";

export function resolveSlackConnector(env: NodeJS.ProcessEnv = process.env): string {
  return env[SLACK_CONNECTOR_ENV]?.trim() || DEFAULT_SLACK_CONNECTOR;
}

export function resolveLinearConnector(env: NodeJS.ProcessEnv = process.env): string {
  return env[LINEAR_CONNECTOR_ENV]?.trim() || DEFAULT_LINEAR_CONNECTOR;
}

export function resolveEveRuntimeUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env[EVE_RUNTIME_URL_ENV]?.trim() || DEFAULT_EVE_RUNTIME_URL;
}

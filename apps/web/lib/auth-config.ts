export const OPERATOR_ACCESS_ENV = "DOCS_AGENT_OPERATOR_ACCESS";
export const OPERATOR_ALLOWLIST_ENV = "DOCS_AGENT_APPROVED_GITHUB_LOGINS";
export const AUTH_TEST_MODE_ENV = "DOCS_AGENT_AUTH_TEST_MODE";

const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/u;
const REQUIRED_GITHUB_AUTH_KEYS = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  OPERATOR_ALLOWLIST_ENV,
] as const;

export type OperatorAccessMode = "local" | "github" | "test" | "unavailable";
type Environment = Readonly<Record<string, string | undefined>>;

export type GitHubAuthConfiguration = {
  secret: string;
  baseURL: string;
  clientId: string;
  clientSecret: string;
  approvedLogins: ReadonlySet<string>;
};

export class OperatorAuthConfigurationError extends Error {
  readonly code = "operator_auth_not_configured";
  readonly missingKeys: readonly string[];

  constructor(missingKeys: readonly string[]) {
    super(
      missingKeys.length > 0
        ? `Operator authentication is unavailable. Configure: ${missingKeys.join(", ")}.`
        : "Operator authentication configuration is invalid.",
    );
    this.name = "OperatorAuthConfigurationError";
    this.missingKeys = missingKeys;
  }
}

export function operatorAccessMode(
  env: Environment = process.env,
): OperatorAccessMode {
  const requested = env[OPERATOR_ACCESS_ENV]?.trim().toLowerCase();
  const production = env.VERCEL_ENV === "production";

  if (requested === "test") {
    return env[AUTH_TEST_MODE_ENV] === "1" && !production
      ? "test"
      : "unavailable";
  }
  if (requested === "github") return "github";
  if (requested === "local") return production ? "unavailable" : "local";
  return "unavailable";
}

export function readGitHubAuthConfiguration(
  env: Environment = process.env,
): GitHubAuthConfiguration {
  const missing = REQUIRED_GITHUB_AUTH_KEYS.filter(
    (key) => !env[key]?.trim(),
  );
  if (missing.length > 0) throw new OperatorAuthConfigurationError(missing);

  const secret = env.BETTER_AUTH_SECRET!.trim();
  const baseURL = env.BETTER_AUTH_URL!.trim();
  const approvedLogins = parseApprovedGitHubLogins(
    env[OPERATOR_ALLOWLIST_ENV]!,
  );
  if (secret.length < 32) {
    throw new OperatorAuthConfigurationError(["BETTER_AUTH_SECRET (minimum 32 characters)"]);
  }
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new OperatorAuthConfigurationError(["BETTER_AUTH_URL (absolute URL)"]);
  }
  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    throw new OperatorAuthConfigurationError(["BETTER_AUTH_URL (HTTPS required)"]);
  }
  if (approvedLogins.size === 0) {
    throw new OperatorAuthConfigurationError([OPERATOR_ALLOWLIST_ENV]);
  }

  return {
    secret,
    baseURL: url.origin,
    clientId: env.GITHUB_CLIENT_ID!.trim(),
    clientSecret: env.GITHUB_CLIENT_SECRET!.trim(),
    approvedLogins,
  };
}

export function parseApprovedGitHubLogins(value: string): ReadonlySet<string> {
  const logins = value
    .split(",")
    .map(normalizeGitHubLogin)
    .filter((login) => login.length > 0);
  if (logins.some((login) => !GITHUB_LOGIN_PATTERN.test(login))) {
    throw new OperatorAuthConfigurationError([
      `${OPERATOR_ALLOWLIST_ENV} (invalid GitHub login)`,
    ]);
  }
  return new Set(logins);
}

export function normalizeGitHubLogin(value: string): string {
  return value.trim().toLowerCase();
}

export function isApprovedGitHubLogin(
  login: string,
  approvedLogins: ReadonlySet<string>,
): boolean {
  return approvedLogins.has(normalizeGitHubLogin(login));
}

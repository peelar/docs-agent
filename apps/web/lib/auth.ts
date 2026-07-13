import "server-only";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import {
  operatorAccessMode,
  readGitHubAuthConfiguration,
  type GitHubAuthConfiguration,
} from "./auth-config";
import {
  createGitHubProfileMapper,
  IMMUTABLE_OPERATOR_IDENTITY_PATHS,
  OPERATOR_SESSION_SECONDS,
  PRODUCTION_AUTH_COOKIE_ATTRIBUTES,
} from "./auth-policy";

let productionAuth: ReturnType<typeof betterAuth> | undefined;

export async function getOperatorAuth() {
  const mode = operatorAccessMode();
  if (mode === "test") {
    const { testOperatorAuth } = await import("./auth.test");
    return testOperatorAuth;
  }
  if (mode !== "github") {
    throw new Error("GitHub operator authentication is not active.");
  }
  productionAuth ??= betterAuth(buildGitHubAuthOptions(
    readGitHubAuthConfiguration(),
    { secureCookies: true },
  ));
  return productionAuth;
}

export function buildGitHubAuthOptions(
  configuration: GitHubAuthConfiguration,
  overrides: Pick<BetterAuthOptions, "database" | "plugins"> & {
    secureCookies: boolean;
  } = { secureCookies: true },
): BetterAuthOptions {
  const plugins = [...(overrides.plugins ?? []), nextCookies()];
  return {
    ...(overrides.database ? { database: overrides.database } : {}),
    appName: "Paige",
    baseURL: configuration.baseURL,
    secret: configuration.secret,
    trustedOrigins: [configuration.baseURL],
    advanced: {
      cookiePrefix: "docs-agent",
      useSecureCookies: overrides.secureCookies,
      defaultCookieAttributes: {
        ...PRODUCTION_AUTH_COOKIE_ATTRIBUTES,
        secure: overrides.secureCookies,
      },
    },
    account: {
      storeStateStrategy: "cookie",
      storeAccountCookie: true,
      accountLinking: { disableImplicitLinking: true },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (IMMUTABLE_OPERATOR_IDENTITY_PATHS.has(context.path)) {
          throw new APIError("FORBIDDEN", {
            message: "Operator identity is managed by GitHub.",
          });
        }
      }),
    },
    onAPIError: {
      errorURL: `${configuration.baseURL}/forbidden`,
    },
    plugins,
    session: {
      expiresIn: OPERATOR_SESSION_SECONDS,
      updateAge: 0,
      cookieCache: {
        enabled: true,
        maxAge: OPERATOR_SESSION_SECONDS,
        strategy: "jwt",
        refreshCache: false,
      },
    },
    socialProviders: {
      github: {
        clientId: configuration.clientId,
        clientSecret: configuration.clientSecret,
        mapProfileToUser: createGitHubProfileMapper(configuration.approvedLogins),
      },
    },
    user: {
      additionalFields: {
        githubLogin: {
          type: "string",
          required: true,
          input: true,
        },
      },
    },
  };
}

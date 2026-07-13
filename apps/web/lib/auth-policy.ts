import { APIError } from "better-auth/api";

import {
  isApprovedGitHubLogin,
  normalizeGitHubLogin,
} from "./auth-config";

export const OPERATOR_SESSION_SECONDS = 8 * 60 * 60;

export const IMMUTABLE_OPERATOR_IDENTITY_PATHS = new Set([
  "/update-user",
  "/delete-user",
  "/link-social",
  "/unlink-account",
]);

export const PRODUCTION_AUTH_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
};

export function createGitHubProfileMapper(
  approvedLogins: ReadonlySet<string>,
): (profile: { id: string; login: string; name?: string | null }) => {
  githubLogin: string;
  name: string;
} {
  return (profile) => {
    const githubLogin = normalizeGitHubLogin(profile.login);
    if (!isApprovedGitHubLogin(githubLogin, approvedLogins)) {
      throw new APIError("FORBIDDEN", {
        message: "This GitHub account is not approved for Paige.",
      });
    }
    return {
      githubLogin,
      name: profile.name?.trim() || githubLogin,
    };
  };
}

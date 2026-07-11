import { expect, test } from "@playwright/test";

import {
  AUTH_TEST_MODE_ENV,
  OperatorAuthConfigurationError,
  OPERATOR_ACCESS_ENV,
  OPERATOR_ALLOWLIST_ENV,
  isApprovedGitHubLogin,
  operatorAccessMode,
  parseApprovedGitHubLogins,
  readGitHubAuthConfiguration,
} from "../lib/auth-config";
import {
  createGitHubProfileMapper,
  IMMUTABLE_OPERATOR_IDENTITY_PATHS,
  OPERATOR_SESSION_SECONDS,
  PRODUCTION_AUTH_COOKIE_ATTRIBUTES,
} from "../lib/auth-policy";

test("operator access modes fail closed", () => {
  expect(operatorAccessMode({})).toBe("unavailable");
  expect(operatorAccessMode({ [OPERATOR_ACCESS_ENV]: "github" })).toBe("github");
  expect(operatorAccessMode({ [OPERATOR_ACCESS_ENV]: "local" })).toBe("local");
  expect(operatorAccessMode({
    [OPERATOR_ACCESS_ENV]: "local",
    VERCEL_ENV: "production",
  })).toBe("unavailable");
  expect(operatorAccessMode({
    [OPERATOR_ACCESS_ENV]: "test",
    [AUTH_TEST_MODE_ENV]: "1",
  })).toBe("test");
  expect(operatorAccessMode({
    [OPERATOR_ACCESS_ENV]: "test",
    [AUTH_TEST_MODE_ENV]: "1",
    VERCEL_ENV: "production",
  })).toBe("unavailable");
});

test("GitHub auth configuration reports keys without leaking values", () => {
  const secret = "not-long-enough";
  expect(() => readGitHubAuthConfiguration({
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: "https://operator.example.com",
    GITHUB_CLIENT_ID: "client-id-value",
    GITHUB_CLIENT_SECRET: "client-secret-value",
    [OPERATOR_ALLOWLIST_ENV]: "approved-operator",
  })).toThrow(OperatorAuthConfigurationError);

  try {
    readGitHubAuthConfiguration({ BETTER_AUTH_SECRET: secret });
    throw new Error("Expected configuration parsing to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(OperatorAuthConfigurationError);
    const message = (error as Error).message;
    expect(message).toContain("BETTER_AUTH_URL");
    expect(message).toContain("GITHUB_CLIENT_SECRET");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("client-secret-value");
  }
});

test("GitHub login approval is normalized and enforced at the callback", () => {
  const approved = parseApprovedGitHubLogins(" AdrianPilarczyk,docs-bot ");
  expect([...approved]).toEqual(["adrianpilarczyk", "docs-bot"]);
  expect(isApprovedGitHubLogin("ADRIANPILARCZYK", approved)).toBe(true);
  expect(() => parseApprovedGitHubLogins("not_valid"))
    .toThrow(OperatorAuthConfigurationError);

  const mapProfile = createGitHubProfileMapper(approved);
  expect(mapProfile({ id: "42", login: "DOCS-BOT", name: " Docs Bot " }))
    .toEqual({ githubLogin: "docs-bot", name: "Docs Bot" });
  expect(() => mapProfile({ id: "43", login: "intruder" })).toThrow(
    "not approved",
  );
});

test("sessions, cookies, and identity mutation follow the protected contract", () => {
  expect(OPERATOR_SESSION_SECONDS).toBe(8 * 60 * 60);
  expect(PRODUCTION_AUTH_COOKIE_ATTRIBUTES).toEqual({
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  expect(IMMUTABLE_OPERATOR_IDENTITY_PATHS).toEqual(new Set([
    "/update-user",
    "/delete-user",
    "/link-social",
    "/unlink-account",
  ]));
});

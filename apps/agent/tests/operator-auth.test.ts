import { afterEach, describe, expect, it } from "vitest";

import { operatorWebAuth } from "../repositories/configuration/operator-auth";

const originalAccess = process.env.PAIGE_OPERATOR_ACCESS;
const originalWorkspaceId = process.env.PAIGE_OPERATOR_WORKSPACE_ID;

afterEach(() => {
  restoreEnvironment("PAIGE_OPERATOR_ACCESS", originalAccess);
  restoreEnvironment("PAIGE_OPERATOR_WORKSPACE_ID", originalWorkspaceId);
});

describe("operatorWebAuth", () => {
  it("ignores requests without an operator workspace header", () => {
    expect(
      operatorWebAuth()(new Request("http://agent.paige.localhost")),
    ).toBeNull();
  });

  it("returns the configured workspace identity for local operator requests", () => {
    process.env.PAIGE_OPERATOR_ACCESS = "local";
    process.env.PAIGE_OPERATOR_WORKSPACE_ID = "T_LOCAL";

    expect(operatorWebAuth()(operatorRequest("T_LOCAL"))).toEqual({
      authenticator: "slack",
      principalType: "user",
      principalId: "operator:T_LOCAL",
      attributes: { slackWorkspaceId: "T_LOCAL" },
    });
  });

  it("rejects mismatched or non-local operator requests", () => {
    process.env.PAIGE_OPERATOR_ACCESS = "local";
    process.env.PAIGE_OPERATOR_WORKSPACE_ID = "T_LOCAL";

    expect(() => operatorWebAuth()(operatorRequest("T_OTHER"))).toThrow(
      "Invalid Paige operator authentication.",
    );
    expect(() =>
      operatorWebAuth()(operatorRequest("T_LOCAL", "https://agent.example.com"))
    ).toThrow("Invalid Paige operator authentication.");
  });
});

function operatorRequest(
  workspaceId: string,
  url = "http://agent.paige.localhost",
): Request {
  return new Request(url, {
    headers: { "x-paige-operator-workspace": workspaceId },
  });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

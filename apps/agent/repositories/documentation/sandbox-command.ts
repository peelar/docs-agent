import type { SandboxCommandResult } from "eve/sandbox";
import { err, ok } from "neverthrow";

import type { RepositoryResult } from "@paige/repositories/errors";
import { RepositoryError } from "@paige/repositories/errors";

export function successfulCommand(
  result: SandboxCommandResult,
  message: string,
): RepositoryResult<void> {
  if (result.exitCode !== 0) {
    return err(new RepositoryError(
      "REPOSITORY_SANDBOX_FAILED",
      `${message}: ${summarizeCommandFailure(result)}`,
    ));
  }
  return ok(undefined);
}

export function summarizeCommandFailure(
  result: SandboxCommandResult,
): string {
  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    `command exited with ${result.exitCode}`
  ).slice(0, 1_000);
}

export function parseNullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

export function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

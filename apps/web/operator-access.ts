export interface OperatorAccessFailure {
  error: string;
  status: number;
}

export type OperatorAccessResult =
  | { allowed: true }
  | OperatorAccessFailure;

export function assertLocalOperatorAccess(): void {
  if (process.env.PAIGE_OPERATOR_ACCESS !== "local") {
    throw new Error("The Paige operator app is available only in local mode.");
  }
}

export function localOperatorAccess(request: Request): OperatorAccessResult {
  if (process.env.PAIGE_OPERATOR_ACCESS !== "local") {
    return {
      status: 403,
      error: "The Paige operator app is available only in local mode.",
    };
  }

  if (!isLocalHostname(new URL(request.url).hostname)) {
    return { status: 403, error: "The Paige operator app requires localhost." };
  }

  return { allowed: true };
}

export function isOperatorAccessFailure(
  result: OperatorAccessResult,
): result is OperatorAccessFailure {
  return "error" in result;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1";
}

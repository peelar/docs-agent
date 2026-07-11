import { NextResponse, type NextRequest } from "next/server";

import { operatorAccessMode } from "./lib/auth-config";
import { isLoopbackHostHeader } from "./lib/local-access";
import { resolveOperatorAccess } from "./lib/operator";

export async function proxy(request: NextRequest) {
  const mode = operatorAccessMode();
  if (mode === "local") {
    if (isLoopbackHostHeader(request.headers.get("host"))) {
      return NextResponse.next();
    }
    return jsonError(
      403,
      "local_access_only",
      "The local operator mode accepts only loopback requests.",
    );
  }

  if (mode === "unavailable") {
    return jsonError(
      503,
      "operator_auth_not_configured",
      "Operator authentication is not configured for this deployment.",
    );
  }

  if (isPublicPath(request.nextUrl.pathname, mode)) return NextResponse.next();

  const access = await resolveOperatorAccess(request.headers);
  if (access.status === "authorized") return NextResponse.next();
  if (access.status === "unauthorized") {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return jsonError(401, "operator_unauthorized", "Sign in is required.");
    }
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set(
      "returnTo",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(signIn);
  }
  if (access.status === "forbidden") {
    return jsonError(
      403,
      "operator_forbidden",
      "This GitHub account is not approved for the operator workspace.",
    );
  }
  return jsonError(503, "operator_auth_unavailable", access.message);
}

function isPublicPath(pathname: string, mode: "github" | "test"): boolean {
  return pathname === "/sign-in" ||
    pathname === "/forbidden" ||
    pathname.startsWith("/api/auth/") ||
    (mode === "test" && pathname === "/api/test-auth/session");
}

function jsonError(status: number, code: string, error: string): Response {
  return Response.json(
    { code, error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};

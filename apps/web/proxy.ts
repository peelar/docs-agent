import { NextResponse, type NextRequest } from "next/server";

import { isLoopbackHostHeader } from "./lib/local-access";

export function proxy(request: NextRequest) {
  if (isLoopbackHostHeader(request.headers.get("host"))) {
    return NextResponse.next();
  }

  return Response.json(
    {
      code: "local_access_only",
      error: "The operator app is available only on the local machine.",
    },
    {
      headers: { "cache-control": "no-store" },
      status: 403,
    },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};

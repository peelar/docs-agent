import { AUTH_TEST_MODE_ENV, operatorAccessMode } from "@/lib/auth-config";

export async function POST(request: Request): Promise<Response> {
  if (
    operatorAccessMode() !== "test" ||
    process.env[AUTH_TEST_MODE_ENV] !== "1"
  ) {
    return Response.json({ code: "not_found" }, { status: 404 });
  }

  const body = await request.json() as Partial<{
    githubId: string;
    githubLogin: string;
    displayName: string;
    expired: boolean;
  }>;
  if (!body.githubId || !body.githubLogin || !body.displayName) {
    return Response.json({ code: "invalid_test_session" }, { status: 400 });
  }

  const { createTestOperatorSession } = await import("@/lib/auth.test");
  const sessionHeaders = await createTestOperatorSession({
    githubId: body.githubId,
    githubLogin: body.githubLogin,
    displayName: body.displayName,
    expired: body.expired,
  });
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of sessionHeaders.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return Response.json({ ok: true }, { headers });
}

import { resolveOperatorAccess } from "@/lib/operator";

export async function GET(request: Request): Promise<Response> {
  const access = await resolveOperatorAccess(request.headers);
  if (access.status === "authorized") {
    return Response.json(
      { principal: access.principal },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const status = access.status === "unauthorized"
    ? 401
    : access.status === "forbidden"
      ? 403
      : 503;
  return Response.json(
    {
      code: `operator_${access.status}`,
      error: access.status === "unavailable"
        ? access.message
        : `Operator access is ${access.status}.`,
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

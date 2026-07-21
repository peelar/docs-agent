import {
  isOperatorAccessFailure,
  localOperatorAccess,
} from "@/operator-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export function GET(request: Request, context: RouteContext): Promise<Response> {
  return proxyToProductionAgent(request, context);
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return proxyToProductionAgent(request, context);
}

async function proxyToProductionAgent(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const access = localOperatorAccess(request);
  if (isOperatorAccessFailure(access)) {
    return errorResponse(access.status, access.error);
  }

  const configuration = productionAgentConfiguration();
  if (configuration instanceof Error) {
    return errorResponse(503, configuration.message);
  }

  const { path } = await context.params;
  const target = new URL(
    `/eve/${path.map(encodeURIComponent).join("/")}`,
    configuration.origin,
  );
  target.search = new URL(request.url).search;

  const headers = forwardedHeaders(request.headers);
  headers.set("authorization", `Bearer ${configuration.oidcToken}`);

  try {
    const body = request.method === "GET"
      ? undefined
      : await request.arrayBuffer();
    const response = await fetch(target, {
      body,
      cache: "no-store",
      headers,
      method: request.method,
      redirect: "manual",
      signal: request.signal,
    });
    return new Response(response.body, {
      headers: responseHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return errorResponse(499, "The request to Paige was cancelled.");
    }
    console.error("Production Paige request failed.", error);
    return errorResponse(502, "The production Paige agent could not be reached.");
  }
}

function productionAgentConfiguration():
  | { origin: URL; oidcToken: string }
  | Error {
  const configuredOrigin = process.env.PAIGE_PRODUCTION_AGENT_URL?.trim();
  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!configuredOrigin || !oidcToken) {
    return new Error("The production Paige agent is not configured.");
  }

  try {
    const origin = new URL(configuredOrigin);
    if (origin.protocol !== "https:" || origin.pathname !== "/") {
      return new Error("The production Paige agent URL is invalid.");
    }
    return { origin, oidcToken };
  } catch {
    return new Error("The production Paige agent URL is invalid.");
  }
}

function forwardedHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of [
    "accept-encoding",
    "authorization",
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "transfer-encoding",
    "x-paige-operator",
  ]) {
    headers.delete(name);
  }
  return headers;
}

function responseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of [
    "connection",
    "content-encoding",
    "content-length",
    "set-cookie",
    "transfer-encoding",
  ]) {
    headers.delete(name);
  }
  headers.set("cache-control", "no-store");
  return headers;
}

function errorResponse(status: number, error: string): Response {
  return Response.json(
    { error, ok: false },
    { status, headers: { "cache-control": "no-store" } },
  );
}

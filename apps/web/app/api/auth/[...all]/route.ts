import { toNextJsHandler } from "better-auth/next-js";

import { getOperatorAuth } from "@/lib/auth";

async function handle(request: Request): Promise<Response> {
  const auth = await getOperatorAuth();
  const handlers = toNextJsHandler(auth);
  return request.method === "GET"
    ? handlers.GET(request)
    : handlers.POST(request);
}

export const GET = handle;
export const POST = handle;

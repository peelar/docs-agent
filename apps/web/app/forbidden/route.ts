export function GET(): Response {
  return new Response(
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Access forbidden · Paige</title></head><body><main><h1>Access forbidden</h1><p>This GitHub account is not approved for the Paige operator workspace.</p><p><a href=\"/sign-in\">Return to sign in</a></p></main></body></html>",
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

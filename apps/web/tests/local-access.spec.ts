import { expect, test } from "@playwright/test";

import { isLoopbackHostHeader, isLoopbackHostname } from "../lib/local-access";

test("the local access policy accepts only loopback hostnames", () => {
  expect(isLoopbackHostname("localhost")).toBe(true);
  expect(isLoopbackHostname("docs.localhost")).toBe(true);
  expect(isLoopbackHostname("127.0.0.1")).toBe(true);
  expect(isLoopbackHostname("127.42.0.9")).toBe(true);
  expect(isLoopbackHostname("[::1]")).toBe(true);

  expect(isLoopbackHostname("operator.example.com")).toBe(false);
  expect(isLoopbackHostname("127.0.0.999")).toBe(false);
  expect(isLoopbackHostname("localhost.example.com")).toBe(false);

  expect(isLoopbackHostHeader("localhost:3100")).toBe(true);
  expect(isLoopbackHostHeader("[::1]:3100")).toBe(true);
  expect(isLoopbackHostHeader("operator.example.com:3100")).toBe(false);
  expect(isLoopbackHostHeader(null)).toBe(false);
});

test("the web server rejects a non-loopback host", async ({ request }) => {
  const response = await request.get("/status", {
    headers: { host: "operator.example.com" },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toContain("no-store");
  await expect(response.json()).resolves.toMatchObject({ code: "local_access_only" });
});

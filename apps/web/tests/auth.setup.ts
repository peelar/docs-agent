import { expect, test as setup } from "@playwright/test";

import { authState } from "../playwright.config";

setup("create an approved operator session", async ({ request }) => {
  const response = await request.post("/api/test-auth/session", {
    data: {
      githubId: "1001",
      githubLogin: "TestOperator",
      displayName: "Test Operator",
    },
  });

  expect(response.status()).toBe(200);
  await request.storageState({ path: authState });
});

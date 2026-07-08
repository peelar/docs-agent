import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import { GITHUB_SANDBOX_NETWORK_ALLOWLIST } from "./lib/repository-contract.js";

export default defineSandbox({
  backend: vercel({
    networkPolicy: {
      allow: [...GITHUB_SANDBOX_NETWORK_ALLOWLIST],
      subnets: {
        deny: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"],
      },
    },
  }),
});

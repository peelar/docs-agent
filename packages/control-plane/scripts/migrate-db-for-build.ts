import { migrateDocsAgentDatabase } from "../src/db/client.ts";

if (process.env.VERCEL === "1") {
  await migrateDocsAgentDatabase();
  console.log("Paige database migrations are up to date for deployment.");
} else {
  console.log("Skipping deployment database migration outside Vercel.");
}

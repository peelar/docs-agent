import { migrateDocsAgentDatabase } from "../src/db/client.ts";

await migrateDocsAgentDatabase();

console.log("Paige database migrations are up to date.");

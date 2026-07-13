import { migrateDocsAgentDatabase } from "../src/db/client.js";

await migrateDocsAgentDatabase();

console.log("Paige database migrations are up to date.");

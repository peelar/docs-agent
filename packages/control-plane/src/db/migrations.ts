import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readMigrationFiles,
  type MigrationMeta,
} from "drizzle-orm/migrator";

const MODULE_RELATIVE_MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export function docsAgentMigrationsFolder(): string {
  const candidates = [
    resolve(process.cwd(), "drizzle"),
    MODULE_RELATIVE_MIGRATIONS_FOLDER,
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }

  throw new Error(
    `Docs Agent Drizzle migrations were not found. Checked: ${candidates.join(", ")}.`,
  );
}

export function readDocsAgentMigrations(): MigrationMeta[] {
  return readMigrationFiles({ migrationsFolder: docsAgentMigrationsFolder() });
}

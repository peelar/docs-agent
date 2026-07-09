import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as dbSchema from "./schema.js";

export const DOCS_AGENT_DATABASE_URL_ENV = "DOCS_AGENT_DATABASE_URL";
export const DOCS_AGENT_DATABASE_AUTH_TOKEN_ENV = "DOCS_AGENT_DATABASE_AUTH_TOKEN";
export const DEFAULT_LOCAL_DATABASE_URL = "file:.docs-agent/docs-agent.sqlite";

const docsAgentMigrations = [
  {
    tag: "0000_illegal_the_twelve",
    createdAt: 1783631990960,
    statements: [
      `
CREATE TABLE IF NOT EXISTS \`workspace_setup\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`version\` integer NOT NULL,
  \`working_repository_input\` text,
  \`github_writeback\` text NOT NULL,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  \`updated_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
      `.trim(),
    ],
  },
] as const;

export type DocsAgentDatabase = LibSQLDatabase<typeof dbSchema>;

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

type DatabaseConfig = {
  url: string;
  authToken?: string;
  localFilePath?: string;
};

export function resolveDocsAgentDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const configuredUrl = env[DOCS_AGENT_DATABASE_URL_ENV]?.trim();
  const url = configuredUrl === "" || configuredUrl === undefined
    ? undefined
    : configuredUrl;

  if (url === undefined && isDeployedRuntime(env)) {
    throw new DatabaseConfigurationError(
      `${DOCS_AGENT_DATABASE_URL_ENV} is required for deployed Docs Agent setup persistence.`,
    );
  }

  const resolvedUrl = url ?? DEFAULT_LOCAL_DATABASE_URL;
  const authToken = env[DOCS_AGENT_DATABASE_AUTH_TOKEN_ENV]?.trim() || undefined;

  return {
    url: resolvedUrl,
    authToken,
    localFilePath: resolveLocalFilePath(resolvedUrl),
  };
}

export function docsAgentDatabaseLocation(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const config = resolveDocsAgentDatabaseConfig(env);
    return config.localFilePath === undefined
      ? DOCS_AGENT_DATABASE_URL_ENV
      : `file:${config.localFilePath}`;
  } catch {
    return DOCS_AGENT_DATABASE_URL_ENV;
  }
}

export async function migrateDocsAgentDatabase(): Promise<void> {
  const connection = await openDocsAgentDatabase();

  try {
    await applyDocsAgentMigrations(connection.db);
  } catch (error) {
    throw new Error(`Docs Agent database migration failed: ${formatUnknownError(error)}`);
  } finally {
    connection.client.close();
  }
}

export async function withDocsAgentDatabase<T>(
  fn: (db: DocsAgentDatabase) => Promise<T>,
): Promise<T> {
  const connection = await openDocsAgentDatabase();

  try {
    try {
      await applyDocsAgentMigrations(connection.db);
    } catch (error) {
      throw new Error(`Docs Agent database is unavailable: ${formatUnknownError(error)}`);
    }

    return await fn(connection.db);
  } finally {
    connection.client.close();
  }
}

async function openDocsAgentDatabase() {
  const config = resolveDocsAgentDatabaseConfig();

  if (config.localFilePath !== undefined) {
    await mkdir(dirname(config.localFilePath), { recursive: true });
  }

  const client = createClient({
    url: config.url,
    authToken: config.authToken,
  });

  return {
    client,
    db: drizzle(client, { schema: dbSchema }),
  };
}

async function applyDocsAgentMigrations(db: DocsAgentDatabase): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const dbMigrations = await db.values<[number, string, string | number]>(sql`
    SELECT id, hash, created_at
    FROM __drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const latestMigrationTime = Number(dbMigrations[0]?.[2] ?? 0);

  for (const migration of docsAgentMigrations) {
    if (latestMigrationTime >= migration.createdAt) continue;

    const migrationSql = migration.statements.join("\n--> statement-breakpoint\n");
    const hash = createHash("sha256").update(migrationSql).digest("hex");

    for (const statement of migration.statements) {
      await db.run(sql.raw(statement));
    }

    await db.run(sql`
      INSERT INTO __drizzle_migrations ("hash", "created_at")
      VALUES (${hash}, ${migration.createdAt})
    `);
  }
}

function isDeployedRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" || env.NODE_ENV === "production";
}

function resolveLocalFilePath(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined;

  if (url === "file::memory:") return undefined;

  try {
    return fileURLToPath(url);
  } catch {
    const rawPath = url.slice("file:".length);
    if (rawPath === "" || rawPath === ":memory:") return undefined;
    return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

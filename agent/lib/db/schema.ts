import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceSetup = sqliteTable("workspace_setup", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  workingRepositoryInput: text("working_repository_input", {
    mode: "json",
  }).$type<unknown>(),
  githubWriteback: text("github_writeback", { mode: "json" })
    .$type<unknown>()
    .notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const schema = {
  workspaceSetup,
};

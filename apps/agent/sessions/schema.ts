import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { AgentSessionSource, AgentSessionStatus } from "./types";

export const agentSessions = sqliteTable("agent_sessions", {
  sessionId: text("session_id").primaryKey(),
  source: text("source").$type<AgentSessionSource>(),
  title: text("title"),
  status: text("status").$type<AgentSessionStatus>().notNull(),
  startedAt: text("started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

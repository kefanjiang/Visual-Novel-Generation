import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  bigserial,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    title: text("title").notNull().default("未命名游戏"),
    genre: text("genre"),
    prompt: text("prompt").notNull(),
    currentVersionId: text("current_version_id"),
    isExample: boolean("is_example").notNull().default(false),
    forkedFrom: text("forked_from"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_owner_idx").on(t.owner)],
);

export type VersionSource = "generate" | "chat_edit" | "manual_edit" | "fix" | "restore" | "remix";

export const versions = pgTable(
  "versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    files: jsonb("files").$type<Record<string, string>>().notNull(),
    story: jsonb("story").notNull(),
    source: text("source").$type<VersionSource>().notNull(),
    summary: text("summary").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("versions_project_idx").on(t.projectId, t.n)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "agent" | "system">().notNull(),
    agent: text("agent"),
    content: text("content").notNull(),
    versionId: text("version_id"),
    runId: text("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_project_idx").on(t.projectId, t.createdAt)],
);

export type RunStatus = "running" | "done" | "failed";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"generate" | "edit">().notNull(),
    stage: text("stage").notNull(),
    status: text("status").$type<RunStatus>().notNull().default("running"),
    state: jsonb("state").notNull().default({}),
    error: text("error"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("runs_project_idx").on(t.projectId)],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("run_events_run_idx").on(t.runId, t.id)],
);

export const usage = pgTable(
  "usage",
  {
    ipHash: text("ip_hash").notNull(),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ipHash, t.day, t.kind] })],
);

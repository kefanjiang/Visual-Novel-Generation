import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { newId } from "@/lib/ids";
import type { Db } from "./types";
import { messages, projects, runEvents, runs, usage, versions, type VersionSource } from "./schema";

export type Project = typeof projects.$inferSelect;
export type Version = typeof versions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;

// ---------- projects ----------

export async function createProject(
  db: Db,
  input: { owner: string; prompt: string; title?: string; genre?: string; isExample?: boolean; forkedFrom?: string },
): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({
      id: newId("p"),
      owner: input.owner,
      prompt: input.prompt,
      title: input.title ?? "未命名游戏",
      genre: input.genre ?? null,
      isExample: input.isExample ?? false,
      forkedFrom: input.forkedFrom ?? null,
    })
    .returning();
  return row;
}

export async function getProject(db: Db, id: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row ?? null;
}

export async function updateProject(
  db: Db,
  id: string,
  patch: Partial<Pick<Project, "title" | "genre" | "currentVersionId" | "isExample">>,
): Promise<void> {
  await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id));
}

export async function listProjectsByOwner(db: Db, owner: string): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.owner, owner)).orderBy(desc(projects.updatedAt));
}

export async function listExamples(db: Db): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.isExample, true)).orderBy(asc(projects.createdAt));
}

// ---------- versions ----------

export async function addVersion(
  db: Db,
  input: {
    projectId: string;
    files: Record<string, string>;
    story: unknown;
    source: VersionSource;
    summary?: string;
  },
): Promise<Version> {
  const [{ maxN }] = await db
    .select({ maxN: sql<number>`coalesce(max(${versions.n}), 0)` })
    .from(versions)
    .where(eq(versions.projectId, input.projectId));
  const [row] = await db
    .insert(versions)
    .values({
      id: newId("v"),
      projectId: input.projectId,
      n: Number(maxN) + 1,
      files: input.files,
      story: input.story,
      source: input.source,
      summary: input.summary ?? "",
    })
    .returning();
  await updateProject(db, input.projectId, { currentVersionId: row.id });
  return row;
}

export async function getVersion(db: Db, id: string): Promise<Version | null> {
  const [row] = await db.select().from(versions).where(eq(versions.id, id));
  return row ?? null;
}

export async function listVersions(db: Db, projectId: string): Promise<Omit<Version, "files" | "story">[]> {
  return db
    .select({
      id: versions.id,
      projectId: versions.projectId,
      n: versions.n,
      source: versions.source,
      summary: versions.summary,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .where(eq(versions.projectId, projectId))
    .orderBy(desc(versions.n));
}

// ---------- messages ----------

export async function addMessage(
  db: Db,
  input: {
    projectId: string;
    role: Message["role"];
    content: string;
    agent?: string;
    versionId?: string;
    runId?: string;
  },
): Promise<Message> {
  const [row] = await db
    .insert(messages)
    .values({
      id: newId("m"),
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      agent: input.agent ?? null,
      versionId: input.versionId ?? null,
      runId: input.runId ?? null,
    })
    .returning();
  return row;
}

export async function listMessages(db: Db, projectId: string): Promise<Message[]> {
  return db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(asc(messages.createdAt));
}

// ---------- runs ----------

export async function createRun(
  db: Db,
  input: { projectId: string; kind: Run["kind"]; stage: string; state?: unknown },
): Promise<Run> {
  const [row] = await db
    .insert(runs)
    .values({
      id: newId("r"),
      projectId: input.projectId,
      kind: input.kind,
      stage: input.stage,
      state: input.state ?? {},
    })
    .returning();
  return row;
}

export async function getRun(db: Db, id: string): Promise<Run | null> {
  const [row] = await db.select().from(runs).where(eq(runs.id, id));
  return row ?? null;
}

export async function getActiveRun(db: Db, projectId: string): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.status, "running")))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return row ?? null;
}

export async function updateRun(
  db: Db,
  id: string,
  patch: Partial<Pick<Run, "stage" | "status" | "state" | "error" | "leaseUntil">>,
): Promise<void> {
  await db
    .update(runs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(runs.id, id));
}

/**
 * Atomically claim a running run for `ms` milliseconds.
 * Returns the claimed row, or null if another request holds an unexpired lease
 * (or the run is no longer running). A conditional UPDATE is enough: Postgres
 * serialises concurrent updates to the same row.
 */
export async function acquireLease(db: Db, runId: string, ms: number, now = new Date()): Promise<Run | null> {
  const until = new Date(now.getTime() + ms);
  const [row] = await db
    .update(runs)
    .set({ leaseUntil: until, updatedAt: now })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.status, "running"),
        or(isNull(runs.leaseUntil), lt(runs.leaseUntil, now)),
      ),
    )
    .returning();
  return row ?? null;
}

export async function releaseLease(db: Db, runId: string): Promise<void> {
  await db.update(runs).set({ leaseUntil: null }).where(eq(runs.id, runId));
}

// ---------- events ----------

export async function addEvent(
  db: Db,
  input: { runId: string; agent: string; type: string; payload?: unknown },
): Promise<RunEvent> {
  const [row] = await db
    .insert(runEvents)
    .values({ runId: input.runId, agent: input.agent, type: input.type, payload: input.payload ?? {} })
    .returning();
  return row;
}

export async function listEvents(db: Db, runId: string, afterId = 0): Promise<RunEvent[]> {
  return db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.id, afterId)))
    .orderBy(asc(runEvents.id));
}

// ---------- usage / rate limit ----------

/** Increment and return the new counter for (ipHash, day, kind). */
export async function incrementUsage(db: Db, ipHash: string, day: string, kind: string): Promise<number> {
  const [row] = await db
    .insert(usage)
    .values({ ipHash, day, kind, count: 1 })
    .onConflictDoUpdate({
      target: [usage.ipHash, usage.day, usage.kind],
      set: { count: sql`${usage.count} + 1` },
    })
    .returning();
  return row.count;
}

export async function getUsage(db: Db, ipHash: string, day: string, kind: string): Promise<number> {
  const [row] = await db
    .select()
    .from(usage)
    .where(and(eq(usage.ipHash, ipHash), eq(usage.day, day), eq(usage.kind, kind)));
  return row?.count ?? 0;
}

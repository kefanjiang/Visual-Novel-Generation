import {
  getActiveRun,
  getProject,
  getRun,
  getVersion,
  listEvents,
  listExamples,
  listMessages,
  listProjectsByOwner,
  listVersions,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { advanceRun, retryRun, type Deps } from "@/lib/pipeline/runner";
import { startGeneration } from "@/lib/pipeline/start";
import { checkAndCount, type Limits } from "@/lib/ratelimit";

/** Framework-free handlers; route files only adapt Request/Response, cookies and env. */

export type Result<T> = { status: number; body: T | { error: string } };

const ok = <T>(body: T, status = 200): Result<T> => ({ status, body });
const fail = (status: number, error: string): Result<never> => ({ status, body: { error } });

export async function createProjectHandler(
  db: Db,
  input: { owner: string; ipHash: string; prompt: unknown },
  limits: Limits,
) {
  if (typeof input.prompt !== "string" || !input.prompt.trim()) return fail(400, "请描述你想要的剧情游戏");
  const limit = await checkAndCount(db, input.ipHash, "generate", limits);
  if (!limit.ok) return fail(429, limit.message);
  const { project, run } = await startGeneration(db, { owner: input.owner, prompt: input.prompt });
  return ok({ projectId: project.id, runId: run.id, remaining: limit.remaining }, 201);
}

export async function listProjectsHandler(db: Db, owner: string) {
  const [mine, examples] = await Promise.all([listProjectsByOwner(db, owner), listExamples(db)]);
  const pick = (p: (typeof mine)[number]) => ({ id: p.id, title: p.title, genre: p.genre, prompt: p.prompt, updatedAt: p.updatedAt });
  return ok({ mine: mine.map(pick), examples: examples.map(pick) });
}

export async function getProjectHandler(db: Db, id: string, owner: string) {
  const project = await getProject(db, id);
  if (!project) return fail(404, "项目不存在");
  const [messages, versions, current, activeRun] = await Promise.all([
    listMessages(db, id),
    listVersions(db, id),
    project.currentVersionId ? getVersion(db, project.currentVersionId) : null,
    getActiveRun(db, id),
  ]);
  const lastRunId = messages.map((m) => m.runId).filter(Boolean).at(-1) ?? null;
  const latestRun = activeRun ?? (lastRunId ? await getRun(db, lastRunId) : null);
  return ok({
    project: {
      id: project.id,
      title: project.title,
      genre: project.genre,
      prompt: project.prompt,
      isExample: project.isExample,
      forkedFrom: project.forkedFrom,
      currentVersionId: project.currentVersionId,
      isOwner: project.owner === owner,
    },
    messages,
    versions,
    currentVersion: current,
    run: latestRun ? { id: latestRun.id, kind: latestRun.kind, stage: latestRun.stage, status: latestRun.status, error: latestRun.error } : null,
  });
}

export async function getVersionHandler(db: Db, id: string) {
  const v = await getVersion(db, id);
  return v ? ok(v) : fail(404, "版本不存在");
}

export async function advanceHandler(db: Db, runId: string, owner: string, deps: Deps) {
  const run = await getRun(db, runId);
  if (!run) return fail(404, "任务不存在");
  const project = await getProject(db, run.projectId);
  if (!project || project.owner !== owner) return fail(403, "只能推进自己的项目");
  return ok(await advanceRun(db, runId, deps));
}

export async function retryHandler(db: Db, runId: string, owner: string) {
  const run = await getRun(db, runId);
  if (!run) return fail(404, "任务不存在");
  const project = await getProject(db, run.projectId);
  if (!project || project.owner !== owner) return fail(403, "只能重试自己的项目");
  return (await retryRun(db, runId)) ? ok({ ok: true }) : fail(409, "这个任务不在失败状态");
}

export async function eventsHandler(db: Db, runId: string, after: number) {
  const run = await getRun(db, runId);
  if (!run) return fail(404, "任务不存在");
  const events = await listEvents(db, runId, Number.isFinite(after) ? after : 0);
  return ok({ run: { id: run.id, stage: run.stage, status: run.status, error: run.error }, events });
}

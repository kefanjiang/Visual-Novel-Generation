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
  updateProject,
} from "@/lib/db/repo";
import { deleteProject, EditError, remixProject, restoreVersion, saveManualEdit, startEdit } from "@/lib/pipeline/edit";
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
  const pick = (p: (typeof mine)[number]) => ({
    id: p.id,
    title: p.title,
    genre: p.genre,
    prompt: p.prompt,
    updatedAt: p.updatedAt,
    isExample: p.isExample,
    forkedFrom: p.forkedFrom,
  });
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

// ---------------- step 6: edits, versions, remix ----------------


async function guard<T>(fn: () => Promise<T>, status = 200): Promise<Result<T>> {
  try {
    return ok(await fn(), status);
  } catch (e) {
    if (e instanceof EditError) return fail(e.status, e.message);
    throw e;
  }
}

export async function postMessageHandler(
  db: Db,
  input: { projectId: string; owner: string; ipHash: string; text: unknown },
  limits: Limits,
) {
  if (typeof input.text !== "string" || !input.text.trim()) return fail(400, "消息不能为空");
  const project = await getProject(db, input.projectId);
  if (!project) return fail(404, "项目不存在");
  if (project.owner !== input.owner) return fail(403, "只能修改自己的项目，可以先 Remix 一份");
  const limit = await checkAndCount(db, input.ipHash, "edit", limits);
  if (!limit.ok) return fail(429, limit.message);
  return guard(async () => {
    const { run, mention } = await startEdit(db, { projectId: input.projectId, owner: input.owner, text: input.text as string });
    return { runId: run.id, mention, remaining: limit.remaining };
  }, 201);
}

export async function restoreHandler(db: Db, input: { projectId: string; owner: string; versionId: unknown }) {
  if (typeof input.versionId !== "string") return fail(400, "缺少版本");
  return guard(async () => {
    const v = await restoreVersion(db, { projectId: input.projectId, owner: input.owner, versionId: input.versionId as string });
    return { versionId: v.id, n: v.n };
  });
}

export async function saveVersionHandler(
  db: Db,
  input: { projectId: string; owner: string; files: unknown },
  compile?: (files: Record<string, string>) => Promise<{ ok: boolean; errors: string[] }>,
) {
  const files = input.files as Record<string, unknown> | null;
  if (!files || typeof files !== "object" || Object.values(files).some((v) => typeof v !== "string")) return fail(400, "文件格式不对");
  if (JSON.stringify(files).length > 300_000) return fail(413, "文件太大");
  return guard(async () => {
    const v = await saveManualEdit(db, { projectId: input.projectId, owner: input.owner, files: files as Record<string, string> }, compile);
    return { versionId: v.id, n: v.n };
  }, 201);
}

export async function deleteProjectHandler(db: Db, input: { projectId: string; owner: string }) {
  return guard(async () => {
    await deleteProject(db, input);
    return { ok: true };
  });
}

export async function remixHandler(db: Db, input: { projectId: string; owner: string }) {
  return guard(async () => {
    const p = await remixProject(db, input);
    return { projectId: p.id };
  }, 201);
}

/** Mark/unmark a project as a homepage example (protected by ADMIN_TOKEN). */
export async function setExampleHandler(db: Db, input: { projectId: string; token: string | null; isExample: boolean }, adminToken: string | undefined) {
  if (!adminToken || input.token !== adminToken) return fail(401, "unauthorized");
  const project = await getProject(db, input.projectId);
  if (!project) return fail(404, "项目不存在");
  await updateProject(db, project.id, { isExample: input.isExample });
  return ok({ ok: true });
}

/** Public data for the share page: only the current version's files and title. */
export async function playHandler(db: Db, projectId: string) {
  const project = await getProject(db, projectId);
  if (!project?.currentVersionId) return fail(404, "游戏不存在或还没生成好");
  const v = await getVersion(db, project.currentVersionId);
  if (!v) return fail(404, "版本不存在");
  return ok({ title: project.title, genre: project.genre, n: v.n, files: v.files });
}

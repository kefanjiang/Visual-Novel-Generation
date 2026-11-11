import {
  addMessage,
  addVersion,
  createProject,
  createRun,
  getActiveRun,
  getProject,
  getVersion,
  type Project,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { TEAM, type AgentKey } from "@/lib/agents/team";
import { parseMention } from "@/lib/client/timeline";
import { Story } from "@/lib/story/schema";
import { defaultOwners, specFromStory, storyToSkeleton, writtenFromStory } from "@/lib/story/skeleton";
import { validateStory } from "@/lib/story/validate";
import { HUD_PATH, README_PATH, STORY_PATH, THEME_PATH } from "@/lib/template/assemble";
import { TEMPLATE_FILES } from "@/lib/template/generated";
import { initialState, type RunState } from "./runner";
import { MAX_PROMPT_LENGTH } from "./start";

export class EditError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Names, titles and roles users may type after @. */
export const MENTION_ALIASES: Record<string, string> = (() => {
  const out: Record<string, string> = { 编剧: "writer_a", 架构师: "architect", 工程师: "engineer", 审校: "reviewer", 制作人: "producer" };
  for (const p of Object.values(TEAM)) {
    out[p.name] = p.key;
    out[p.name.toLowerCase()] = p.key;
    out[p.title] = p.key;
  }
  return out;
})();

async function ownedProjectWithVersion(db: Db, projectId: string, owner: string) {
  const project = await getProject(db, projectId);
  if (!project) throw new EditError(404, "项目不存在");
  if (project.owner !== owner) throw new EditError(403, "只能修改自己的项目，可以先 Remix 一份");
  if (!project.currentVersionId) throw new EditError(409, "还没有生成好的版本");
  if (await getActiveRun(db, projectId)) throw new EditError(409, "团队还在处理上一条需求，请稍候");
  const version = await getVersion(db, project.currentVersionId);
  if (!version) throw new EditError(409, "当前版本丢失");
  return { project, version };
}

/** A follow-up chat message on an existing game → an edit run. */
export async function startEdit(db: Db, input: { projectId: string; owner: string; text: string }) {
  const text = input.text.trim().slice(0, MAX_PROMPT_LENGTH);
  if (!text) throw new EditError(400, "消息不能为空");
  const { project, version } = await ownedProjectWithVersion(db, input.projectId, input.owner);
  const story = Story.parse(version.story);
  const { agent } = parseMention(text, MENTION_ALIASES);
  const mention = agent && agent !== "producer" && agent !== "cast" ? (agent as AgentKey) : null;

  const owners = defaultOwners(story);
  const state: RunState = {
    ...initialState(text),
    mode: "edit",
    mention,
    spec: specFromStory(story),
    cast: story.characters,
    skeleton: storyToSkeleton(story, owners),
    written: writtenFromStory(story),
    story,
    engineer: {
      themeCss: version.files[THEME_PATH] ?? TEMPLATE_FILES[THEME_PATH],
      hudJs: version.files[HUD_PATH] ?? TEMPLATE_FILES[HUD_PATH],
      readme: version.files[README_PATH] ?? "",
    },
  };
  await addMessage(db, { projectId: project.id, role: "user", content: text });
  const run = await createRun(db, { projectId: project.id, kind: "edit", stage: "route", state });
  return { run, mention };
}

/** Restore an old version by saving it again as the newest version. */
export async function restoreVersion(db: Db, input: { projectId: string; owner: string; versionId: string }) {
  const { project } = await ownedProjectWithVersion(db, input.projectId, input.owner);
  const old = await getVersion(db, input.versionId);
  if (!old || old.projectId !== project.id) throw new EditError(404, "版本不存在");
  const v = await addVersion(db, { projectId: project.id, files: old.files, story: old.story, source: "restore", summary: `恢复到 v${old.n}` });
  await addMessage(db, { projectId: project.id, role: "agent", agent: "system", content: `已恢复到 v${old.n}，保存为 v${v.n}。`, versionId: v.id });
  return v;
}

/** Hand-edited code from the code tab → a new version, if the story is still valid. */
export async function saveManualEdit(
  db: Db,
  input: { projectId: string; owner: string; files: Record<string, string> },
  compile?: (files: Record<string, string>) => Promise<{ ok: boolean; errors: string[] }>,
) {
  const { project, version } = await ownedProjectWithVersion(db, input.projectId, input.owner);
  const files = { ...version.files, ...input.files };
  let storyJson: unknown;
  try {
    storyJson = JSON.parse(files[STORY_PATH]);
  } catch {
    throw new EditError(400, "story.json 不是合法的 JSON");
  }
  const check = validateStory(storyJson);
  if (!check.ok) throw new EditError(400, `story.json 没有通过校验：${check.errors.slice(0, 3).map((e) => e.message).join("；")}`);
  if (compile) {
    const c = await compile(files);
    if (!c.ok) throw new EditError(400, `代码编译失败：${c.errors.slice(0, 2).join("；")}`);
  }
  const v = await addVersion(db, { projectId: project.id, files, story: check.story, source: "manual_edit", summary: "手动修改代码" });
  await addMessage(db, { projectId: project.id, role: "agent", agent: "system", content: `手动修改已通过校验，保存为 v${v.n}。`, versionId: v.id });
  return v;
}

/** Copy any project's current version into a new project owned by `owner`. */
export async function remixProject(db: Db, input: { projectId: string; owner: string }): Promise<Project> {
  const source = await getProject(db, input.projectId);
  if (!source?.currentVersionId) throw new EditError(404, "这个项目还没有可以 remix 的版本");
  const version = await getVersion(db, source.currentVersionId);
  if (!version) throw new EditError(404, "版本不存在");
  const copy = await createProject(db, {
    owner: input.owner,
    prompt: source.prompt,
    title: source.title,
    genre: source.genre ?? undefined,
    forkedFrom: source.id,
  });
  const v = await addVersion(db, { projectId: copy.id, files: version.files, story: version.story, source: "remix", summary: `Remix 自《${source.title}》` });
  await addMessage(db, {
    projectId: copy.id,
    role: "agent",
    agent: "producer",
    content: `这是《${source.title}》的副本，归你所有了。直接告诉我想怎么改，比如「加一个隐藏结局」。`,
    versionId: v.id,
  });
  return copy;
}

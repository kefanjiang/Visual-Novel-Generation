import {
  acquireLease,
  addEvent,
  addMessage,
  addVersion,
  getRun,
  releaseLease,
  updateProject,
  updateRun,
  type Run,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import {
  runArchitect,
  runCast,
  runEngineer,
  runProducer,
  runReviewer,
  runWriter,
} from "@/lib/agents/agents";
import type { Models } from "@/lib/agents/models";
import { TEAM, writerKey, type AgentKey } from "@/lib/agents/team";
import {
  Story,
  type Character,
  type EngineerOutput,
  type ReviewOutput,
  type Skeleton,
  type Spec,
  type WriterNode,
} from "@/lib/story/schema";
import { activeWriters, graphOf, mergeStory, ownersOf, skeletonToStory } from "@/lib/story/skeleton";
import { describeSimulation, simulate, type SimulationReport } from "@/lib/story/simulate";
import { groupByOwner, validateStory, type ValidationError } from "@/lib/story/validate";
import { assembleFiles, HUD_PATH, withDefaultHud } from "@/lib/template/assemble";

export const LEASE_MS = 240_000;
export const MAX_ARCH_ROUNDS = 3;
export const MAX_FIX_ROUNDS = 2;

export type Stage =
  | "plan"
  | "cast"
  | "skeleton"
  | "write"
  | "review"
  | "revise"
  | "validate"
  | "fix"
  | "assemble"
  | "done";

export interface RunState {
  prompt: string;
  spec?: Spec;
  cast?: Character[];
  skeleton?: Skeleton;
  skeletonDraft?: Skeleton;
  archRound: number;
  archFeedback?: string[];
  written: Record<string, WriterNode>;
  engineer?: EngineerOutput | null;
  review?: ReviewOutput["issues"];
  fixRound: number;
  pendingFixes?: Record<string, { ids: string[]; feedback: string[] }>;
  story?: Story;
  playtest?: SimulationReport;
  tokens: number;
  versionId?: string;
}

export function initialState(prompt: string): RunState {
  return { prompt, archRound: 0, written: {}, fixRound: 0, tokens: 0 };
}

export interface Deps {
  models: Models;
  /** Compile check for generated code; injectable so tests and environments without esbuild still work. */
  compile?: (files: Record<string, string>) => Promise<{ ok: boolean; errors: string[] }>;
}

export interface AdvanceResult {
  status: Run["status"] | "missing";
  stage: string;
  busy?: boolean;
  error?: string | null;
}

interface Ctx {
  db: Db;
  run: Run;
  state: RunState;
  deps: Deps;
  emit: (agent: AgentKey, type: string, payload?: unknown) => Promise<void>;
  say: (agent: AgentKey, content: string, versionId?: string) => Promise<void>;
}

type Handler = (ctx: Ctx) => Promise<Stage>;

const formatErrors = (errs: ValidationError[]) => errs.map((e) => (e.nodeId ? `[${e.nodeId}] ${e.message}` : e.message));

const HANDLERS: Record<Exclude<Stage, "done">, Handler> = {
  async plan({ state, deps, emit, say, db, run }) {
    await emit("producer", "started");
    const r = await runProducer(deps.models, state.prompt);
    state.tokens += r.tokens;
    state.spec = r.output;
    await updateProject(db, run.projectId, { title: r.output.title, genre: r.output.genre });
    await emit("producer", "done", { spec: r.output });
    await say(
      "producer",
      `${r.output.note}\n\n《${r.output.title}》· ${r.output.genre} · ${r.output.characterCount} 个角色 · ${r.output.endingCount} 个结局 · 约 ${r.output.nodeTarget} 个场景。先请 Leo 设计角色。`,
    );
    return "cast";
  },

  async cast({ state, deps, emit, say }) {
    const spec = state.spec!;
    await emit("cast", "started");
    const r = await runCast(deps.models, spec);
    state.tokens += r.tokens;
    state.cast = r.output.characters;
    spec.characterCount = state.cast.length; // trust the cast actually produced
    await emit("cast", "done", { characters: state.cast });
    await say("cast", `角色定好了：${state.cast.map((c) => `${c.avatar} ${c.name}（${c.role}）`).join("、")}。交给 Ada 搭骨架。`);
    return "skeleton";
  },

  async skeleton({ state, deps, emit, say }) {
    const spec = state.spec!;
    await emit("architect", "started", { round: state.archRound + 1 });
    const r = await runArchitect(deps.models, spec, state.cast!, state.archFeedback ?? [], state.archFeedback ? state.skeletonDraft : undefined);
    state.tokens += r.tokens;
    const check = validateStory(skeletonToStory(spec, state.cast!, r.output), { spec, owners: ownersOf(r.output) });
    if (!check.ok) {
      state.archRound += 1;
      state.skeletonDraft = r.output;
      state.archFeedback = formatErrors(check.errors);
      await emit("system", "validation", { target: "skeleton", errors: check.errors, round: state.archRound });
      if (state.archRound >= MAX_ARCH_ROUNDS) {
        throw new Error(`剧情骨架连续 ${MAX_ARCH_ROUNDS} 次没有通过结构校验：${state.archFeedback.slice(0, 3).join("；")}`);
      }
      await say("system", `骨架结构校验发现 ${check.errors.length} 个问题，已交还 Ada 修改：\n${state.archFeedback.slice(0, 5).map((f) => `· ${f}`).join("\n")}`);
      return "skeleton";
    }
    state.skeleton = r.output;
    state.archFeedback = undefined;
    state.skeletonDraft = undefined;
    await emit("architect", "done", { nodes: r.output.nodes.length });
    await emit("system", "graph", { ...graphOf(r.output), status: "outline" });
    const endings = r.output.nodes.filter((n) => n.type === "ending").length;
    const writers = r.output.writers.filter((w) => activeWriters(r.output).includes(w.id));
    await say(
      "architect",
      `骨架完成：${r.output.nodes.length - endings} 个场景、${endings} 个结局，结构校验通过。分给 ${writers.length} 位编剧并行写：\n${writers
        .map((w) => `· ${TEAM[writerKey(w.id)].title}：${w.focus}`)
        .join("\n")}\n同时请 Kai 做界面。`,
    );
    return "write";
  },

  async write(ctx) {
    const { state, deps, emit, say } = ctx;
    const skeleton = state.skeleton!;
    const writerIds = activeWriters(skeleton);
    const focusOf = Object.fromEntries(skeleton.writers.map((w) => [w.id, w.focus]));

    const writing = writerIds.map(async (id) => {
      const key = writerKey(id);
      await emit(key, "started");
      const r = await runWriter(deps.models, id, { spec: state.spec!, cast: state.cast!, skeleton, focus: focusOf[id] });
      const allowed = new Set(skeleton.nodes.filter((n) => n.owner === id).map((n) => n.id));
      const accepted = r.output.nodes.filter((n) => allowed.has(n.id));
      for (const n of accepted) state.written[n.id] = n;
      state.tokens += r.tokens;
      await emit(key, "done", { nodes: accepted.map((n) => n.id) });
      await emit("system", "graph_status", { ids: accepted.map((n) => n.id), status: "written" });
      return accepted.length;
    });
    const engineering = (async () => {
      await emit("engineer", "started");
      try {
        const r = await runEngineer(deps.models, state.spec!, state.cast!);
        state.tokens += r.tokens;
        state.engineer = r.output;
        await emit("engineer", "done");
      } catch (err) {
        state.engineer = null;
        await emit("engineer", "failed", { error: String(err) });
      }
    })();

    const counts = await Promise.all(writing);
    await engineering;
    await say(
      "system",
      `${writerIds.length} 位编剧完成 ${counts.reduce((a, b) => a + b, 0)} 个节点${state.engineer ? "，Kai 完成了主题和界面组件" : "，界面组件生成失败，将使用默认界面"}。进入审校。`,
    );
    return "review";
  },

  async review({ state, deps, emit, say }) {
    const merged = mergeStory(state.spec!, state.cast!, state.skeleton!, state.written);
    const parsed = Story.safeParse(merged.story);
    if (merged.errors.length || !parsed.success) return "validate"; // let the validator route fixes first
    await emit("reviewer", "started");
    const r = await runReviewer(deps.models, parsed.data);
    state.tokens += r.tokens;
    const ids = new Set(state.skeleton!.nodes.map((n) => n.id));
    const issues = r.output.issues.filter((i) => ids.has(i.nodeId));
    await emit("reviewer", "done", { issues });
    if (!issues.length) {
      await say("reviewer", "通读完毕，口吻和衔接没有发现问题。");
      return "validate";
    }
    state.review = issues;
    await say("reviewer", `发现 ${issues.length} 处需要调整，已发给对应编剧：\n${issues.map((i) => `· [${i.nodeId}] ${i.problem}`).join("\n")}`);
    return "revise";
  },

  async revise({ state, deps, emit }) {
    const owners = ownersOf(state.skeleton!);
    const byWriter: Record<string, { ids: string[]; feedback: string[] }> = {};
    for (const i of state.review ?? []) {
      const w = owners[i.nodeId];
      byWriter[w] ??= { ids: [], feedback: [] };
      if (!byWriter[w].ids.includes(i.nodeId)) byWriter[w].ids.push(i.nodeId);
      byWriter[w].feedback.push(`[${i.nodeId}] ${i.problem} → ${i.suggestion}`);
    }
    await rewrite(state, deps, emit, byWriter);
    state.review = undefined;
    return "validate";
  },

  async validate({ state, emit, say }) {
    const spec = state.spec!;
    const owners = ownersOf(state.skeleton!);
    const merged = mergeStory(spec, state.cast!, state.skeleton!, state.written);
    const check = validateStory(merged.story, { owners, spec });
    const errors = dedupe([...merged.errors, ...check.errors]);
    if (errors.length === 0 && check.story) {
      state.story = check.story;
      state.playtest = simulate(check.story, 200);
      await emit("system", "validation", { target: "story", errors: [], playtest: state.playtest });
      await say("system", `确定性校验通过：所有节点可达、无死路、${check.stats!.endings} 个结局都能达成。${describeSimulation(state.playtest)}。`);
      return "assemble";
    }
    await emit("system", "validation", { target: "story", errors, round: state.fixRound + 1 });
    await emit("system", "graph_status", { ids: errors.map((e) => e.nodeId).filter(Boolean), status: "error" });
    const structural = errors.filter((e) => e.owner === "architect");
    if (structural.length) {
      throw new Error(`写作后出现结构问题，需要重新生成：${formatErrors(structural).slice(0, 3).join("；")}`);
    }
    if (state.fixRound >= MAX_FIX_ROUNDS) {
      throw new Error(`修复 ${MAX_FIX_ROUNDS} 轮后仍有问题：${formatErrors(errors).slice(0, 3).join("；")}`);
    }
    state.fixRound += 1;
    const pending: Record<string, { ids: string[]; feedback: string[] }> = {};
    for (const [owner, errs] of groupByOwner(errors)) {
      const w = owner.replace("writer:", "");
      pending[w] = { ids: [...new Set(errs.map((e) => e.nodeId!).filter(Boolean))], feedback: formatErrors(errs) };
    }
    state.pendingFixes = pending;
    await say("system", `校验发现 ${errors.length} 个文本问题，按负责人交还编剧修改（第 ${state.fixRound} 轮）。`);
    return "fix";
  },

  async fix({ state, deps, emit }) {
    await rewrite(state, deps, emit, state.pendingFixes ?? {});
    state.pendingFixes = undefined;
    return "validate";
  },

  async assemble({ state, deps, emit, say, db, run }) {
    const story = state.story!;
    let files = assembleFiles({
      story,
      themeCss: state.engineer?.themeCss,
      hudJs: state.engineer?.hudJs,
      readme: state.engineer?.readme,
    });
    let note = "";
    if (state.engineer && deps.compile) {
      let check = await deps.compile(files);
      if (!check.ok) {
        await emit("engineer", "started", { reason: "compile_error", errors: check.errors });
        try {
          const r = await runEngineer(deps.models, state.spec!, state.cast!, check.errors);
          state.tokens += r.tokens;
          files = { ...files, [HUD_PATH]: r.output.hudJs };
          check = await deps.compile(files);
        } catch {
          check = { ok: false, errors: check.errors };
        }
        if (check.ok) {
          note = "界面组件第一次编译失败，Kai 已修复。";
          await emit("engineer", "done", { fixed: true });
        } else {
          files = withDefaultHud(files);
          note = "界面组件编译未通过，已换回默认组件。";
          await emit("engineer", "failed", { errors: check.errors, fallback: true });
        }
      }
    }
    const version = await addVersion(db, {
      projectId: run.projectId,
      files,
      story,
      source: "generate",
      summary: `初版：${story.nodes.length} 个节点，${story.nodes.filter((n) => n.type === "ending").length} 个结局`,
    });
    state.versionId = version.id;
    await emit("system", "graph_status", { ids: story.nodes.map((n) => n.id), status: "done" });
    await emit("system", "version", { versionId: version.id, n: version.n, playtest: state.playtest });
    await say(
      "producer",
      `《${story.meta.title}》v${version.n} 完成，可以在右边试玩了。${note}\n想继续改的话直接告诉我，比如「加一个隐藏结局」「让${story.characters[0]?.name ?? "主角"}说话更冷淡」「换成暖色调」，也可以 @ 某位成员。`,
      version.id,
    );
    return "done";
  },
};

async function rewrite(
  state: RunState,
  deps: Deps,
  emit: Ctx["emit"],
  byWriter: Record<string, { ids: string[]; feedback: string[] }>,
) {
  const skeleton = state.skeleton!;
  await Promise.all(
    Object.entries(byWriter).map(async ([w, { ids, feedback }]) => {
      const key = writerKey(w);
      await emit(key, "started", { fixing: ids });
      const current = Object.fromEntries(ids.map((id) => [id, state.written[id] ?? null]));
      const r = await runWriter(deps.models, w, { spec: state.spec!, cast: state.cast!, skeleton }, ids, feedback, current);
      state.tokens += r.tokens;
      const allowed = new Set(ids);
      const accepted = r.output.nodes.filter((n) => allowed.has(n.id));
      for (const n of accepted) state.written[n.id] = n;
      await emit(key, "done", { nodes: accepted.map((n) => n.id), fixed: true });
    }),
  );
}

function dedupe(errors: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = `${e.rule}|${e.nodeId}|${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Execute exactly one stage of a run. Safe to call concurrently: only the lease holder works. */
export async function advanceRun(db: Db, runId: string, deps: Deps): Promise<AdvanceResult> {
  const run = await acquireLease(db, runId, LEASE_MS);
  if (!run) {
    const current = await getRun(db, runId);
    if (!current) return { status: "missing", stage: "" };
    return { status: current.status, stage: current.stage, busy: current.status === "running", error: current.error };
  }
  if (run.stage === "done") {
    await updateRun(db, runId, { status: "done", leaseUntil: null });
    return { status: "done", stage: "done" };
  }

  const state = run.state as RunState;
  const ctx: Ctx = {
    db,
    run,
    state,
    deps,
    emit: async (agent, type, payload) => {
      await addEvent(db, { runId, agent, type, payload: { stage: run.stage, ...(payload as object) } });
    },
    say: async (agent, content, versionId) => {
      await addMessage(db, { projectId: run.projectId, role: "agent", agent, content, versionId, runId });
    },
  };

  try {
    const next = await HANDLERS[run.stage as Exclude<Stage, "done">](ctx);
    await updateRun(db, runId, {
      stage: next,
      state,
      status: next === "done" ? "done" : "running",
      leaseUntil: null,
    });
    return { status: next === "done" ? "done" : "running", stage: next };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateRun(db, runId, { status: "failed", error: message, state, leaseUntil: null });
    await addEvent(db, { runId, agent: "system", type: "failed", payload: { stage: run.stage, error: message } });
    await addMessage(db, {
      projectId: run.projectId,
      role: "system",
      content: `「${stageLabel(run.stage)}」这一步失败了：${message.slice(0, 300)}\n可以点「重试这一步」。`,
      runId,
    });
    return { status: "failed", stage: run.stage, error: message };
  } finally {
    await releaseLease(db, runId);
  }
}

/** Put a failed run back to running at the stage that failed. */
export async function retryRun(db: Db, runId: string): Promise<boolean> {
  const run = await getRun(db, runId);
  if (!run || run.status !== "failed") return false;
  await updateRun(db, runId, { status: "running", error: null, leaseUntil: null });
  return true;
}

export function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    plan: "制作人定规格",
    cast: "角色设计",
    skeleton: "搭剧情骨架",
    write: "编剧并行写作",
    review: "一致性审校",
    revise: "按审校意见修改",
    validate: "确定性校验",
    fix: "按校验结果修复",
    assemble: "组装与保存版本",
    done: "完成",
  };
  return labels[stage] ?? stage;
}

export const _test = { HANDLERS, dedupe };
export { releaseLease };

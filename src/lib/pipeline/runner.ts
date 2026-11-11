import {
  acquireLease,
  addEvent,
  addMessage,
  addVersion,
  getRun,
  getVersion,
  releaseLease,
  updateProject,
  updateRun,
  type Run,
} from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import {
  runArchitect,
  runArchitectEdit,
  runCast,
  runEngineer,
  runEngineerEdit,
  runPlotReviewer,
  runProducer,
  runReviewer,
  runRouter,
  runWriter,
} from "@/lib/agents/agents";
import type { Models } from "@/lib/agents/models";
import { TEAM, writerKey, type AgentKey } from "@/lib/agents/team";
import {
  PLAYER_SPEAKER,
  Story,
  type Character,
  type EditPlan,
  type EngineerOutput,
  type PlotReview,
  type ReviewOutput,
  type Skeleton,
  type Spec,
  type WriterNode,
} from "@/lib/story/schema";
import { activeWriters, graphOf, mergeStory, ownersOf, skeletonToStory } from "@/lib/story/skeleton";
import { describeSimulation, simulate, type SimulationReport } from "@/lib/story/simulate";
import { groupByOwner, validateStory, type ValidationError } from "@/lib/story/validate";
import { assembleFiles, HUD_PATH, withDefaultHud } from "@/lib/template/assemble";
import { changeSummary, describeChanges, stableStringify } from "./diff";

export { stableStringify };

export const LEASE_MS = 240_000;
export const MAX_ARCH_ROUNDS = 3;
export const MAX_FIX_ROUNDS = 2;
export const MAX_WRITE_ATTEMPTS = 3;
/** Nodes per writer call: smaller calls finish well inside the function time limit. */
export const WRITER_CHUNK = 5;
/** Bound each writer call so a stuck request fails cleanly instead of hanging the stage. */
export const WRITER_TIMEOUT_MS = 150_000;

/** Split nodes into per-writer chunks of at most WRITER_CHUNK, keeping story order. */
export function writerChunks(nodes: { id: string; owner: string }[], size = WRITER_CHUNK): { writer: string; ids: string[] }[] {
  const byOwner = new Map<string, string[]>();
  for (const n of nodes) byOwner.set(n.owner, [...(byOwner.get(n.owner) ?? []), n.id]);
  const out: { writer: string; ids: string[] }[] = [];
  for (const [writer, ids] of [...byOwner.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = Math.ceil(ids.length / size);
    const per = Math.ceil(ids.length / parts); // even split: 8 -> 4 + 4, not 5 + 3
    for (let i = 0; i < ids.length; i += per) out.push({ writer, ids: ids.slice(i, i + per) });
  }
  return out;
}

export type Stage =
  | "plan"
  | "cast"
  | "skeleton"
  | "plot_review"
  | "write"
  | "review"
  | "revise"
  | "validate"
  | "fix"
  | "assemble"
  | "route"
  | "edit_text"
  | "edit_skeleton"
  | "edit_write"
  | "edit_style"
  | "edit_review"
  | "done";

export interface RunState {
  prompt: string;
  spec?: Spec;
  cast?: Character[];
  skeleton?: Skeleton;
  skeletonDraft?: Skeleton;
  archRound: number;
  archFeedback?: string[];
  /** Iris has read the skeleton (she gets one look, and can send it back once). */
  plotReviewed?: boolean;
  /** Skeleton that passed structure checks before a plot revision; used if the revision breaks. */
  approvedSkeleton?: Skeleton;
  written: Record<string, WriterNode>;
  engineer?: EngineerOutput | null;
  review?: ReviewOutput["issues"];
  fixRound: number;
  /** Write-stage retries after writer calls failed (timeouts, provider errors). */
  writeAttempts?: number;
  pendingFixes?: Record<string, { ids: string[]; feedback: string[] }>;
  story?: Story;
  playtest?: SimulationReport;
  tokens: number;
  versionId?: string;
  // ---- edit runs ----
  mode?: "generate" | "edit";
  mention?: AgentKey | null;
  plan?: EditPlan;
  changedIds?: string[];
  versionSource?: "generate" | "chat_edit";
  /** Endings whose epilogue the user asked for but the writers didn't deliver. */
  epilogueMissed?: string[];
  /** The version an edit started from, to report what actually changed. */
  baseVersionId?: string;
  editSummary?: string;
}

export function initialState(prompt: string): RunState {
  return { prompt, archRound: 0, written: {}, fixRound: 0, writeAttempts: 0, tokens: 0 };
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

/** "Write something under the ending" in the user's words. Deterministic, so routing can't miss it. */
export const EPILOGUE_REQUEST = /结局.{0,12}(下面|下方|底下|说明|解释|交代|写明|点明|注明|告诉玩家)|(说明|解释|交代).{0,6}结局/;

export function wantsEpilogue(userText: string, instructions = ""): boolean {
  return EPILOGUE_REQUEST.test(userText) || /结局说明|epilogue/i.test(instructions);
}

/** Which endings an epilogue request is about: the ones the router named, else the ones named by title, else all. */
export function epilogueTargets(story: Story, userText: string, nodeIds: string[]): string[] {
  const endings = story.nodes.filter((n) => n.type === "ending");
  const picked = endings.filter((e) => nodeIds.includes(e.id));
  if (picked.length) return picked.map((e) => e.id);
  const named = endings.filter((e) => e.type === "ending" && userText.includes(e.title));
  return (named.length ? named : endings).map((e) => e.id);
}

/** What each @-mentionable member can change. */
const CAN: Partial<Record<AgentKey, EditPlan["kind"][]>> = {
  engineer: ["style"],
  architect: ["structure"],
  writer_a: ["text"],
  writer_b: ["text"],
  writer_c: ["text"],
  writer_d: ["text"],
};
const DUTY: Partial<Record<AgentKey, string>> = {
  engineer: "界面（配色、字体、状态栏），不能改剧情文字",
  architect: "剧情结构（分支、结局、走向）",
  writer_a: "台词和结局文字",
  writer_b: "台词和结局文字",
  writer_c: "台词和结局文字",
  writer_d: "台词和结局文字",
};
export const canHandle = (agent: AgentKey, kind: EditPlan["kind"]) => CAN[agent]?.includes(kind) ?? false;

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
    // "player" is reserved for the player's own lines; rename a character that took it.
    state.cast = r.output.characters.map((c, i) => (c.id === PLAYER_SPEAKER ? { ...c, id: `npc_${i + 1}` } : c));
    spec.characterCount = state.cast.length; // trust the cast actually produced
    await emit("cast", "done", { characters: state.cast });
    const identity = spec.player.identity.replace(/[。.！!]+$/, "");
    const you = spec.player.name ? `${spec.player.name}——${identity}` : identity;
    await say(
      "cast",
      `玩家：${you}。\n登场角色：${state.cast.map((c) => `${c.avatar} ${c.name}（${c.role}）`).join("、")}。交给 Ada 搭骨架。`,
    );
    return "skeleton";
  },

  async skeleton({ state, deps, emit, say }) {
    const spec = state.spec!;
    await emit("architect", "started", { round: state.archRound + 1 });
    const r = await runArchitect(deps.models, spec, state.cast!, state.archFeedback ?? [], state.archFeedback ? state.skeletonDraft : undefined);
    state.tokens += r.tokens;
    const check = validateStory(skeletonToStory(spec, state.cast!, r.output), { spec, owners: ownersOf(r.output) });
    if (!check.ok && state.approvedSkeleton) {
      // A plot revision broke the structure: keep the version that already passed.
      state.skeleton = state.approvedSkeleton;
      state.approvedSkeleton = undefined;
      state.archFeedback = undefined;
      state.skeletonDraft = undefined;
      await emit("architect", "done", { nodes: state.skeleton.nodes.length, reverted: true });
      await emit("system", "graph", { ...graphOf(state.skeleton), status: "outline" });
      await say("system", `Ada 的改版没有通过结构校验（${formatErrors(check.errors).slice(0, 2).join("；")}），沿用上一版骨架开写。`);
      return "write";
    }
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
    const revised = Boolean(state.approvedSkeleton);
    state.skeleton = r.output;
    state.archFeedback = undefined;
    state.skeletonDraft = undefined;
    state.approvedSkeleton = undefined;
    await emit("architect", "done", { nodes: r.output.nodes.length });
    await emit("system", "graph", { ...graphOf(r.output), status: "outline" });
    const endings = r.output.nodes.filter((n) => n.type === "ending").length;
    const writers = r.output.writers.filter((w) => activeWriters(r.output).includes(w.id));
    const plan = writers.map((w) => `· ${TEAM[writerKey(w.id)].title}：${w.focus}`).join("\n");
    if (!state.plotReviewed) {
      await say(
        "architect",
        `骨架完成：${r.output.nodes.length - endings} 个场景、${endings} 个结局，结构校验通过。编剧分工：\n${plan}\n开写前先请 Iris 读一遍，看看好不好玩。`,
      );
      return "plot_review";
    }
    await say(
      "architect",
      `${revised ? "按 Iris 的意见改好了骨架" : "骨架完成"}：${r.output.nodes.length - endings} 个场景、${endings} 个结局，结构校验通过。分给 ${writers.length} 位编剧并行写：\n${plan}\n同时请 Kai 做界面。`,
    );
    return "write";
  },

  async plot_review({ state, deps, emit, say }) {
    const skeleton = state.skeleton!;
    await emit("reviewer", "started", { target: "plot" });
    state.plotReviewed = true;
    let review: PlotReview;
    try {
      const r = await runPlotReviewer(deps.models, state.spec!, state.cast!, skeleton);
      state.tokens += r.tokens;
      review = r.output;
    } catch (err) {
      // The read-through is a quality pass, not a gate: if it fails, write the skeleton as is.
      await emit("reviewer", "failed", { target: "plot", error: String(err) });
      await say("system", "Iris 这次没能读完骨架，直接开写。");
      return "write";
    }
    await emit("reviewer", "done", { target: "plot", verdict: review.verdict });
    if (review.verdict === "revise" && review.issues.length) {
      state.approvedSkeleton = skeleton;
      state.skeletonDraft = skeleton;
      state.skeleton = undefined;
      state.archFeedback = review.issues.map((i) => `${i.nodeId ? `[${i.nodeId}] ` : ""}${i.problem} → ${i.suggestion}`);
      await say(
        "reviewer",
        `读完了。${review.highlights}\n有 ${review.issues.length} 处可以更好玩，退回 Ada 改一轮：\n${state.archFeedback.map((f) => `· ${f}`).join("\n")}`,
      );
      return "skeleton";
    }
    await say("reviewer", `读完了，可以开写。${review.highlights}`);
    const writers = skeleton.writers.filter((w) => activeWriters(skeleton).includes(w.id));
    await say("architect", `分给 ${writers.length} 位编剧并行写，同时请 Kai 做界面。`);
    return "write";
  },

  async write(ctx) {
    const { state, deps, emit, say, db, run } = ctx;
    const skeleton = state.skeleton!;
    const focusOf = Object.fromEntries(skeleton.writers.map((w) => [w.id, w.focus]));
    // Resumable: a retry only writes what is still missing.
    const missing = skeleton.nodes.filter((n) => !state.written[n.id]);
    const chunks = writerChunks(missing);
    const byWriter = new Map<string, number>();
    for (const c of chunks) byWriter.set(c.writer, (byWriter.get(c.writer) ?? 0) + 1);
    const failedWriters = new Set<string>();
    const left = new Map(byWriter);

    for (const id of byWriter.keys()) await emit(writerKey(id), "started", { attempt: (state.writeAttempts ?? 0) + 1 });
    const writing = chunks.map(async ({ writer, ids }) => {
      const key = writerKey(writer);
      try {
        const r = await runWriter(deps.models, writer, { spec: state.spec!, cast: state.cast!, skeleton, focus: focusOf[writer] }, ids, [], undefined, {
          timeoutMs: WRITER_TIMEOUT_MS,
        });
        const allowed = new Set(ids);
        const accepted = r.output.nodes.filter((n) => allowed.has(n.id));
        for (const n of accepted) state.written[n.id] = n;
        state.tokens += r.tokens;
        // Save progress now, so a timeout elsewhere doesn't throw this work away.
        await updateRun(db, run.id, { state });
        await emit("system", "graph_status", { ids: accepted.map((n) => n.id), status: "written" });
      } catch (err) {
        failedWriters.add(writer);
        await emit(key, "failed", { error: String(err).slice(0, 300) });
      } finally {
        left.set(writer, left.get(writer)! - 1);
        if (left.get(writer) === 0 && !failedWriters.has(writer)) await emit(key, "done");
      }
    });
    const engineering = (async () => {
      if (state.engineer !== undefined) return; // done in an earlier attempt
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

    await Promise.all(writing);
    await engineering;

    const stillMissing = skeleton.nodes.filter((n) => !state.written[n.id]);
    // Calls that failed get retried; nodes a writer simply left out go through validate → fix as before.
    if (stillMissing.length && failedWriters.size) {
      state.writeAttempts = (state.writeAttempts ?? 0) + 1;
      const who = [...failedWriters].map((w) => TEAM[writerKey(w)].name).join("、") || "编剧";
      if (state.writeAttempts >= MAX_WRITE_ATTEMPTS) {
        throw new Error(`${who} 连续 ${MAX_WRITE_ATTEMPTS} 次没写完（还差 ${stillMissing.length} 个节点）`);
      }
      await say("system", `${who} 这次没写完（还差 ${stillMissing.length} 个节点），已写好的部分保留，只补写缺的。`);
      return "write";
    }
    const writers = activeWriters(skeleton);
    await say(
      "system",
      `${writers.length} 位编剧完成 ${skeleton.nodes.length - stillMissing.length} 个节点${state.engineer ? "，Kai 完成了主题和界面组件" : "，界面组件生成失败，将使用默认界面"}。进入审校。`,
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
    const check = validateStory(merged.story, { owners, spec: state.mode === "edit" ? null : spec });
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

  // ---------------- edit runs ----------------

  async route({ state, deps, emit, say }) {
    const story = state.story!;
    const text = state.prompt;
    if (state.mention === "reviewer") {
      state.editSummary = "按审校意见润色";
      await say("reviewer", "收到，我通读一遍，把问题交给对应编剧。");
      return "edit_review";
    }
    // Mira always reads the request, even when someone was @-mentioned: the mention says who the
    // user would like, the request decides who can actually do it.
    await emit("producer", "started", { routing: true });
    const r = await runRouter(deps.models, story, text);
    state.tokens += r.tokens;
    const plan: EditPlan = r.output;
    if (EPILOGUE_REQUEST.test(text) && (plan.kind === "structure" || plan.kind === "style")) {
      // Text under an ending is the writers' job, whatever the router guessed.
      plan.kind = "text";
      plan.reply = "这是给结局写说明文字，交给编剧来写。";
      plan.instructions = `结局说明：${plan.instructions}`;
    }
    await emit("producer", "done", { plan });
    state.plan = plan;
    state.editSummary = plan.summary;
    const target: Record<EditPlan["kind"], string> = {
      text: "交给编剧修改",
      structure: "交给 Ada 调整剧情结构",
      style: "交给 Kai 修改界面",
      question: "",
      new_game: "",
    };
    const actionable = plan.kind !== "question" && plan.kind !== "new_game";
    if (state.mention && actionable && canHandle(state.mention, plan.kind)) {
      await say(state.mention, `收到，我来改：${plan.reply}`);
    } else if (state.mention && actionable) {
      const who = TEAM[state.mention];
      await say(
        "producer",
        `${who.name} 负责${DUTY[state.mention] ?? who.title}，这件事 ${who.name} 做不了。${plan.reply}（${target[plan.kind]}）`,
      );
    } else {
      await say("producer", actionable ? `${plan.reply}（${target[plan.kind]}）` : plan.reply);
    }
    if (plan.kind === "question" || plan.kind === "new_game") return "done";
    return plan.kind === "text" ? "edit_text" : plan.kind === "structure" ? "edit_skeleton" : "edit_style";
  },

  async edit_text({ state, deps, emit }) {
    const plan = state.plan!;
    const story = state.story!;
    const owners = ownersOf(state.skeleton!);
    const byChar = new Set(plan.characterIds);
    const targets = new Set(plan.nodeIds.filter((id) => owners[id]));
    for (const n of story.nodes) if (n.lines.some((l) => l.speaker && byChar.has(l.speaker))) targets.add(n.id);
    const epilogueIds = wantsEpilogue(state.prompt, plan.instructions) ? epilogueTargets(story, state.prompt, plan.nodeIds) : [];
    for (const id of epilogueIds) targets.add(id);
    const ids = targets.size ? [...targets] : story.nodes.map((n) => n.id);

    const request = `用户的修改要求（原话：「${state.prompt}」）：${plan.instructions}`;
    const epilogueNote = (forIds: string[]) =>
      `这次一定要写结局说明：请为 ${forIds.join("、")} 输出非空的 epilogue 字段（它显示在「结局：标题」正下方），内容按用户的要求写。`;
    const byWriter: Record<string, { ids: string[]; feedback: string[] }> = {};
    for (const id of ids) {
      const w = owners[id];
      byWriter[w] ??= { ids: [], feedback: [request] };
      byWriter[w].ids.push(id);
    }
    for (const w of Object.keys(byWriter)) {
      const mine = byWriter[w].ids.filter((id) => epilogueIds.includes(id));
      if (mine.length) byWriter[w].feedback.push(epilogueNote(mine));
    }
    state.changedIds = ids;
    await emit("system", "graph_status", { ids, status: "outline" });
    const before = Object.fromEntries(epilogueIds.map((id) => [id, state.written[id]?.epilogue ?? null]));
    await rewrite(state, deps, emit, byWriter);

    // Check the request was actually carried out; give the writer one more go if not.
    const missed = () => epilogueIds.filter((id) => !state.written[id]?.epilogue?.trim() || state.written[id]?.epilogue === before[id]);
    if (missed().length) {
      const retry: Record<string, { ids: string[]; feedback: string[] }> = {};
      for (const id of missed()) {
        const w = owners[id];
        retry[w] ??= { ids: [], feedback: [request, "上一次你没有写或没有修改 epilogue 字段。"] };
        retry[w].ids.push(id);
      }
      for (const w of Object.keys(retry)) retry[w].feedback.push(epilogueNote(retry[w].ids));
      await rewrite(state, deps, emit, retry);
    }
    state.epilogueMissed = missed();
    return "validate";
  },

  async edit_review({ state, deps, emit, say }) {
    await emit("reviewer", "started");
    const r = await runReviewer(deps.models, state.story!);
    state.tokens += r.tokens;
    const ids = new Set(state.skeleton!.nodes.map((n) => n.id));
    const issues = r.output.issues.filter((i) => ids.has(i.nodeId));
    await emit("reviewer", "done", { issues });
    if (!issues.length) {
      await say("reviewer", "通读完毕，没有发现需要修改的地方，版本不变。");
      return "done";
    }
    state.review = issues;
    await say("reviewer", `发现 ${issues.length} 处可以改进：\n${issues.map((i) => `· [${i.nodeId}] ${i.problem}`).join("\n")}`);
    return "revise";
  },

  async edit_skeleton({ state, deps, emit, say }) {
    const plan = state.plan!;
    const before = state.skeleton!;
    await emit("architect", "started", { round: state.archRound + 1 });
    const r = await runArchitectEdit(deps.models, state.spec!, state.cast!, before, plan.instructions, state.archFeedback ?? []);
    state.tokens += r.tokens;
    const check = validateStory(skeletonToStory(state.spec!, state.cast!, r.output), { owners: ownersOf(r.output) });
    if (!check.ok) {
      state.archRound += 1;
      state.archFeedback = formatErrors(check.errors);
      await emit("system", "validation", { target: "skeleton", errors: check.errors, round: state.archRound });
      if (state.archRound >= MAX_ARCH_ROUNDS) throw new Error(`结构修改连续 ${MAX_ARCH_ROUNDS} 次没有通过校验：${state.archFeedback.slice(0, 3).join("；")}`);
      await say("system", `修改后的结构有 ${check.errors.length} 个问题，已交还 Ada：\n${state.archFeedback.slice(0, 5).map((f) => `· ${f}`).join("\n")}`);
      return "edit_skeleton";
    }
    const old = new Map(before.nodes.map((n) => [n.id, nodeSignature(n)]));
    const changed = r.output.nodes.filter((n) => old.get(n.id) !== nodeSignature(n)).map((n) => n.id);
    const keep = new Set(r.output.nodes.map((n) => n.id));
    for (const id of Object.keys(state.written)) if (!keep.has(id) || changed.includes(id)) delete state.written[id];
    state.skeleton = r.output;
    state.changedIds = changed;
    state.archFeedback = undefined;
    await emit("architect", "done", { changed });
    await emit("system", "graph", { ...graphOf(r.output), status: "done" });
    await emit("system", "graph_status", { ids: changed, status: "outline" });
    const removed = before.nodes.filter((n) => !keep.has(n.id)).length;
    await say("architect", `结构已调整：改动 ${changed.length} 个节点${removed ? `，删除 ${removed} 个` : ""}，结构校验通过。交给编剧补写改动的部分。`);
    return "edit_write";
  },

  async edit_write({ state, deps, emit }) {
    const owners = ownersOf(state.skeleton!);
    const byWriter: Record<string, { ids: string[]; feedback: string[] }> = {};
    for (const id of state.changedIds ?? []) {
      const w = owners[id];
      byWriter[w] ??= { ids: [], feedback: [`这是一次结构修改：${state.plan?.instructions ?? ""}。请为这些新增或改动的节点写内容。`] };
      byWriter[w].ids.push(id);
    }
    await rewrite(state, deps, emit, byWriter);
    return "validate";
  },

  async edit_style({ state, deps, emit }) {
    const current = state.engineer!;
    await emit("engineer", "started");
    const r = await runEngineerEdit(deps.models, state.spec!, state.cast!, current, state.plan!.instructions);
    state.tokens += r.tokens;
    state.engineer = { ...r.output, readme: r.output.readme || current.readme };
    await emit("engineer", "done");
    return "assemble";
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
    const isEdit = state.mode === "edit";
    let changes = "";
    if (isEdit && state.baseVersionId) {
      const base = await getVersion(db, state.baseVersionId);
      if (base) {
        const report = describeChanges({ story: base.story as Story, files: base.files }, { story, files });
        if (report.none) {
          const missed = state.epilogueMissed?.length ? "编剧没能写出结局说明。" : "";
          await say("producer", `这次没有产生任何改动，版本保持不变。${missed}可能是我没理解对，换个说法再试试，或者说清楚想改哪一处。`);
          return "done";
        }
        changes = report.visible
          ? `改动：${changeSummary(report)}。`
          : `注意：这次只改了 ${changeSummary(report)}，游戏画面里看不到变化。`;
        if (state.epilogueMissed?.length) {
          const titles = state.epilogueMissed.map((id) => {
            const n = story.nodes.find((x) => x.id === id);
            return n?.type === "ending" ? `「${n.title}」` : id;
          });
          changes += `注意：结局${titles.join("、")}的说明没有写成功，可以再说一次。`;
        }
      }
    }
    const version = await addVersion(db, {
      projectId: run.projectId,
      files,
      story,
      source: isEdit ? "chat_edit" : "generate",
      summary: isEdit
        ? (state.editSummary ?? "对话修改")
        : `初版：${story.nodes.length} 个节点，${story.nodes.filter((n) => n.type === "ending").length} 个结局`,
    });
    state.versionId = version.id;
    await emit("system", "graph_status", { ids: story.nodes.map((n) => n.id), status: "done" });
    await emit("system", "version", { versionId: version.id, n: version.n, playtest: state.playtest });
    if (isEdit) {
      await say(
        "producer",
        `v${version.n}：${state.editSummary ?? "按你的要求修改"}。${changes}${note}${state.playtest ? describeSimulation(state.playtest) + "。" : ""}`,
        version.id,
      );
      return "done";
    }
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

/** What makes a skeleton node "the same" for edit diffing: its story beat and its outgoing structure. */
export function nodeSignature(n: Skeleton["nodes"][number]): string {
  return stableStringify({ t: n.type, s: n.summary, c: n.choices.map((c) => [c.next, c.condition, c.effects]) });
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
    plot_review: "审读剧情骨架",
    write: "编剧并行写作",
    review: "一致性审校",
    revise: "按审校意见修改",
    validate: "确定性校验",
    fix: "按校验结果修复",
    assemble: "组装与保存版本",
    route: "制作人理解修改需求",
    edit_text: "编剧修改台词",
    edit_skeleton: "架构师调整结构",
    edit_write: "编剧补写改动",
    edit_style: "工程师修改界面",
    edit_review: "审校通读",
    done: "完成",
  };
  return labels[stage] ?? stage;
}

export const _test = { HANDLERS, dedupe };
export { releaseLease };

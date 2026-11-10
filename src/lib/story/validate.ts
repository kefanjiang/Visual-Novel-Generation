import { availableChoices, initState, step, type GameState } from "./engine";
import { Story, type Spec } from "./schema";

export type Rule = "schema" | "reference" | "stuck" | "reachability" | "scale" | "text";

/** Who should fix it: the architect owns structure, writers own text. */
export type Owner = "architect" | `writer:${string}`;

export interface ValidationError {
  rule: Rule;
  nodeId: string | null;
  owner: Owner;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  story: Story | null;
  stats: { nodes: number; endings: number; states: number } | null;
}

export interface ValidateOptions {
  /** nodeId -> writer id, so text problems go back to the right writer. */
  owners?: Record<string, string>;
  /** Scale targets from the producer's spec. */
  spec?: Pick<Spec, "nodeTarget" | "endingCount" | "characterCount"> | null;
  /** Safety cap for the state-space search. */
  maxStates?: number;
}

const MAX_VAR_RANGE = 20;
const PLACEHOLDER = /(TODO|TBD|FIXME|lorem ipsum|待补充|待填写|此处填写)|^[.…\s]+$/i;

export function validateStory(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const errors: ValidationError[] = [];
  const writerOf = (nodeId: string): Owner => `writer:${opts.owners?.[nodeId] ?? "a"}`;
  const add = (rule: Rule, nodeId: string | null, owner: Owner, message: string) =>
    errors.push({ rule, nodeId, owner, message });

  // 1. schema
  const parsed = Story.safeParse(input);
  if (!parsed.success) {
    const raw = input as { nodes?: { id?: string }[] };
    for (const issue of parsed.error.issues.slice(0, 20)) {
      const [head, idx] = issue.path;
      const nodeId = head === "nodes" && typeof idx === "number" ? (raw?.nodes?.[idx]?.id ?? null) : null;
      add("schema", nodeId, "architect", `${issue.path.join(".")}: ${issue.message}`);
    }
    return { ok: false, errors, story: null, stats: null };
  }
  const story = parsed.data;

  // 2. references
  const nodeIds = new Set<string>();
  for (const n of story.nodes) {
    if (nodeIds.has(n.id)) add("reference", n.id, "architect", `节点 id 重复：${n.id}`);
    nodeIds.add(n.id);
  }
  const charIds = new Set(story.characters.map((c) => c.id));
  if (charIds.size !== story.characters.length) add("reference", null, "architect", "角色 id 重复");
  const varIds = new Set(story.variables.map((v) => v.id));
  for (const v of story.variables) {
    if (!(v.min <= v.init && v.init <= v.max)) add("reference", null, "architect", `变量 ${v.id} 需要满足 min ≤ init ≤ max`);
    if (v.max - v.min > MAX_VAR_RANGE) add("scale", null, "architect", `变量 ${v.id} 的范围不能超过 ${MAX_VAR_RANGE}`);
  }
  if (!nodeIds.has(story.meta.start)) add("reference", null, "architect", `起始节点 ${story.meta.start} 不存在`);

  for (const n of story.nodes) {
    for (const line of n.lines) {
      if (line.speaker && !charIds.has(line.speaker)) add("reference", n.id, writerOf(n.id), `未知说话人 ${line.speaker}`);
    }
    if (n.type !== "scene") continue;
    n.choices.forEach((c, i) => {
      if (!nodeIds.has(c.next)) add("reference", n.id, "architect", `选项 ${i + 1} 指向不存在的节点 ${c.next}`);
      if (c.condition && !varIds.has(c.condition.var)) add("reference", n.id, "architect", `选项 ${i + 1} 的条件使用了未定义变量 ${c.condition.var}`);
      for (const e of c.effects) {
        if (!varIds.has(e.var)) add("reference", n.id, "architect", `选项 ${i + 1} 的效果使用了未定义变量 ${e.var}`);
      }
    });
  }

  // 3. no dead ends: every scene keeps at least one unconditional choice
  for (const n of story.nodes) {
    if (n.type === "scene" && !n.choices.some((c) => c.condition === null)) {
      add("stuck", n.id, "architect", "所有选项都有条件，某些变量状态下玩家会卡住；至少保留一个无条件选项");
    }
  }

  // 6. text quality (before the graph search so writers get feedback even if structure is broken)
  for (const n of story.nodes) {
    for (const line of n.lines) {
      if (PLACEHOLDER.test(line.text.trim())) add("text", n.id, writerOf(n.id), `台词含占位内容：「${line.text}」`);
    }
    if (n.type === "scene") {
      const texts = n.choices.map((c) => c.text.trim());
      if (new Set(texts).size !== texts.length) add("text", n.id, writerOf(n.id), "同一场景里有重复的选项文字");
      for (const t of texts) if (PLACEHOLDER.test(t)) add("text", n.id, writerOf(n.id), `选项含占位内容：「${t}」`);
    }
  }

  // stop before the graph search if references are broken
  if (errors.some((e) => e.rule === "reference" || e.rule === "scale")) {
    return { ok: false, errors, story, stats: null };
  }

  // 4. reachability over (node, vars) states
  const search = exploreStates(story, opts.maxStates ?? 200_000);
  if (search.overflow) {
    add("scale", null, "architect", "变量组合太多，状态空间超过上限；请减少变量或缩小范围");
    return { ok: false, errors, story, stats: null };
  }
  const visitedNodes = new Set([...search.states.values()].map((s) => s.nodeId));
  for (const n of story.nodes) {
    if (!visitedNodes.has(n.id)) {
      add("reachability", n.id, "architect", n.type === "ending" ? `结局「${n.title}」无法达成` : "这个节点从开头无法到达");
    }
  }
  const trapped = statesThatCannotEnd(search);
  if (trapped.size > 0) {
    for (const nodeId of [...trapped].sort()) {
      add("reachability", nodeId, "architect", "从这里出发可能陷入循环，永远到不了结局");
    }
  }

  // 5. scale against the spec
  const endings = story.nodes.filter((n) => n.type === "ending").length;
  if (endings < 1) add("scale", null, "architect", "至少需要一个结局");
  if (opts.spec) {
    const { nodeTarget, endingCount, characterCount } = opts.spec;
    if (story.nodes.length < Math.floor(nodeTarget * 0.6) || story.nodes.length > Math.min(40, Math.ceil(nodeTarget * 1.5))) {
      add("scale", null, "architect", `节点数 ${story.nodes.length} 偏离目标 ${nodeTarget} 太多`);
    }
    if (Math.abs(endings - endingCount) > 1) add("scale", null, "architect", `结局数 ${endings} 与目标 ${endingCount} 不符`);
    if (story.characters.length !== characterCount) {
      add("scale", null, "architect", `角色数 ${story.characters.length} 与目标 ${characterCount} 不符`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    story,
    stats: { nodes: story.nodes.length, endings, states: search.states.size },
  };
}

// ---------------- state-space search ----------------

interface Search {
  states: Map<string, GameState>;
  edges: Map<string, string[]>;
  overflow: boolean;
}

const keyOf = (s: GameState) => `${s.nodeId}|${JSON.stringify(s.vars)}`;

function exploreStates(story: Story, maxStates: number): Search {
  const start = initState(story);
  const states = new Map<string, GameState>([[keyOf(start), start]]);
  const edges = new Map<string, string[]>();
  const queue = [start];
  while (queue.length) {
    const s = queue.shift()!;
    const k = keyOf(s);
    const out: string[] = [];
    if (!s.ended) {
      for (const { index } of availableChoices(story, s)) {
        const next = step(story, { ...s, history: [] }, index);
        next.history = [];
        const nk = keyOf(next);
        out.push(nk);
        if (!states.has(nk)) {
          if (states.size >= maxStates) return { states, edges, overflow: true };
          states.set(nk, next);
          queue.push(next);
        }
      }
    }
    edges.set(k, out);
  }
  return { states, edges, overflow: false };
}

/** Node ids of reachable states from which no ending is reachable. */
function statesThatCannotEnd({ states, edges }: Search): Set<string> {
  const reverse = new Map<string, string[]>();
  for (const [from, tos] of edges) {
    for (const to of tos) {
      if (!reverse.has(to)) reverse.set(to, []);
      reverse.get(to)!.push(from);
    }
  }
  const canEnd = new Set<string>();
  const queue: string[] = [];
  for (const [k, s] of states) {
    if (s.ended) {
      canEnd.add(k);
      queue.push(k);
    }
  }
  while (queue.length) {
    const k = queue.shift()!;
    for (const prev of reverse.get(k) ?? []) {
      if (!canEnd.has(prev)) {
        canEnd.add(prev);
        queue.push(prev);
      }
    }
  }
  const trapped = new Set<string>();
  for (const [k, s] of states) if (!canEnd.has(k)) trapped.add(s.nodeId);
  return trapped;
}

/** Group errors by owner so each agent only gets its own problems back. */
export function groupByOwner(errors: ValidationError[]): Map<Owner, ValidationError[]> {
  const out = new Map<Owner, ValidationError[]>();
  for (const e of errors) {
    if (!out.has(e.owner)) out.set(e.owner, []);
    out.get(e.owner)!.push(e);
  }
  return out;
}

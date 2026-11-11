import type { Character, Skeleton, SkeletonNode, Spec, Story, StoryNode, WriterNode } from "./schema";
import type { ValidationError } from "./validate";

/** nodeId -> writer id */
export function ownersOf(skeleton: Skeleton): Record<string, string> {
  return Object.fromEntries(skeleton.nodes.map((n) => [n.id, n.owner]));
}

export function nodesForWriter(skeleton: Skeleton, writerId: string): SkeletonNode[] {
  return skeleton.nodes.filter((n) => n.owner === writerId);
}

/** Writers that actually own nodes (the architect may declare more than it uses). */
export function activeWriters(skeleton: Skeleton): string[] {
  return [...new Set(skeleton.nodes.map((n) => n.owner))].sort();
}

/** Summaries of nodes leading into / out of the given ones, so writers can make transitions fit. */
export function neighborSummaries(skeleton: Skeleton, ids: string[]): { id: string; summary: string }[] {
  const mine = new Set(ids);
  const near = new Set<string>();
  for (const n of skeleton.nodes) {
    for (const c of n.choices) {
      if (mine.has(n.id) && !mine.has(c.next)) near.add(c.next);
      if (mine.has(c.next) && !mine.has(n.id)) near.add(n.id);
    }
  }
  return skeleton.nodes.filter((n) => near.has(n.id)).map((n) => ({ id: n.id, summary: n.summary }));
}

function metaFrom(spec: Spec, skeleton: Skeleton): Story["meta"] {
  return {
    title: spec.title,
    genre: spec.genre,
    tone: spec.tone,
    synopsis: spec.synopsis,
    start: skeleton.start,
    preface: spec.preface,
    player: spec.player,
    premise: spec.premise,
  };
}

/**
 * Turn the skeleton into a playable story using summaries as lines and intents as choice texts.
 * Lets the validator check the graph *before* any writing happens.
 */
export function skeletonToStory(spec: Spec, cast: Character[], skeleton: Skeleton): unknown {
  return {
    meta: metaFrom(spec, skeleton),
    variables: spec.variables,
    characters: cast,
    nodes: skeleton.nodes.map((n) => buildNode(n, [{ speaker: null, text: n.summary }], n.choices.map((c) => c.intent))),
  };
}

function buildNode(n: SkeletonNode, lines: StoryNode["lines"], choiceTexts: string[], epilogue?: string | null): unknown {
  if (n.type === "ending") {
    const node: Record<string, unknown> = { id: n.id, type: "ending", bg: n.bg, endingKind: n.endingKind ?? "neutral", title: n.endingTitle ?? "结局", lines };
    if (epilogue) node.epilogue = epilogue;
    return node;
  }
  return {
    id: n.id,
    type: "scene",
    bg: n.bg,
    lines,
    choices: n.choices.map((c, i) => ({ text: choiceTexts[i] ?? "", next: c.next, condition: c.condition, effects: c.effects })),
  };
}

/**
 * Merge writer content into the skeleton. Structure always comes from the skeleton,
 * so writers cannot break the graph; missing or mismatched content becomes an error for that writer.
 */
export function mergeStory(
  spec: Spec,
  cast: Character[],
  skeleton: Skeleton,
  written: Record<string, WriterNode>,
): { story: unknown; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const nodes = skeleton.nodes.map((n) => {
    const w = written[n.id];
    const owner = `writer:${n.owner}` as const;
    if (!w) {
      errors.push({ rule: "text", nodeId: n.id, owner, message: "这个节点还没有写内容" });
      return buildNode(n, [{ speaker: null, text: n.summary }], n.choices.map((c) => c.intent));
    }
    const expected = n.type === "ending" ? 0 : n.choices.length;
    if (w.choiceTexts.length !== expected) {
      errors.push({
        rule: "text",
        nodeId: n.id,
        owner,
        message: `选项文字有 ${w.choiceTexts.length} 条，但骨架里有 ${expected} 个选项，需要一一对应`,
      });
    }
    const texts = n.choices.map((c, i) => w.choiceTexts[i] ?? c.intent);
    return buildNode(n, w.lines, texts, w.epilogue);
  });
  return { story: { meta: metaFrom(spec, skeleton), variables: spec.variables, characters: cast, nodes }, errors };
}

/** Graph view for the UI (React Flow). */
export function graphOf(skeleton: Skeleton) {
  return {
    nodes: skeleton.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.type === "ending" ? `结局：${n.endingTitle ?? ""}` : n.summary,
      owner: n.owner,
      chapter: n.chapter,
    })),
    edges: skeleton.nodes.flatMap((n) =>
      n.choices.map((c, i) => ({
        id: `${n.id}-${i}`,
        source: n.id,
        target: c.next,
        label: c.condition ? `${c.condition.var} ${c.condition.op} ${c.condition.value}` : "",
      })),
    ),
  };
}

/** Rebuild a skeleton from a finished story (used when editing an existing version). */
export function storyToSkeleton(story: Story, owners: Record<string, string> = {}): Skeleton {
  const writers = [...new Set(story.nodes.map((n) => owners[n.id] ?? "a"))].sort() as Skeleton["writers"][number]["id"][];
  return {
    start: story.meta.start,
    writers: writers.map((id) => ({ id, focus: "沿用原有剧情线" })),
    nodes: story.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      chapter: 1,
      owner: (owners[n.id] ?? "a") as SkeletonNode["owner"],
      bg: n.bg,
      summary: n.lines.map((l) => l.text).join(" ").slice(0, 120),
      endingKind: n.type === "ending" ? n.endingKind : null,
      endingTitle: n.type === "ending" ? n.title : null,
      choices:
        n.type === "scene"
          ? n.choices.map((c) => ({ intent: c.text.slice(0, 40), next: c.next, condition: c.condition, effects: c.effects }))
          : [],
    })),
  };
}

/** Split nodes (in story order) into up to 3 contiguous groups so edits can be written in parallel. */
export function defaultOwners(story: Story): Record<string, string> {
  const ids = story.nodes.map((n) => n.id);
  const groups = Math.min(3, Math.max(1, Math.ceil(ids.length / 4)));
  const size = Math.ceil(ids.length / groups);
  return Object.fromEntries(ids.map((id, i) => [id, "abc"[Math.floor(i / size)]]));
}

/** Writer content (lines + choice texts) recovered from a finished story. */
export function writtenFromStory(story: Story): Record<string, WriterNode> {
  return Object.fromEntries(
    story.nodes.map((n) => [
      n.id,
      { id: n.id, lines: n.lines, choiceTexts: n.type === "scene" ? n.choices.map((c) => c.text) : [], epilogue: n.type === "ending" ? (n.epilogue ?? null) : null },
    ]),
  );
}

/** A spec reconstructed from a finished story, used by edit runs. */
export function specFromStory(story: Story): Spec {
  return {
    title: story.meta.title,
    genre: story.meta.genre,
    tone: story.meta.tone,
    synopsis: story.meta.synopsis,
    // Games made before premises existed get neutral stand-ins so edits still work.
    premise: story.meta.premise ?? {
      question: story.meta.synopsis.slice(0, 80),
      playerGoal: "沿用原剧情",
      stakes: "沿用原剧情",
      hiddenTruth: "沿用原剧情中已经写出的设定",
    },
    player: story.meta.player ?? { name: null, identity: "你是故事的主角" },
    preface: story.meta.preface ?? story.meta.synopsis,
    characterCount: story.characters.length,
    endingCount: Math.min(4, Math.max(2, story.nodes.filter((n) => n.type === "ending").length)),
    nodeTarget: Math.min(35, Math.max(12, story.nodes.length)),
    variables: story.variables,
    note: "",
  };
}

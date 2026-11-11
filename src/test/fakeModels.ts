import { MockLanguageModelV4 } from "ai/test";
import type { Models } from "@/lib/agents/models";
import { SAMPLE_STORY } from "@/lib/story/sample";
import type { EngineerOutput, Skeleton, Spec, WriterOutput } from "@/lib/story/schema";
import { storyToSkeleton } from "@/lib/story/skeleton";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

export type AgentName = "producer" | "cast" | "architect" | "writer" | "reviewer" | "engineer";

export const SAMPLE_OWNERS: Record<string, string> = {
  n1: "a", n2: "a", n3: "a",
  n4: "b", n5: "b", e_bad: "b",
  n6: "c", e_good: "c", e_secret: "c",
};

export const FIXTURES = {
  spec: (): Spec => ({
    title: SAMPLE_STORY.meta.title,
    genre: SAMPLE_STORY.meta.genre,
    tone: SAMPLE_STORY.meta.tone,
    synopsis: SAMPLE_STORY.meta.synopsis,
    characterCount: 2,
    endingCount: 3,
    nodeTarget: 12,
    variables: structuredClone(SAMPLE_STORY.variables),
    note: "按默认规模做：2 个角色、3 个结局。",
  }),
  cast: () => ({ characters: structuredClone(SAMPLE_STORY.characters) }),
  skeleton: (): Skeleton => {
    const s = storyToSkeleton(SAMPLE_STORY, SAMPLE_OWNERS);
    s.writers = [
      { id: "a", focus: "开场主干" },
      { id: "b", focus: "追问与离开" },
      { id: "c", focus: "地下室与结局" },
    ];
    return s;
  },
  writer: (ids: string[]): WriterOutput => ({
    nodes: structuredClone(SAMPLE_STORY).nodes
      .filter((n) => ids.includes(n.id))
      .map((n) => ({ id: n.id, lines: n.lines, choiceTexts: n.type === "scene" ? n.choices.map((c) => c.text) : [] })),
  }),
  reviewer: () => ({ issues: [] as { nodeId: string; problem: string; suggestion: string }[] }),
  engineer: (): EngineerOutput => ({
    themeCss: ":root { --sg-accent: #c9a96e; }",
    hudJs: "export default function Hud({ vars }) { return <div className='hud'>信任 {vars.trust_lin}</div>; }",
    readme: "# 雨夜书店\n\n一个关于旧书店的悬疑故事。",
  }),
};

type Responder = (user: string) => unknown;

export interface FakeModels extends Models {
  calls: { agent: AgentName; user: string }[];
  /** Queue one-off responses (or errors) for an agent; falls back to fixtures when empty. */
  queue: (agent: AgentName, response: unknown | Error) => void;
}

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
};

export function createFakeModels(overrides: Partial<Record<AgentName, Responder>> = {}): FakeModels {
  const calls: FakeModels["calls"] = [];
  const queues: Partial<Record<AgentName, (unknown | Error)[]>> = {};

  const defaults: Record<AgentName, Responder> = {
    producer: () => FIXTURES.spec(),
    cast: () => FIXTURES.cast(),
    architect: () => FIXTURES.skeleton(),
    writer: (user) => FIXTURES.writer(assignedIds(user)),
    reviewer: () => FIXTURES.reviewer(),
    engineer: () => FIXTURES.engineer(),
  };

  const make = () =>
    new MockLanguageModelV4({
      doGenerate: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === "system");
        const systemText = typeof sys?.content === "string" ? sys.content : "";
        const agent = (/\[agent:(\w+)\]/.exec(systemText)?.[1] ?? "unknown") as AgentName;
        const userMsg = opts.prompt.find((m) => m.role === "user");
        const user =
          userMsg && Array.isArray(userMsg.content)
            ? userMsg.content.map((p) => ("text" in p ? p.text : "")).join("")
            : "";
        calls.push({ agent, user });
        const queued = queues[agent]?.shift();
        if (queued instanceof Error) throw queued;
        const body = queued !== undefined ? queued : (overrides[agent] ?? defaults[agent])(user);
        return {
          content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        };
      },
    });

  return {
    strong: make(),
    fast: make(),
    calls,
    queue: (agent, response) => {
      (queues[agent] ??= []).push(response);
    },
  };
}

export function assignedIds(user: string): string[] {
  return (/ASSIGNED_IDS: ([^\n]*)/.exec(user)?.[1] ?? "").split(",").filter(Boolean);
}

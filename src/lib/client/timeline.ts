export interface ClientEvent {
  id: number;
  agent: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt?: string | Date;
}

export type AgentStatus = "idle" | "working" | "done" | "failed";
export type NodeStatus = "outline" | "written" | "error" | "done";

export interface GraphNode {
  id: string;
  type: "scene" | "ending";
  label: string;
  owner: string;
  chapter: number;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface TimelineState {
  lastId: number;
  agents: Record<string, AgentStatus>;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  nodeStatus: Record<string, NodeStatus>;
  versionId: string | null;
  failedError: string | null;
  validationErrors: { nodeId: string | null; message: string }[];
}

export const emptyTimeline = (): TimelineState => ({
  lastId: 0,
  agents: {},
  graph: null,
  nodeStatus: {},
  versionId: null,
  failedError: null,
  validationErrors: [],
});

/** Fold run events (in id order) into what the UI shows. Pure, so it is unit-tested. */
export function reduceEvents(prev: TimelineState, events: ClientEvent[]): TimelineState {
  const s: TimelineState = {
    ...prev,
    agents: { ...prev.agents },
    nodeStatus: { ...prev.nodeStatus },
  };
  for (const e of events) {
    if (e.id <= s.lastId) continue;
    s.lastId = e.id;
    const p = e.payload ?? {};
    switch (e.type) {
      case "started":
        s.agents[e.agent] = "working";
        s.failedError = null;
        break;
      case "done":
        s.agents[e.agent] = "done";
        break;
      case "failed":
        s.agents[e.agent] = "failed";
        if (e.agent === "system") s.failedError = String(p.error ?? "未知错误");
        break;
      case "graph": {
        const nodes = (p.nodes as GraphNode[]) ?? [];
        s.graph = { nodes, edges: (p.edges as GraphEdge[]) ?? [] };
        s.nodeStatus = Object.fromEntries(nodes.map((n) => [n.id, (p.status as NodeStatus) ?? "outline"]));
        break;
      }
      case "graph_status":
        for (const id of (p.ids as string[]) ?? []) s.nodeStatus[id] = p.status as NodeStatus;
        break;
      case "validation":
        s.validationErrors = ((p.errors as { nodeId: string | null; message: string }[]) ?? []).map((x) => ({
          nodeId: x.nodeId,
          message: x.message,
        }));
        break;
      case "version":
        s.versionId = String(p.versionId);
        break;
    }
  }
  return s;
}

/**
 * Layered left-to-right layout: column = shortest distance from start,
 * row = order within the column. Unreachable nodes go to a last column.
 */
export function layoutGraph(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  start: string,
  gap = { x: 240, y: 96 },
): Record<string, { x: number; y: number }> {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e.target);
  }
  const depth = new Map<string, number>();
  if (graph.nodes.some((n) => n.id === start)) {
    depth.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of out.get(id) ?? []) {
        if (!depth.has(next)) {
          depth.set(next, depth.get(id)! + 1);
          queue.push(next);
        }
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  const columns = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const d = depth.get(n.id) ?? maxDepth + 1;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(n.id);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of columns) {
    ids.forEach((id, i) => {
      pos[id] = { x: d * gap.x, y: (i - (ids.length - 1) / 2) * gap.y };
    });
  }
  return pos;
}

/** Parse a leading or inline @mention into an agent key. */
export function parseMention(text: string, aliases: Record<string, string>): { agent: string | null; text: string } {
  const m = /@(\S+)/.exec(text);
  if (!m) return { agent: null, text: text.trim() };
  const key = aliases[m[1]] ?? aliases[m[1].toLowerCase()] ?? null;
  if (!key) return { agent: null, text: text.trim() };
  return { agent: key, text: text.replace(m[0], "").trim() };
}

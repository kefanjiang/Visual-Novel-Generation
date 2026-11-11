"use client";

import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { TEAM, writerKey } from "@/lib/agents/team";
import { layoutGraph, type GraphEdge, type GraphNode, type NodeStatus } from "@/lib/client/timeline";

const STATUS_COLOR: Record<NodeStatus, string> = {
  outline: "#4a505c",
  written: "#7aa6d6",
  error: "#e57373",
  done: "#8bbf8f",
};
const STATUS_LABEL: Record<NodeStatus, string> = { outline: "骨架", written: "已写", error: "有问题", done: "完成" };

export function StoryGraph({
  graph,
  start,
  status,
  highlight = [],
}: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  start: string;
  status: Record<string, NodeStatus>;
  highlight?: string[];
}) {
  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };
    const pos = layoutGraph(graph, start);
    const hl = new Set(highlight);
    const nodes: Node[] = graph.nodes.map((n) => {
      const st = status[n.id] ?? "outline";
      const writer = TEAM[writerKey(n.owner)];
      return {
        id: n.id,
        position: pos[n.id] ?? { x: 0, y: 0 },
        data: {
          label: (
            <div className="text-left">
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] opacity-80">
                <span>{n.type === "ending" ? "🏁 结局" : n.id}</span>
                <span title={writer?.title}>{writer?.avatar}</span>
              </div>
              <div className="line-clamp-3 text-[11px] leading-snug">{n.label}</div>
            </div>
          ),
        },
        style: {
          width: 190,
          background: "#171a21",
          color: "#e8e6e1",
          border: `${hl.has(n.id) ? 3 : 1.5}px solid ${hl.has(n.id) ? "#e0a458" : STATUS_COLOR[st]}`,
          borderRadius: 10,
          padding: 8,
          transition: "border-color .4s",
        },
      };
    });
    const edges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      labelStyle: { fill: "#e0a458", fontSize: 10 },
      labelBgStyle: { fill: "#0f1115" },
      style: { stroke: e.label ? "#e0a458" : "#4a505c" },
      animated: Boolean(e.label),
    }));
    return { nodes, edges };
  }, [graph, start, status, highlight]);

  if (!graph) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">剧情架构师完成骨架后，剧情图会出现在这里</div>;
  }
  return (
    <div className="relative h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} nodesDraggable proOptions={{ hideAttribution: true }}>
        <Background color="#2a2f3a" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="absolute left-3 top-3 flex gap-2 rounded-lg bg-panel/90 px-2 py-1 text-[11px]">
        {(Object.keys(STATUS_COLOR) as NodeStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

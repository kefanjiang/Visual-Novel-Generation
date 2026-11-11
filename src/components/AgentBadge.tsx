import { TEAM, type AgentKey } from "@/lib/agents/team";
import type { AgentStatus } from "@/lib/client/timeline";

export function AgentAvatar({ agent, size = 28 }: { agent: string; size?: number }) {
  const p = TEAM[agent as AgentKey] ?? TEAM.system;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `${p.color}22`, border: `1px solid ${p.color}`, fontSize: size * 0.5 }}
      title={`${p.name} · ${p.title}`}
    >
      {p.avatar}
    </span>
  );
}

export function AgentChip({ agent, status }: { agent: string; status: AgentStatus }) {
  const p = TEAM[agent as AgentKey] ?? TEAM.system;
  const dot =
    status === "working" ? "bg-accent working-dot" : status === "done" ? "bg-ok" : status === "failed" ? "bg-danger" : "bg-line";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs" title={p.duty}>
      <span>{p.avatar}</span>
      <span>{p.name}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    </span>
  );
}

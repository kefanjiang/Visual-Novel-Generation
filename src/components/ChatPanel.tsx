"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MENTIONABLE, TEAM, type AgentKey } from "@/lib/agents/team";
import type { ProjectPayload } from "@/lib/client/api";
import type { TimelineState } from "@/lib/client/timeline";
import { AgentAvatar, AgentChip } from "./AgentBadge";

const ROSTER: AgentKey[] = ["producer", "cast", "architect", "writer_a", "writer_b", "writer_c", "reviewer", "engineer", "system"];

export function ChatPanel({
  messages,
  timeline,
  running,
  failed,
  canEdit,
  suggestions,
  onSend,
  onRetry,
  onShowVersion,
}: {
  messages: ProjectPayload["messages"];
  timeline: TimelineState;
  running: boolean;
  failed: string | null;
  canEdit: boolean;
  suggestions: string[];
  onSend: (text: string) => Promise<void>;
  onRetry: () => void;
  onShowVersion: (versionId: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const mention = /@(\S*)$/.exec(text);

  // Block body on purpose: newer Chrome returns a Promise from scrollIntoView, and an effect
  // that returns anything but a cleanup function crashes React on unmount.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, running]);

  const active = useMemo(() => ROSTER.filter((a) => timeline.agents[a]), [timeline.agents]);

  const send = async (value = text) => {
    if (!value.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(value.trim());
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
        {(active.length ? active : ROSTER.slice(0, 4)).map((a) => (
          <AgentChip key={a} agent={a} status={timeline.agents[a] ?? "idle"} />
        ))}
      </div>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-sm">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2.5">
              <AgentAvatar agent={m.agent ?? "system"} />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-xs text-muted">
                  {TEAM[(m.agent ?? "system") as AgentKey]?.name ?? "系统"} · {TEAM[(m.agent ?? "system") as AgentKey]?.title ?? ""}
                </div>
                <div className={`whitespace-pre-wrap text-sm leading-relaxed ${m.role === "system" ? "text-danger" : ""}`}>{m.content}</div>
                {m.versionId ? (
                  <button className="mt-1.5 text-xs text-accent-2 hover:underline" onClick={() => onShowVersion(m.versionId!)}>
                    查看这个版本 →
                  </button>
                ) : null}
              </div>
            </div>
          ),
        )}
        {running ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="working-dot h-2 w-2 rounded-full bg-accent" />
            团队正在工作中…{active.filter((a) => timeline.agents[a] === "working").map((a) => TEAM[a].name).join("、")}
          </div>
        ) : null}
        {failed ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
            <div className="mb-2 text-danger">这一步失败了：{failed}</div>
            {canEdit ? (
              <button className="rounded-md bg-danger/80 px-3 py-1 text-xs text-white hover:bg-danger" onClick={onRetry}>
                重试这一步
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {canEdit ? (
        <div className="border-t border-line p-3">
          {!running && suggestions.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          {mention ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {MENTIONABLE.map((a) => (
                <button
                  key={a}
                  className="flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-xs hover:border-accent"
                  onClick={() => setText(text.replace(/@\S*$/, `@${TEAM[a].name} `))}
                >
                  {TEAM[a].avatar} {TEAM[a].name}
                  <span className="text-muted">{TEAM[a].title}</span>
                </button>
              ))}
            </div>
          ) : null}
          {error ? <div className="mb-2 text-xs text-danger">{error}</div> : null}
          <div className="flex gap-2">
            <textarea
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              rows={2}
              placeholder={running ? "团队正在工作，完成后可以继续修改…" : "继续修改，比如「加一个隐藏结局」；输入 @ 可以直接找某位成员"}
              value={text}
              disabled={running || sending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              className="rounded-xl bg-accent px-4 text-sm font-medium text-bg disabled:opacity-40"
              disabled={running || sending || !text.trim()}
              onClick={() => send()}
            >
              发送
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-line p-3 text-center text-xs text-muted">这是别人的项目，可以试玩，或点右上角 Remix 复制一份自己改</div>
      )}
    </div>
  );
}

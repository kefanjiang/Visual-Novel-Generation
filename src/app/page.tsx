"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TEAM, type AgentKey } from "@/lib/agents/team";
import { api } from "@/lib/client/api";

const QUICK = [
  "雨夜旧书店里的悬疑故事，玩家要查清十年前的火灾",
  "校园恋爱：转学第一天，在天台遇见三个性格迥异的同学",
  "职场生存：入职第一周，你发现上司在隐瞒一个大项目的问题",
];

const SHOWCASE: AgentKey[] = ["producer", "cast", "architect", "writer_a", "reviewer", "engineer"];

interface Item {
  id: string;
  title: string;
  genre: string | null;
  prompt: string;
}

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lists, setLists] = useState<{ mine: Item[]; examples: Item[] }>({ mine: [], examples: [] });

  useEffect(() => {
    api<{ mine: Item[]; examples: Item[] }>("/api/projects").then(setLists).catch(() => {});
  }, []);

  const create = async (value = prompt) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ projectId: string }>("/api/projects", { json: { prompt: value } });
      router.push(`/p/${r.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-14">
      <div className="mb-10 text-center">
        <div className="mb-3 text-sm tracking-widest text-accent">剧情工坊 · STORY STUDIO</div>
        <h1 className="mb-3 text-3xl font-bold md:text-4xl">一句话，让 AI 团队为你做一个剧情游戏</h1>
        <p className="text-muted">制作人、角色设计、剧情架构师、编剧、审校和工程师协作，几分钟产出一个可玩、可分享、源码可改的 web app。</p>
      </div>

      <div className="mb-3 rounded-2xl border border-line bg-panel p-3 focus-within:border-accent">
        <textarea
          className="w-full resize-none bg-transparent p-2 text-base outline-none"
          rows={3}
          maxLength={500}
          placeholder="描述你想要的剧情游戏：题材、主角、氛围、几个结局……"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) create();
          }}
        />
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted">{prompt.length}/500 · ⌘/Ctrl + Enter 开始</span>
          <button className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-bg disabled:opacity-40" disabled={!prompt.trim() || busy} onClick={() => create()}>
            {busy ? "组建团队中…" : "开始创作"}
          </button>
        </div>
      </div>
      {error ? <div className="mb-3 text-sm text-danger">{error}</div> : null}
      <div className="mb-12 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button key={q} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-text" onClick={() => setPrompt(q)}>
            {q}
          </button>
        ))}
      </div>

      <section className="mb-12">
        <h2 className="mb-4 text-sm text-muted">你的 AI 团队</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {SHOWCASE.map((k) => (
            <div key={k} className="rounded-xl border border-line bg-panel p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xl">{TEAM[k].avatar}</span>
                <span className="font-medium">{TEAM[k].name}</span>
                <span className="text-xs text-muted">{k === "writer_a" ? "编剧 ×N" : TEAM[k].title}</span>
              </div>
              <div className="text-xs text-muted">{TEAM[k].duty}</div>
            </div>
          ))}
        </div>
      </section>

      {lists.examples.length ? <ProjectList title="示例画廊（点开即可试玩，也可以 Remix 后继续改）" items={lists.examples} /> : null}
      {lists.mine.length ? <ProjectList title="我的项目" items={lists.mine} /> : null}
    </main>
  );
}

function ProjectList({ title, items }: { title: string; items: Item[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-sm text-muted">{title}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((p) => (
          <Link key={p.id} href={`/p/${p.id}`} className="rounded-xl border border-line bg-panel p-4 transition hover:border-accent">
            <div className="mb-1 font-medium">{p.title}</div>
            <div className="mb-2 text-xs text-accent">{p.genre ?? "生成中"}</div>
            <div className="line-clamp-2 text-xs text-muted">{p.prompt}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

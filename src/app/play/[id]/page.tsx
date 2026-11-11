"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { GamePreview } from "@/components/GamePreview";
import { api } from "@/lib/client/api";

export default function PlayPage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<{ title: string; files: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ title: string; files: Record<string, string> }>(`/api/play/${id}`)
      .then((g) => {
        setGame(g);
        document.title = `${g.title} · 剧情工坊`;
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <div className="p-10 text-center text-danger">{error}</div>;
  if (!game) return <div className="p-10 text-center text-muted">加载游戏中…</div>;

  return (
    <div className="flex h-dvh flex-col">
      <div className="min-h-0 flex-1">
        <GamePreview files={game.files} mode="preview" />
      </div>
      <footer className="flex items-center justify-center gap-3 border-t border-line py-2 text-xs text-muted">
        <span>由 AI 团队生成</span>
        <Link href={`/p/${id}`} className="text-accent-2 hover:underline">
          查看制作过程 / 源码
        </Link>
        <Link href="/" className="text-accent hover:underline">
          做一个你的 →
        </Link>
      </footer>
    </div>
  );
}

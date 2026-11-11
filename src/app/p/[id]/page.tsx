"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { GamePreview } from "@/components/GamePreview";
import { StoryGraph } from "@/components/StoryGraph";
import { api, type ProjectPayload } from "@/lib/client/api";
import { useRun } from "@/lib/client/useRun";
import type { NodeStatus } from "@/lib/client/timeline";
import type { Story } from "@/lib/story/schema";
import { graphOf, storyToSkeleton } from "@/lib/story/skeleton";

type Tab = "preview" | "code" | "graph";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("graph");
  const [viewVersion, setViewVersion] = useState<ProjectPayload["currentVersion"]>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, string> | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<ProjectPayload>(`/api/projects/${id}`);
      setData(d);
      setViewVersion(d.currentVersion);
      if (d.currentVersion) setTab((t) => (t === "graph" && d.run?.status !== "running" ? "preview" : t));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const activeRunId = data?.run?.status === "running" ? data.run.id : null;
  const { timeline, run } = useRun(activeRunId, Boolean(data?.project.isOwner), load);
  const running = run ? run.status === "running" : data?.run?.status === "running";
  const failed = (run?.status === "failed" ? run.error : null) ?? (data?.run?.status === "failed" ? data.run.error : null);

  // During a run show the live graph; afterwards derive it from the version being viewed.
  const story = viewVersion?.story as Story | undefined;
  const graphView = useMemo(() => {
    if (running && timeline.graph) return { graph: timeline.graph, status: timeline.nodeStatus, start: timeline.graph.nodes[0]?.id ?? "n1" };
    if (story) {
      const g = graphOf(storyToSkeleton(story));
      const status = Object.fromEntries(g.nodes.map((n) => [n.id, "done" as NodeStatus]));
      return { graph: g, status, start: story.meta.start };
    }
    return { graph: timeline.graph, status: timeline.nodeStatus, start: "n1" };
  }, [running, timeline.graph, timeline.nodeStatus, story]);

  const suggestions = useMemo(() => {
    if (!story) return [];
    const c = story.characters[0]?.name ?? "主角";
    return ["加一个隐藏结局", `让${c}说话更冷淡一些`, "换成暖色调的界面"];
  }, [story]);

  const sendMessage = async (text: string) => {
    await api(`/api/projects/${id}/messages`, { json: { text } });
    await load();
  };
  const retry = async () => {
    if (!data?.run) return;
    await api(`/api/runs/${data.run.id}/retry`, { method: "POST" });
    await load();
  };
  const showVersion = async (versionId: string) => {
    const v = await api<NonNullable<ProjectPayload["currentVersion"]>>(`/api/versions/${versionId}`);
    setViewVersion(v);
    setTab("preview");
  };
  const restore = async () => {
    if (!viewVersion) return;
    await api(`/api/projects/${id}/restore`, { json: { versionId: viewVersion.id } });
    setNotice(`已恢复到 v${viewVersion.n}（作为新版本保存）`);
    await load();
  };
  const saveCode = async () => {
    if (!dirtyFiles) return;
    try {
      await api(`/api/projects/${id}/versions`, { json: { files: dirtyFiles } });
      setDirtyFiles(null);
      setNotice("已保存为新版本");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const remix = async () => {
    const r = await api<{ projectId: string }>(`/api/projects/${id}/remix`, { method: "POST" });
    router.push(`/p/${r.projectId}`);
  };
  const askFix = () =>
    sendMessage(`@Kai 预览编译报错了，请修复：${compileError?.slice(0, 400)}`).catch((e) => setNotice(String(e)));

  if (loadError) return <div className="p-10 text-center text-danger">{loadError}</div>;
  if (!data) return <div className="p-10 text-center text-muted">加载中…</div>;

  const isCurrent = viewVersion?.id === data.project.currentVersionId;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/play/${id}` : `/play/${id}`;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <Link href="/" className="text-sm text-accent">
          剧情工坊
        </Link>
        <span className="text-muted">/</span>
        <span className="truncate font-medium">{data.project.title}</span>
        {data.project.genre ? <span className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-muted">{data.project.genre}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {data.versions.length ? (
            <select
              className="rounded-md border border-line bg-panel-2 px-2 py-1 text-xs"
              value={viewVersion?.id ?? ""}
              onChange={(e) => showVersion(e.target.value)}
            >
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.n} · {v.summary.slice(0, 18)}
                  {v.id === data.project.currentVersionId ? "（当前）" : ""}
                </option>
              ))}
            </select>
          ) : null}
          {viewVersion && !isCurrent && data.project.isOwner && !running ? (
            <button className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent" onClick={restore}>
              恢复到此版本
            </button>
          ) : null}
          {data.currentVersion ? (
            <button className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent" onClick={() => setShareOpen(true)}>
              分享
            </button>
          ) : null}
          {data.currentVersion ? (
            <button className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg" onClick={remix}>
              Remix
            </button>
          ) : null}
        </div>
      </header>

      {notice ? (
        <div className="flex items-center justify-between bg-accent/15 px-4 py-1.5 text-xs">
          {notice}
          <button onClick={() => setNotice(null)}>✕</button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="h-[45vh] w-full border-b border-line md:h-auto md:w-[400px] md:border-b-0 md:border-r">
          <ChatPanel
            messages={data.messages}
            timeline={timeline}
            running={Boolean(running)}
            failed={failed}
            canEdit={data.project.isOwner}
            suggestions={suggestions}
            onSend={sendMessage}
            onRetry={retry}
            onShowVersion={showVersion}
          />
        </aside>

        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
            {(["preview", "code", "graph"] as Tab[]).map((t) => (
              <button
                key={t}
                className={`rounded-md px-3 py-1 text-sm ${tab === t ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
                onClick={() => setTab(t)}
              >
                {t === "preview" ? "预览" : t === "code" ? "代码" : "剧情图"}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs">
              {compileError && data.project.isOwner ? (
                <button className="rounded-md bg-danger/80 px-2 py-1 text-white" onClick={askFix} disabled={Boolean(running)}>
                  预览报错 · 让 Kai 修复
                </button>
              ) : null}
              {dirtyFiles && data.project.isOwner ? (
                <button className="rounded-md bg-accent px-2 py-1 font-medium text-bg" onClick={saveCode} disabled={Boolean(running)}>
                  保存代码为新版本
                </button>
              ) : null}
              {viewVersion ? <span className="text-muted">v{viewVersion.n}</span> : null}
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {tab === "graph" ? (
              <StoryGraph graph={graphView.graph} start={graphView.start} status={graphView.status} />
            ) : viewVersion ? (
              <GamePreview files={viewVersion.files} mode={tab} onError={setCompileError} onDirty={setDirtyFiles} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                {running ? "团队正在创作，完成后可以在这里试玩。先看看「剧情图」吧。" : "还没有可预览的版本"}
              </div>
            )}
          </div>
        </section>
      </div>

      {shareOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShareOpen(false)}>
          <div className="w-80 rounded-2xl border border-line bg-panel p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-medium">扫码在手机上玩</div>
            <div className="mx-auto mb-3 w-fit rounded-lg bg-white p-3">
              <QRCodeSVG value={shareUrl} size={180} />
            </div>
            <input className="mb-3 w-full rounded-md border border-line bg-panel-2 px-2 py-1 text-xs" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            <button
              className="w-full rounded-md bg-accent py-1.5 text-sm font-medium text-bg"
              onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => setNotice("链接已复制"))}
            >
              复制链接
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

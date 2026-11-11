"use client";

import {
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { useEffect, useMemo, useState } from "react";

/** Sandpack's react template needs a public/index.html with a #root. */
const HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div></body></html>`;

export function toSandpackFiles(files: Record<string, string>) {
  const out: Record<string, { code: string; hidden?: boolean }> = {
    "/public/index.html": { code: HTML, hidden: true },
  };
  for (const [path, code] of Object.entries(files)) out[path] = { code };
  return out;
}

function ErrorWatcher({ onError }: { onError?: (msg: string | null) => void }) {
  const { sandpack } = useSandpack();
  const msg = sandpack.error?.message ?? null;
  useEffect(() => onError?.(msg), [msg, onError]);
  return null;
}

function DirtyWatcher({ original, onDirty }: { original: Record<string, string>; onDirty?: (files: Record<string, string> | null) => void }) {
  const { sandpack } = useSandpack();
  useEffect(() => {
    const changed: Record<string, string> = {};
    let dirty = false;
    for (const [path, f] of Object.entries(sandpack.files)) {
      if (path === "/public/index.html") continue;
      changed[path] = f.code;
      if (original[path] !== f.code) dirty = true;
    }
    onDirty?.(dirty ? changed : null);
  }, [sandpack.files, original, onDirty]);
  return null;
}

export function GamePreview({
  files,
  mode,
  onError,
  onDirty,
  height = "100%",
}: {
  files: Record<string, string>;
  mode: "preview" | "code";
  onError?: (msg: string | null) => void;
  onDirty?: (files: Record<string, string> | null) => void;
  height?: string;
}) {
  const spFiles = useMemo(() => toSandpackFiles(files), [files]);
  const [key, setKey] = useState(0);
  useEffect(() => setKey((k) => k + 1), [files]);

  return (
    <SandpackProvider
      key={key}
      template="react"
      theme="dark"
      files={spFiles}
      options={{ activeFile: "/story.json", visibleFiles: ["/story.json", "/components/Hud.js", "/theme.css", "/App.js"], recompileMode: "delayed", recompileDelay: 600 }}
      customSetup={{ entry: "/index.js" }}
      style={{ height }}
    >
      <ErrorWatcher onError={onError} />
      <DirtyWatcher original={files} onDirty={onDirty} />
      <SandpackLayout style={{ height, border: "none", borderRadius: 0 }}>
        {mode === "code" ? (
          <>
            <SandpackFileExplorer style={{ height, minWidth: 170, maxWidth: 200 }} />
            <SandpackCodeEditor style={{ height }} showLineNumbers showTabs closableTabs wrapContent />
          </>
        ) : null}
        <SandpackPreview
          style={{ height, display: mode === "preview" ? "flex" : "none" }}
          showOpenInCodeSandbox={false}
          showRefreshButton
        />
      </SandpackLayout>
    </SandpackProvider>
  );
}

"use client";

import {
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { useEffect, useMemo, useRef } from "react";
import { editedFiles } from "@/lib/client/edits";

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
  useEffect(() => {
    onError?.(msg);
  }, [msg, onError]);
  return null;
}

/**
 * Reports edits made in the code editor. The baseline is what Sandpack holds right after mount
 * (our files plus the template's own, e.g. /package.json), so template files never count as edits.
 * Only calls onDirty when the set of edits actually changes, so parent re-renders can't loop.
 */
function DirtyWatcher({ onDirty }: { onDirty?: (files: Record<string, string> | null) => void }) {
  const { sandpack } = useSandpack();
  const baseline = useRef<Record<string, string> | null>(null);
  const lastSignature = useRef("");
  useEffect(() => {
    const current = Object.fromEntries(Object.entries(sandpack.files).map(([p, f]) => [p, f.code]));
    if (!baseline.current) baseline.current = current;
    const { files, signature } = editedFiles(baseline.current, current);
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    onDirty?.(files);
  }, [sandpack.files, onDirty]);
  return null;
}

/** A new files object (another version, a fresh load) remounts Sandpack so the editor resets cleanly. */
const fileKeys = new WeakMap<object, number>();
let nextKey = 0;
function keyOf(files: object) {
  let k = fileKeys.get(files);
  if (k === undefined) {
    k = ++nextKey;
    fileKeys.set(files, k);
  }
  return k;
}

const OPTIONS = {
  activeFile: "/story.json",
  visibleFiles: ["/story.json", "/components/Hud.js", "/theme.css", "/App.js"],
  recompileMode: "delayed" as const,
  recompileDelay: 600,
};
const CUSTOM_SETUP = { entry: "/index.js" };

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
  const key = keyOf(files);

  return (
    <SandpackProvider
      key={key}
      template="react"
      theme="dark"
      files={spFiles}
      options={OPTIONS}
      customSetup={CUSTOM_SETUP}
      style={{ height }}
    >
      <ErrorWatcher onError={onError} />
      <DirtyWatcher onDirty={onDirty} />
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

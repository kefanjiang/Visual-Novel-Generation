/** Pure diff used by DirtyWatcher: null when nothing changed, else every non-hidden file. */
export function editedFiles(baseline: Record<string, string>, current: Record<string, string>) {
  const changed = Object.keys(current).filter((p) => p !== "/public/index.html" && baseline[p] !== current[p]);
  const removed = Object.keys(baseline).filter((p) => !(p in current));
  if (!changed.length && !removed.length) return { files: null, signature: "" };
  const files: Record<string, string> = {};
  for (const [p, code] of Object.entries(current)) {
    if (p === "/public/index.html" || p === "/package.json") continue;
    files[p] = code;
  }
  return { files, signature: changed.map((p) => p + ":" + current[p].length + ":" + hash(current[p])).join("|") + "|-" + removed.join(",") };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

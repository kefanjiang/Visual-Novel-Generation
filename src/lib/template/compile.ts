import type { Plugin } from "esbuild";

/**
 * Bundle a generated project (virtual file map) with esbuild.
 * Used to check that agent-written code compiles before it reaches the user,
 * and in tests to render the game on the server.
 */
export async function bundleProject(
  files: Record<string, string>,
  entrySource: string,
): Promise<{ ok: true; code: string } | { ok: false; errors: string[] }> {
  const esbuild = await import("esbuild");

  const virtualFs: Plugin = {
    name: "virtual-fs",
    setup(build) {
      build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({ path: args.path, external: true }));
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === "virtual" || args.kind === "entry-point" || args.path.startsWith(".") || args.path.startsWith("/")) {
          const base = args.importer && args.importer !== "<entry>" ? args.importer.replace(/\/[^/]*$/, "") : "";
          let p = args.path.startsWith("/") ? args.path : normalize(`${base}/${args.path}`);
          if (args.path === "<entry>") return { path: "<entry>", namespace: "virtual" };
          if (!(p in files)) {
            const found = [".js", ".jsx", "/index.js"].map((ext) => p + ext).find((c) => c in files);
            if (!found) return { errors: [{ text: `无法解析 ${args.path}（来自 ${args.importer || "入口"}）` }] };
            p = found;
          }
          return { path: p, namespace: "virtual" };
        }
        return { errors: [{ text: `不允许引入外部依赖 ${args.path}，只能用 react` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
        if (args.path === "<entry>") return { contents: entrySource, loader: "jsx", resolveDir: "/" };
        const contents = files[args.path];
        if (args.path.endsWith(".css")) return { contents: "", loader: "js" };
        if (args.path.endsWith(".json")) return { contents, loader: "json" };
        return { contents, loader: "jsx" };
      });
    },
  };

  try {
    const result = await esbuild.build({
      entryPoints: ["<entry>"],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "neutral",
      jsx: "automatic",
      logLevel: "silent",
      plugins: [virtualFs],
    });
    return { ok: true, code: result.outputFiles[0].text };
  } catch (err) {
    const errors = (err as { errors?: { text: string; location?: { file: string; line: number } | null }[] }).errors;
    if (errors?.length) {
      return {
        ok: false,
        errors: errors.map((e) => (e.location ? `${e.location.file}:${e.location.line} ${e.text}` : e.text)),
      };
    }
    return { ok: false, errors: [String(err)] };
  }
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

/** Check the whole game compiles (entry = the template's App). */
export async function checkProjectCompiles(files: Record<string, string>) {
  const r = await bundleProject(files, `import App from "/App.js"; export default App;`);
  return r.ok ? { ok: true as const, errors: [] as string[] } : r;
}

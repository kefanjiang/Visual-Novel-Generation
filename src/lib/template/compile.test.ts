import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { SAMPLE_STORY } from "@/lib/story/sample";
import { assembleFiles, HUD_PATH } from "./assemble";
import { bundleProject, checkProjectCompiles } from "./compile";

const require = createRequire(import.meta.url);

/** Bundle the game and server-render it, returning the HTML. */

/** The sample as an older game would have it: no preface, so play starts at once. */
const NO_PREFACE = (() => {
  const s = structuredClone(SAMPLE_STORY);
  delete s.meta.preface;
  return s;
})();

async function renderGame(files: Record<string, string>): Promise<string> {
  const r = await bundleProject(
    files,
    `import App from "/App.js"; import { renderToString } from "react-dom/server"; export default () => renderToString(<App />);`,
  );
  if (!r.ok) throw new Error(r.errors.join("\n"));
  const mod = { exports: {} as { default: () => string } };
  new Function("require", "module", "exports", r.code)(require, mod, mod.exports);
  return mod.exports.default();
}

describe("generated game project", () => {
  it("opens on the preface: background, who you play, and the cast", async () => {
    const html = await renderGame(assembleFiles({ story: SAMPLE_STORY }));
    expect(html).toContain("序 幕");
    expect(html).toContain(SAMPLE_STORY.meta.preface!);
    expect(html).toContain("你扮演");
    expect(html).toContain("你是一个寻找旧书的陌生人");
    expect(html).toContain("旧书店的老板"); // character intro
    expect(html).toContain("嘴硬"); // personality tags
    expect(html).toContain("拉开帷幕");
    expect(html).not.toContain("雨下得很大"); // the first scene waits behind the curtain
  });

  it("games without a preface start straight at the first scene", async () => {
    const html = await renderGame(assembleFiles({ story: NO_PREFACE }));
    expect(html).toContain("雨夜书店");
    expect(html).toContain("雨下得很大");
    expect(html).toContain("林晚的信任"); // default HUD shows the variable
  });

  it("shows the player's own lines as 你", async () => {
    const story = structuredClone(NO_PREFACE);
    story.nodes[0].lines = [{ speaker: "player", text: "我只是路过。" }, ...story.nodes[0].lines];
    const html = await renderGame(assembleFiles({ story }));
    expect(html).toContain("我只是路过。");
    expect(html).toMatch(/>你</);
  });

  it("reports syntax errors in a generated HUD", async () => {
    const files = { ...assembleFiles({ story: SAMPLE_STORY }), [HUD_PATH]: "export default function Hud( {" };
    const r = await checkProjectCompiles(files);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/Hud\.js/);
  });

  it("rejects imports of packages other than react", async () => {
    const files = {
      ...assembleFiles({ story: SAMPLE_STORY }),
      [HUD_PATH]: `import _ from "lodash"; export default function Hud() { return null; }`,
    };
    const r = await checkProjectCompiles(files);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("lodash");
  });

  it("accepts a valid custom HUD and renders it", async () => {
    const files = {
      ...assembleFiles({ story: NO_PREFACE }),
      [HUD_PATH]: `export default function Hud({ vars }) { return <div>信任值:{vars.trust_lin}</div>; }`,
    };
    expect((await checkProjectCompiles(files)).ok).toBe(true);
    expect(await renderGame(files)).toContain("信任值:<!-- -->0");
  });
});

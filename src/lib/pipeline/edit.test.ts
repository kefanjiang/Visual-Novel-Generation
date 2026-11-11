import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { assignedIds, createFakeModels, FIXTURES, type FakeModels } from "@/test/fakeModels";
import type { Db } from "@/lib/db/types";
import { createRun, getProject, getVersion, listMessages, listVersions } from "@/lib/db/repo";
import { Story, type Skeleton } from "@/lib/story/schema";
import { SAMPLE_STORY } from "@/lib/story/sample";
import { storyToSkeleton } from "@/lib/story/skeleton";
import { checkProjectCompiles } from "@/lib/template/compile";
import { STORY_PATH, THEME_PATH } from "@/lib/template/assemble";
import { advanceRun, type Deps } from "./runner";
import { startGeneration } from "./start";
import { EditError, remixProject, restoreVersion, saveManualEdit, startEdit } from "./edit";

let db: Db;
let models: FakeModels;
let deps: Deps;

beforeEach(async () => {
  db = await createTestDb();
  models = createFakeModels();
  deps = { models, compile: checkProjectCompiles };
});

async function drive(runId: string) {
  const stages: string[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await advanceRun(db, runId, deps);
    stages.push(r.stage);
    if (r.status !== "running") return { last: r, stages };
  }
  throw new Error("did not finish");
}

async function generated(owner = "o_me") {
  const { project, run } = await startGeneration(db, { owner, prompt: "雨夜书店" });
  await drive(run.id);
  models.calls.length = 0;
  return project;
}

/** Writers that actually change the text they are asked to rewrite (the default fixture returns it unchanged). */
function useEditingWriters() {
  models = createFakeModels({
    writer: (user) => {
      const out = FIXTURES.writer(assignedIds(user));
      if (!user.includes("用户的修改要求") && !user.includes("需要修正的问题")) return out;
      for (const n of out.nodes) {
        n.lines = n.lines.map((l) => ({ ...l, text: l.text + "（改）" }));
        if (n.epilogue !== undefined && n.id.startsWith("e_")) n.epilogue = "真凶另有其人，你被推出来顶了罪。";
      }
      return out;
    },
  });
  deps = { models, compile: checkProjectCompiles };
}

const currentStory = async (projectId: string) => {
  const p = await getProject(db, projectId);
  const v = await getVersion(db, p!.currentVersionId!);
  return { v: v!, story: Story.parse(v!.story) };
};

describe("chat edits", () => {
  it("text edit: router targets the character's nodes, only those writers rewrite, v2 is saved", async () => {
    const p = await generated();
    useEditingWriters();
    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "让林晚说话更冷淡" });
    const { last, stages } = await drive(run.id);
    expect(last.status).toBe("done");
    expect(stages).toEqual(["edit_text", "validate", "assemble", "done"]);

    const rewritten = models.calls.filter((c) => c.agent === "writer").flatMap((c) => assignedIds(c.user)).sort();
    const linNodes = SAMPLE_STORY.nodes.filter((n) => n.lines.some((l) => l.speaker === "lin")).map((n) => n.id).sort();
    expect(rewritten).toEqual(linNodes);
    expect(models.calls.find((c) => c.agent === "writer")!.user).toContain("林晚的台词更短");

    const { v } = await currentStory(p.id);
    expect(v).toMatchObject({ n: 2, source: "chat_edit", summary: "林晚更冷淡" });
    const msgs = await listMessages(db, p.id);
    expect(msgs.some((m) => m.agent === "producer" && m.content.includes("交给编剧"))).toBe(true);
    expect(msgs.at(-1)?.content).toContain("v2：林晚更冷淡");
    expect(msgs.at(-1)?.content).toMatch(/改动：.*n1/);
  });

  it("@Kai with a style request: Kai handles it himself", async () => {
    const p = await generated();
    models.queue("router", { kind: "style", reply: "换成暖色调", nodeIds: [], characterIds: [], instructions: "换成暖色调", summary: "暖色调" });
    models.queue("engineer", { ...FIXTURES.engineer(), themeCss: ":root { --sg-accent: #ff9966; }" });
    const { run, mention } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "@Kai 换成暖色调" });
    expect(mention).toBe("engineer");
    const { stages } = await drive(run.id);
    expect(stages).toEqual(["edit_style", "assemble", "done"]);
    const msgs = await listMessages(db, p.id);
    expect(msgs.some((m) => m.agent === "engineer" && m.content.startsWith("收到，我来改"))).toBe(true);
    expect(msgs.at(-1)?.content).toContain("界面配色");
    expect(models.calls.find((c) => c.agent === "engineer")!.user).toContain("换成暖色调");
    const { v } = await currentStory(p.id);
    expect(v.files[THEME_PATH]).toContain("#ff9966");
  });

  it("structure edit: architect patches the skeleton, only changed nodes are rewritten", async () => {
    const p = await generated();
    models.queue("router", { kind: "structure", reply: "加一个结局", nodeIds: [], characterIds: [], instructions: "在 n5 增加一个新结局", summary: "新增结局" });
    const sk: Skeleton = storyToSkeleton(SAMPLE_STORY, { n1: "a", n2: "a", n3: "a", n4: "b", n5: "b", e_bad: "b", n6: "c", e_good: "c", e_secret: "c" });
    const n5 = sk.nodes.find((n) => n.id === "n5")!;
    n5.choices.push({ intent: "跟上沈先生", next: "e_shadow", condition: null, effects: [] });
    sk.nodes.push({ id: "e_shadow", type: "ending", chapter: 3, owner: "b", bg: "雨夜·巷口", summary: "你跟着沈先生走进了雨里", endingKind: "neutral", endingTitle: "雨中人", choices: [] });
    models.queue("architect", sk);
    models.queue("writer", {
      nodes: [
        { id: "n5", lines: SAMPLE_STORY.nodes.find((n) => n.id === "n5")!.lines, choiceTexts: ["把纸条交给林晚。", "自己收起纸条离开。", "追出去。"], epilogue: null },
        { id: "e_shadow", lines: [{ speaker: null, text: "你追进雨里，礼帽在街角一闪而过。" }], choiceTexts: [], epilogue: "你没追上他，但记住了那顶礼帽。" },
      ],
    });

    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "在纸条那里加一个新结局" });
    const { last, stages } = await drive(run.id);
    expect(last.status).toBe("done");
    const { listEvents } = await import("@/lib/db/repo");
    const vals = (await listEvents(db, run.id)).filter((e) => e.type === "validation");
    expect(vals).toHaveLength(1);
    expect((vals[0].payload as { errors: unknown[] }).errors).toEqual([]);
    expect(stages).toEqual(["edit_skeleton", "edit_write", "validate", "assemble", "done"]);
    expect(models.calls.filter((c) => c.agent === "architect")).toHaveLength(1);
    const writerCalls = models.calls.filter((c) => c.agent === "writer");
    expect(writerCalls.flatMap((c) => assignedIds(c.user)).sort()).toEqual(["e_shadow", "n5"]);

    const { story } = await currentStory(p.id);
    expect(story.nodes).toHaveLength(10);
    expect(story.nodes.find((n) => n.id === "e_shadow")).toBeTruthy();
    // untouched nodes keep their text
    expect(story.nodes.find((n) => n.id === "n1")!.lines).toEqual(SAMPLE_STORY.nodes[0].lines);
  });

  it("a question gets an answer and no new version", async () => {
    const p = await generated();
    models.queue("router", { kind: "question", reply: "目前有 3 个结局。", nodeIds: [], characterIds: [], instructions: "无", summary: "提问" });
    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "现在有几个结局？" });
    const { stages } = await drive(run.id);
    expect(stages).toEqual(["done"]);
    expect(await listVersions(db, p.id)).toHaveLength(1);
    expect((await listMessages(db, p.id)).at(-1)?.content).toBe("目前有 3 个结局。");
  });

  it("@Iris reviews; issues lead to a revised version, no issues leave it unchanged", async () => {
    const p = await generated();
    useEditingWriters();
    const r1 = await startEdit(db, { projectId: p.id, owner: "o_me", text: "@Iris 帮我检查一下" });
    expect((await drive(r1.run.id)).stages).toEqual(["edit_review", "done"]);
    expect(await listVersions(db, p.id)).toHaveLength(1);

    models.queue("reviewer", { issues: [{ nodeId: "n2", problem: "转折生硬", suggestion: "加一句过渡" }] });
    const r2 = await startEdit(db, { projectId: p.id, owner: "o_me", text: "@审校 再看看" });
    expect((await drive(r2.run.id)).stages).toEqual(["edit_review", "revise", "validate", "assemble", "done"]);
    expect((await currentStory(p.id)).v.summary).toBe("按审校意见润色");
  });

  it("guards: owner only, one run at a time, non-empty, needs a version", async () => {
    const p = await generated();
    await expect(startEdit(db, { projectId: p.id, owner: "o_other", text: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(startEdit(db, { projectId: p.id, owner: "o_me", text: " " })).rejects.toMatchObject({ status: 400 });
    await createRun(db, { projectId: p.id, kind: "edit", stage: "route" });
    await expect(startEdit(db, { projectId: p.id, owner: "o_me", text: "x" })).rejects.toMatchObject({ status: 409 });
    const fresh = await startGeneration(db, { owner: "o_me", prompt: "y" });
    await expect(startEdit(db, { projectId: fresh.project.id, owner: "o_me", text: "x" })).rejects.toBeInstanceOf(EditError);
  });
});

describe("versions, manual edits and remix", () => {
  it("restore saves an old version as the newest one", async () => {
    const p = await generated();
    useEditingWriters();
    const r = await startEdit(db, { projectId: p.id, owner: "o_me", text: "让林晚说话更冷淡" });
    await drive(r.run.id);
    const versions = await listVersions(db, p.id);
    const v1 = versions.find((v) => v.n === 1)!;
    const v3 = await restoreVersion(db, { projectId: p.id, owner: "o_me", versionId: v1.id });
    expect(v3).toMatchObject({ n: 3, source: "restore", summary: "恢复到 v1" });
    expect(v3.files).toEqual((await getVersion(db, v1.id))!.files);
    await expect(restoreVersion(db, { projectId: p.id, owner: "o_me", versionId: "v_nope" })).rejects.toMatchObject({ status: 404 });
  });

  it("manual edits must keep story.json valid and the code compiling", async () => {
    const p = await generated();
    const { v } = await currentStory(p.id);
    const story = JSON.parse(v.files[STORY_PATH]);
    story.nodes[0].lines[0].text = "雨更大了。";
    const saved = await saveManualEdit(db, { projectId: p.id, owner: "o_me", files: { [STORY_PATH]: JSON.stringify(story) } }, checkProjectCompiles);
    expect(saved).toMatchObject({ n: 2, source: "manual_edit" });
    expect((saved.story as { nodes: { lines: { text: string }[] }[] }).nodes[0].lines[0].text).toBe("雨更大了。");

    await expect(saveManualEdit(db, { projectId: p.id, owner: "o_me", files: { [STORY_PATH]: "{oops" } })).rejects.toMatchObject({ status: 400 });
    story.nodes[1].choices[0].next = "nowhere";
    await expect(saveManualEdit(db, { projectId: p.id, owner: "o_me", files: { [STORY_PATH]: JSON.stringify(story) } })).rejects.toThrow(/校验/);
    await expect(
      saveManualEdit(db, { projectId: p.id, owner: "o_me", files: { "/components/Hud.js": "export default (" } }, checkProjectCompiles),
    ).rejects.toThrow(/编译/);
  });

  it("remix copies the current version into a new project the visitor owns", async () => {
    const p = await generated("o_author");
    const copy = await remixProject(db, { projectId: p.id, owner: "o_visitor" });
    expect(copy).toMatchObject({ owner: "o_visitor", forkedFrom: p.id, title: "雨夜书店" });
    const versions = await listVersions(db, copy.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].source).toBe("remix");
    const { run } = await startEdit(db, { projectId: copy.id, owner: "o_visitor", text: "让林晚说话更冷淡" });
    expect((await drive(run.id)).last.status).toBe("done");
    expect(await listVersions(db, p.id)).toHaveLength(1); // original untouched
  });
});

describe("stableStringify", () => {
  it("ignores key order, keeps array order", async () => {
    const { stableStringify } = await import("./runner");
    expect(stableStringify({ b: 1, a: { d: [2, 1], c: null } })).toBe(stableStringify({ a: { c: null, d: [2, 1] }, b: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

});

describe("routing and change reports", () => {
  it("@Kai asked to change story text: Mira explains and hands it to the writers", async () => {
    const p = await generated();
    useEditingWriters();
    models.queue("router", {
      kind: "text",
      reply: "这是改结局文字，交给编剧在结局说明里写明白。",
      nodeIds: ["e_bad"],
      characterIds: [],
      instructions: "在结局说明里直接写明：真凶另有其人，你被当成替罪羊",
      summary: "结局点明真凶",
    });
    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "@Kai 结局下面写清楚真凶另有其人" });
    const { stages } = await drive(run.id);
    expect(stages).toEqual(["edit_text", "validate", "assemble", "done"]);
    expect(models.calls.some((c) => c.agent === "engineer")).toBe(false);
    const w = models.calls.find((c) => c.agent === "writer")!;
    expect(w.user).toContain("用户的修改要求（原话：「@Kai 结局下面写清楚真凶另有其人」）");
    const msgs = await listMessages(db, p.id);
    expect(msgs.some((m) => m.agent === "producer" && m.content.includes("Kai 做不了"))).toBe(true);
    const { story } = await currentStory(p.id);
    const ending = story.nodes.find((n) => n.id === "e_bad");
    expect(ending?.type === "ending" && ending.epilogue).toBe("真凶另有其人，你被推出来顶了罪。");
    expect(msgs.at(-1)?.content).toContain("结局说明");
  });

  it("an edit that changes nothing says so and keeps the version", async () => {
    const p = await generated();
    // default writers return the text unchanged
    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "让林晚说话更冷淡" });
    const { stages } = await drive(run.id);
    expect(stages.at(-1)).toBe("done");
    expect(await listVersions(db, p.id)).toHaveLength(1);
    expect((await listMessages(db, p.id)).at(-1)?.content).toContain("没有产生任何改动");
  });

  it("a change only to the README is reported as invisible in the game", async () => {
    const p = await generated();
    models.queue("router", { kind: "style", reply: "改说明", nodeIds: [], characterIds: [], instructions: "改 README", summary: "改说明" });
    models.queue("engineer", { ...FIXTURES.engineer(), readme: "# 新说明" });
    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "改一下说明文字" });
    await drive(run.id);
    expect(await listVersions(db, p.id)).toHaveLength(2);
    expect((await listMessages(db, p.id)).at(-1)?.content).toContain("游戏画面里看不到变化");
  });

  it("'write under the ending': only the named ending is rewritten and its epilogue is set", async () => {
    const p = await generated();
    useEditingWriters();
    // the router forgets to name the node; the ending title in the user's words is enough
    models.queue("router", { kind: "text", reply: "好的", nodeIds: [], characterIds: [], instructions: "写清楚真凶另有其人", summary: "结局说明" });
    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "在「雨中离去」这个结局下面写一段话：真凶另有其人，我被当成替罪羊" });
    await drive(run.id);
    const rewritten = models.calls.filter((c) => c.agent === "writer").flatMap((c) => assignedIds(c.user));
    expect(rewritten).toEqual(["e_bad"]);
    expect(models.calls.find((c) => c.agent === "writer")!.user).toContain("输出非空的 epilogue");
    const { story } = await currentStory(p.id);
    const e = story.nodes.find((n) => n.id === "e_bad");
    expect(e?.type === "ending" && e.epilogue).toBe("真凶另有其人，你被推出来顶了罪。");
  });

  it("a misrouted ending-note request (style/structure) still goes to the writers", async () => {
    const p = await generated();
    useEditingWriters();
    models.queue("router", { kind: "structure", reply: "加节点", nodeIds: ["e_bad"], characterIds: [], instructions: "在结局后加一个说明节点", summary: "结局说明" });
    const { run } = await startEdit(db, { projectId: p.id, owner: "o_me", text: "每个结局下面加一段说明" });
    const { stages } = await drive(run.id);
    expect(stages[0]).toBe("edit_text");
    expect(models.calls.some((c) => c.agent === "architect" || c.agent === "engineer")).toBe(false);
    const msgs = await listMessages(db, p.id);
    expect(msgs.some((m) => m.content.includes("交给编剧来写"))).toBe(true);
  });

  it("if the writer skips the epilogue it is asked once more; a second miss is reported", async () => {
    const p = await generated();
    useEditingWriters();
    const unchanged = FIXTURES.writer(["e_bad"]);
    models.queue("router", { kind: "text", reply: "好", nodeIds: ["e_bad"], characterIds: [], instructions: "结局说明：写明真凶另有其人", summary: "结局说明" });
    models.queue("writer", unchanged); // first try: no epilogue
    const r1 = await startEdit(db, { projectId: p.id, owner: "o_me", text: "结局下面写清楚" });
    await drive(r1.run.id);
    const calls = models.calls.filter((c) => c.agent === "writer");
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain("上一次你没有写或没有修改 epilogue");
    let { story } = await currentStory(p.id);
    let e = story.nodes.find((n) => n.id === "e_bad");
    expect(e?.type === "ending" && e.epilogue).toBeTruthy();

    // second request, both tries miss
    models.queue("router", { kind: "text", reply: "好", nodeIds: ["e_good"], characterIds: [], instructions: "结局说明", summary: "结局说明" });
    models.queue("writer", FIXTURES.writer(["e_good"]));
    models.queue("writer", FIXTURES.writer(["e_good"]));
    const r2 = await startEdit(db, { projectId: p.id, owner: "o_me", text: "迟到的结案这个结局下面也写一段说明" });
    await drive(r2.run.id);
    ({ story } = await currentStory(p.id));
    e = story.nodes.find((n) => n.id === "e_good");
    expect(e?.type === "ending" && e.epilogue).toBeFalsy();
    expect((await listMessages(db, p.id)).at(-1)?.content).toContain("编剧没能写出结局说明");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createFakeModels, FIXTURES, type FakeModels } from "@/test/fakeModels";
import type { Db } from "@/lib/db/types";
import { acquireLease, getProject, getRun, getVersion, listEvents, listMessages } from "@/lib/db/repo";
import { checkProjectCompiles } from "@/lib/template/compile";
import { HUD_PATH, STORY_PATH } from "@/lib/template/assemble";
import { TEMPLATE_FILES } from "@/lib/template/generated";
import { Story } from "@/lib/story/schema";
import { advanceRun, retryRun, type Deps } from "./runner";
import { startGeneration } from "./start";

let db: Db;
let models: FakeModels;
let deps: Deps;

beforeEach(async () => {
  db = await createTestDb();
  models = createFakeModels();
  deps = { models, compile: checkProjectCompiles };
});

async function runToEnd(runId: string, max = 30) {
  const stages: string[] = [];
  for (let i = 0; i < max; i++) {
    const r = await advanceRun(db, runId, deps);
    stages.push(r.stage);
    if (r.status !== "running") return { last: r, stages };
  }
  throw new Error(`run did not finish: ${stages.join(" > ")}`);
}

describe("generation pipeline", () => {
  it("happy path: plan → cast → skeleton → plot review → write → review → validate → assemble", async () => {
    const { project, run } = await startGeneration(db, { owner: "o_a", prompt: "雨夜书店的悬疑故事" });
    const { last, stages } = await runToEnd(run.id);

    expect(last.status).toBe("done");
    expect(stages).toEqual(["cast", "skeleton", "plot_review", "write", "review", "validate", "assemble", "done"]);

    const p = await getProject(db, project.id);
    expect(p?.title).toBe("雨夜书店");
    const v = await getVersion(db, p!.currentVersionId!);
    expect(v?.n).toBe(1);
    expect(Story.parse(JSON.parse(v!.files[STORY_PATH])).nodes).toHaveLength(9);
    expect(v!.files[HUD_PATH]).toContain("信任");
    expect((await checkProjectCompiles(v!.files)).ok).toBe(true);

    const events = await listEvents(db, run.id);
    const writersStarted = events.filter((e) => e.type === "started" && e.agent.startsWith("writer_")).map((e) => e.agent);
    expect(writersStarted.sort()).toEqual(["writer_a", "writer_b", "writer_c"]);
    expect(events.some((e) => e.type === "graph")).toBe(true);
    expect(events.some((e) => e.type === "version")).toBe(true);

    const msgs = await listMessages(db, project.id);
    expect(msgs[0]).toMatchObject({ role: "user", content: "雨夜书店的悬疑故事" });
    expect(msgs.map((m) => m.agent)).toEqual(expect.arrayContaining(["producer", "cast", "architect", "reviewer", "system"]));
    expect(msgs.at(-1)?.versionId).toBe(v!.id);
    expect(msgs.some((m) => m.content.includes("自动试玩 200 局"))).toBe(true);

    const finalRun = await getRun(db, run.id);
    expect((finalRun!.state as { tokens: number }).tokens).toBeGreaterThan(0);
    expect(models.calls.map((c) => c.agent).filter((a) => a === "writer")).toHaveLength(3);
  });

  it("broken skeleton goes back to the architect with the validator's errors", async () => {
    const broken = FIXTURES.skeleton();
    broken.nodes[1].choices[0].next = "n99";
    models.queue("architect", broken);
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const { last, stages } = await runToEnd(run.id);
    expect(last.status).toBe("done");
    expect(stages.slice(0, 5)).toEqual(["cast", "skeleton", "skeleton", "plot_review", "write"]);
    const archCalls = models.calls.filter((c) => c.agent === "architect");
    expect(archCalls).toHaveLength(2);
    expect(archCalls[1].user).toContain("n99");
  });

  it("gives up after repeated broken skeletons", async () => {
    const broken = FIXTURES.skeleton();
    broken.nodes[1].choices[0].next = "n99";
    for (let i = 0; i < 3; i++) models.queue("architect", broken);
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const { last } = await runToEnd(run.id);
    expect(last.status).toBe("failed");
    expect(last.error).toContain("结构校验");
  });

  it("text problems are routed back to the owning writer only", async () => {
    const bad = FIXTURES.writer(["n1", "n2", "n3"]);
    bad.nodes[0].lines[0].text = "TODO 开场白";
    models.queue("writer", bad); // first writer call (writer a)
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const { last, stages } = await runToEnd(run.id);
    expect(last.status).toBe("done");
    expect(stages).toContain("fix");
    const writerCalls = models.calls.filter((c) => c.agent === "writer");
    const fixCall = writerCalls[3];
    expect(fixCall.user).toContain("ASSIGNED_IDS: n1");
    expect(fixCall.user).toContain("占位");
    expect(writerCalls).toHaveLength(4);
  });

  it("reviewer issues trigger a revise round for that node's writer", async () => {
    models.queue("reviewer", { issues: [{ nodeId: "n6", problem: "林晚语气太热情", suggestion: "改得更克制" }] });
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const { last, stages } = await runToEnd(run.id);
    expect(last.status).toBe("done");
    expect(stages).toContain("revise");
    const revise = models.calls.filter((c) => c.agent === "writer").at(-1)!;
    expect(revise.user).toContain("ASSIGNED_IDS: n6");
    expect(revise.user).toContain("改得更克制");
  });

  it("a HUD that will not compile is retried once, then replaced by the default", async () => {
    const badHud = { ...FIXTURES.engineer(), hudJs: "export default function Hud( {" };
    models.queue("engineer", badHud);
    models.queue("engineer", badHud);
    const { project, run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    await runToEnd(run.id);
    const v = await getVersion(db, (await getProject(db, project.id))!.currentVersionId!);
    expect(v!.files[HUD_PATH]).toBe(TEMPLATE_FILES[HUD_PATH]);
    expect(v!.files["/theme.css"]).toContain("--sg-accent");
    expect((await listMessages(db, project.id)).at(-1)?.content).toContain("换回默认组件");
  });

  it("a model failure fails the stage; retry resumes from that stage", async () => {
    models.queue("cast", new Error("upstream 529 overloaded"));
    const { project, run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const first = await runToEnd(run.id);
    expect(first.last).toMatchObject({ status: "failed", stage: "cast" });
    expect((await listMessages(db, project.id)).at(-1)?.content).toContain("重试这一步");

    expect(await retryRun(db, run.id)).toBe(true);
    const second = await runToEnd(run.id);
    expect(second.last.status).toBe("done");
    expect(second.stages[0]).toBe("skeleton");
  });

  it("concurrent advance calls: only the lease holder works", async () => {
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    await acquireLease(db, run.id, 60_000);
    const r = await advanceRun(db, run.id, deps);
    expect(r).toMatchObject({ busy: true, stage: "plan" });
    expect(models.calls).toHaveLength(0);
  });

  it("rejects empty prompts and truncates long ones", async () => {
    await expect(startGeneration(db, { owner: "o", prompt: "   " })).rejects.toThrow();
    const { project } = await startGeneration(db, { owner: "o", prompt: "长".repeat(800) });
    expect(project.prompt).toHaveLength(500);
  });
});

describe("plot review (Iris reads the skeleton before writing)", () => {
  it("sends a dull skeleton back to Ada once, with Iris's notes, then writes", async () => {
    models.queue("plot_reviewer", {
      verdict: "revise",
      highlights: "开场的雨夜很有气氛。",
      issues: [{ nodeId: "n2", problem: "这一场没有推进", suggestion: "让林晚在这里说漏一个细节" }],
    });
    const { project, run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const { last, stages } = await runToEnd(run.id);
    expect(last.status).toBe("done");
    expect(stages.slice(0, 5)).toEqual(["cast", "skeleton", "plot_review", "skeleton", "write"]);

    const arch = models.calls.filter((c) => c.agent === "architect");
    expect(arch).toHaveLength(2);
    expect(arch[1].user).toContain("让林晚在这里说漏一个细节");
    expect(arch[1].user).toContain("你上一版的骨架");
    // Iris gets exactly one look, even after the revision.
    expect(models.calls.filter((c) => c.agent === "plot_reviewer")).toHaveLength(1);

    const msgs = await listMessages(db, project.id);
    expect(msgs.some((m) => m.agent === "reviewer" && m.content.includes("退回 Ada"))).toBe(true);
    expect(msgs.some((m) => m.agent === "architect" && m.content.includes("按 Iris 的意见"))).toBe(true);
  });

  it("keeps the approved skeleton when the revision breaks the structure", async () => {
    models.queue("plot_reviewer", { verdict: "revise", highlights: "h", issues: [{ nodeId: null, problem: "p", suggestion: "s" }] });
    models.queue("architect", FIXTURES.skeleton()); // first draft: fine
    const broken = FIXTURES.skeleton();
    broken.nodes[1].choices[0].next = "n99";
    models.queue("architect", broken); // revision: broken
    const { project, run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const { last, stages } = await runToEnd(run.id);
    expect(last.status).toBe("done");
    expect(stages.slice(0, 5)).toEqual(["cast", "skeleton", "plot_review", "skeleton", "write"]);
    expect(models.calls.filter((c) => c.agent === "architect")).toHaveLength(2);
    const msgs = await listMessages(db, project.id);
    expect(msgs.some((m) => m.content.includes("沿用上一版骨架"))).toBe(true);
  });

  it("a failed read-through does not block the run", async () => {
    models.queue("plot_reviewer", new Error("overloaded"));
    models.queue("plot_reviewer", new Error("overloaded"));
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    const { last, stages } = await runToEnd(run.id);
    expect(last.status).toBe("done");
    expect(stages.slice(0, 4)).toEqual(["cast", "skeleton", "plot_review", "write"]);
  });

  it("writers get the player's identity and the story's hidden truth", async () => {
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    await runToEnd(run.id);
    const w = models.calls.find((c) => c.agent === "writer")!;
    expect(w.user).toContain("玩家（你）：你是一个寻找旧书的陌生人");
    expect(w.user).toContain("hiddenTruth");
  });

  it("the finished story carries the preface, the player and the premise", async () => {
    const { project, run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    await runToEnd(run.id);
    const v = await getVersion(db, (await getProject(db, project.id))!.currentVersionId!);
    const story = Story.parse(JSON.parse(v!.files[STORY_PATH]));
    expect(story.meta.preface).toBe(FIXTURES.spec().preface);
    expect(story.meta.player).toEqual(FIXTURES.spec().player);
    expect(story.meta.premise?.hiddenTruth).toContain("沈先生");
  });

  it("renames a character that took the reserved id 'player'", async () => {
    const cast = FIXTURES.cast();
    cast.characters[1].id = "player";
    models.queue("cast", cast);
    const sk = FIXTURES.skeleton();
    models.queue("architect", sk);
    const { run } = await startGeneration(db, { owner: "o_a", prompt: "x" });
    // Only need the cast stage.
    await advanceRun(db, run.id, deps);
    await advanceRun(db, run.id, deps);
    const state = (await getRun(db, run.id))!.state as { cast: { id: string }[] };
    expect(state.cast.map((c) => c.id)).toEqual(["lin", "npc_2"]);
  });
});

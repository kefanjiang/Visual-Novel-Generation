import { describe, expect, it } from "vitest";
import { createFakeModels, FIXTURES } from "@/test/fakeModels";
import { callAgent, runArchitect, runProducer, runWriter } from "./agents";
import { Spec } from "@/lib/story/schema";

describe("callAgent", () => {
  it("returns typed output and counts tokens", async () => {
    const m = createFakeModels();
    const r = await runProducer(m, "做一个雨夜书店的悬疑游戏");
    expect(r.output.title).toBe("雨夜书店");
    expect(r.tokens).toBe(150);
    expect(m.calls[0]).toMatchObject({ agent: "producer" });
    expect(m.calls[0].user).toContain("雨夜书店");
  });

  it("retries once with the schema error when the model returns bad JSON", async () => {
    const m = createFakeModels();
    m.queue("producer", { title: 123 });
    const r = await callAgent(m.strong, Spec, "[agent:producer]", "x");
    expect(r.output.characterCount).toBe(2);
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1].user).toContain("上一次输出不符合格式要求");
  });

  it("gives up after the second schema miss", async () => {
    const m = createFakeModels();
    m.queue("producer", { nope: 1 });
    m.queue("producer", { nope: 2 });
    await expect(callAgent(m.strong, Spec, "[agent:producer]", "x")).rejects.toThrow();
  });
});

describe("agent prompts", () => {
  it("architect receives feedback and its previous draft", async () => {
    const m = createFakeModels();
    const prev = FIXTURES.skeleton();
    await runArchitect(m, FIXTURES.spec(), FIXTURES.cast().characters, ["[n2] 选项 1 指向不存在的节点 n99"], prev);
    expect(m.calls[0].user).toContain("需要修正的问题");
    expect(m.calls[0].user).toContain("n99");
    expect(m.calls[0].user).toContain("你上一版的骨架");
  });

  it("writer only sees its own nodes plus neighbour summaries", async () => {
    const m = createFakeModels();
    const r = await runWriter(m, "b", { spec: FIXTURES.spec(), cast: FIXTURES.cast().characters, skeleton: FIXTURES.skeleton() });
    expect(m.calls[0].user).toContain("ASSIGNED_IDS: n4,n5,e_bad");
    expect(m.calls[0].user).toContain("相邻节点梗概");
    expect(r.output.nodes.map((n) => n.id)).toEqual(["n4", "n5", "e_bad"]);
  });
});

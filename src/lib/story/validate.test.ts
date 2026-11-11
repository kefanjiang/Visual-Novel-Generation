import { describe, expect, it } from "vitest";
import { SAMPLE_STORY } from "./sample";
import type { Story } from "./schema";
import { groupByOwner, validateStory } from "./validate";

const clone = (): Story => structuredClone(SAMPLE_STORY);
const scene = (s: Story, id: string) => {
  const n = s.nodes.find((x) => x.id === id);
  if (!n || n.type !== "scene") throw new Error(`no scene ${id}`);
  return n;
};
const rules = (s: unknown, owners?: Record<string, string>) => validateStory(s, { owners }).errors.map((e) => e.rule);

describe("validateStory", () => {
  it("accepts the sample and reports stats", () => {
    const r = validateStory(SAMPLE_STORY);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stats?.nodes).toBe(9);
    expect(r.stats?.endings).toBe(3);
  });

  it("schema errors carry the node id", () => {
    const s = clone() as unknown as { nodes: { id: string; lines: unknown[] }[] };
    s.nodes[2].lines = [];
    const r = validateStory(s);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ rule: "schema", nodeId: "n3", owner: "architect" });
  });

  it("missing next target is a reference error owned by the architect", () => {
    const s = clone();
    scene(s, "n2").choices[0].next = "n99";
    const r = validateStory(s);
    expect(r.errors).toContainEqual(expect.objectContaining({ rule: "reference", nodeId: "n2", owner: "architect" }));
  });

  it("unknown speaker goes back to that node's writer", () => {
    const s = clone();
    s.nodes[0].lines[1].speaker = "ghost";
    const r = validateStory(s, { owners: { n1: "b" } });
    expect(r.errors).toContainEqual(expect.objectContaining({ rule: "reference", nodeId: "n1", owner: "writer:b" }));
  });

  it("undefined variables in conditions and effects", () => {
    const s = clone();
    scene(s, "n4").choices[0].condition = { var: "fear", op: ">=", value: 1 };
    expect(rules(s)).toContain("reference");
  });

  it("a scene whose choices are all conditional is stuck", () => {
    const s = clone();
    for (const c of scene(s, "n6").choices) c.condition = { var: "trust_lin", op: ">=", value: 1 };
    expect(validateStory(s).errors).toContainEqual(expect.objectContaining({ rule: "stuck", nodeId: "n6" }));
  });

  it("orphan nodes are unreachable", () => {
    const s = clone();
    s.nodes.push({ id: "n_orphan", type: "scene", bg: "x", lines: [{ speaker: null, text: "无人到达" }], choices: [{ text: "回去", next: "n1", condition: null, effects: [] }] });
    expect(validateStory(s).errors).toContainEqual(expect.objectContaining({ rule: "reachability", nodeId: "n_orphan" }));
  });

  it("an ending behind an impossible condition is reported", () => {
    const s = clone();
    scene(s, "n6").choices[0].condition = { var: "trust_lin", op: ">=", value: 9 }; // max is 5
    const r = validateStory(s);
    expect(r.errors).toContainEqual(expect.objectContaining({ rule: "reachability", nodeId: "e_secret" }));
    expect(r.errors[0].message).toContain("旧信");
  });

  it("a loop with no exit is reported as a trap", () => {
    const s = clone();
    // n4 and n6 only point at each other once the player is inside
    scene(s, "n4").choices = [{ text: "继续", next: "n6", condition: null, effects: [] }];
    scene(s, "n6").choices = [{ text: "回头", next: "n4", condition: null, effects: [] }];
    // keep endings reachable from elsewhere so only the trap fires
    scene(s, "n5").choices.push({ text: "报警", next: "e_good", condition: null, effects: [] });
    scene(s, "n2").choices.push({ text: "上楼", next: "e_secret", condition: null, effects: [] });
    const trapped = validateStory(s).errors.filter((e) => e.message.includes("循环")).map((e) => e.nodeId);
    expect(trapped).toEqual(["n4", "n6"]);
  });

  it("placeholders and duplicate choices are text errors for the writer", () => {
    const s = clone();
    s.nodes[0].lines[0].text = "TODO 这里写开场";
    scene(s, "n2").choices[1].text = scene(s, "n2").choices[0].text;
    const r = validateStory(s, { owners: { n1: "a", n2: "c" } });
    expect(r.errors).toContainEqual(expect.objectContaining({ rule: "text", nodeId: "n1", owner: "writer:a" }));
    expect(r.errors).toContainEqual(expect.objectContaining({ rule: "text", nodeId: "n2", owner: "writer:c" }));
  });

  it("legitimate ellipses are not placeholders", () => {
    const s = clone();
    s.nodes[0].lines[1].text = "我们……打烊了...";
    expect(validateStory(s).ok).toBe(true);
  });

  it("checks scale against the spec", () => {
    const r = validateStory(SAMPLE_STORY, { spec: { nodeTarget: 25, endingCount: 3, characterCount: 3 } });
    const msgs = r.errors.map((e) => e.message).join("\n");
    expect(msgs).toContain("节点数 9");
    expect(msgs).toContain("角色数 2");
    expect(validateStory(SAMPLE_STORY, { spec: { nodeTarget: 12, endingCount: 3, characterCount: 2 } }).ok).toBe(true);
  });

  it("rejects variables with huge ranges and caps the state search", () => {
    const s = clone();
    s.variables[0].max = 100;
    expect(validateStory(s).errors).toContainEqual(expect.objectContaining({ rule: "scale" }));
    expect(validateStory(SAMPLE_STORY, { maxStates: 3 }).errors[0].message).toContain("状态空间");
  });

  it("groups errors by owner", () => {
    const s = clone();
    s.nodes[0].lines[0].text = "TODO";
    scene(s, "n2").choices[0].next = "n99";
    const groups = groupByOwner(validateStory(s, { owners: { n1: "b" } }).errors);
    expect([...groups.keys()].sort()).toEqual(["architect", "writer:b"]);
  });
});

describe("player speaker", () => {
  it("accepts lines spoken by the player and reserves the id", () => {
    const s = structuredClone(SAMPLE_STORY);
    s.nodes[0].lines.push({ speaker: "player", text: "我只是来躲雨的。" });
    expect(validateStory(s).ok).toBe(true);
    s.characters[1].id = "player";
    const r = validateStory(s);
    expect(r.errors.some((e) => e.message.includes("留给玩家"))).toBe(true);
  });
});

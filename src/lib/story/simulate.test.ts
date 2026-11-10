import { describe, expect, it } from "vitest";
import { SAMPLE_STORY } from "./sample";
import type { Story } from "./schema";
import { describeSimulation, mulberry32, simulate } from "./simulate";

describe("simulate", () => {
  it("is deterministic for a seed", () => {
    expect(simulate(SAMPLE_STORY, 100, 7)).toEqual(simulate(SAMPLE_STORY, 100, 7));
    const r = mulberry32(1);
    const a = [r(), r(), r()];
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("random play reaches every ending of the sample and never gets stuck", () => {
    const r = simulate(SAMPLE_STORY, 200);
    expect(r.runs).toBe(200);
    expect(r.stuckRuns).toBe(0);
    expect(r.endingsTotal).toBe(3);
    expect(r.endingsReached).toBe(3);
    expect(Object.values(r.endingsHit).reduce((a, b) => a + b, 0)).toBe(200);
    expect(r.avgSteps).toBeGreaterThanOrEqual(2);
    expect(r.maxSteps).toBeLessThanOrEqual(6);
  });

  it("counts runs trapped in a loop as stuck", () => {
    const s: Story = structuredClone(SAMPLE_STORY);
    const n6 = s.nodes.find((n) => n.id === "n6")!;
    if (n6.type === "scene") n6.choices = [{ text: "回头", next: "n4", condition: null, effects: [] }];
    const n4 = s.nodes.find((n) => n.id === "n4")!;
    if (n4.type === "scene") n4.choices = [{ text: "继续", next: "n6", condition: null, effects: [] }];
    const r = simulate(s, 50, 1, 50);
    expect(r.stuckRuns).toBeGreaterThan(0);
    expect(describeSimulation(r)).toContain("未能结束");
  });

  it("describes results in one line", () => {
    expect(describeSimulation(simulate(SAMPLE_STORY, 200))).toMatch(/^自动试玩 200 局：3\/3 个结局/);
  });
});

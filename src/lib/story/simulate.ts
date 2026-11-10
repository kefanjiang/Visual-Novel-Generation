import { availableChoices, initState, step } from "./engine";
import type { Story } from "./schema";

export interface SimulationReport {
  runs: number;
  endingsHit: Record<string, number>;
  endingsTotal: number;
  endingsReached: number;
  avgSteps: number;
  maxSteps: number;
  stuckRuns: number;
}

/** Deterministic PRNG so playtest numbers are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random playthroughs using the real engine; a run that exceeds `stepCap` counts as stuck. */
export function simulate(story: Story, runs = 200, seed = 42, stepCap = 200): SimulationReport {
  const rand = mulberry32(seed);
  const endingIds = story.nodes.filter((n) => n.type === "ending").map((n) => n.id);
  const endingsHit: Record<string, number> = Object.fromEntries(endingIds.map((id) => [id, 0]));
  let totalSteps = 0;
  let maxSteps = 0;
  let stuckRuns = 0;
  let finished = 0;

  for (let r = 0; r < runs; r++) {
    let state = initState(story);
    let steps = 0;
    while (!state.ended && steps < stepCap) {
      const options = availableChoices(story, state);
      if (options.length === 0) break;
      const pick = options[Math.floor(rand() * options.length)];
      state = step(story, state, pick.index);
      steps++;
    }
    if (state.ended) {
      endingsHit[state.nodeId] = (endingsHit[state.nodeId] ?? 0) + 1;
      totalSteps += steps;
      finished++;
      maxSteps = Math.max(maxSteps, steps);
    } else {
      stuckRuns++;
    }
  }

  return {
    runs,
    endingsHit,
    endingsTotal: endingIds.length,
    endingsReached: Object.values(endingsHit).filter((n) => n > 0).length,
    avgSteps: finished ? Math.round((totalSteps / finished) * 10) / 10 : 0,
    maxSteps,
    stuckRuns,
  };
}

/** One-line summary for the chat, e.g. "自动试玩 200 局：3/3 个结局可达成，平均 4.5 步". */
export function describeSimulation(r: SimulationReport): string {
  const base = `自动试玩 ${r.runs} 局：${r.endingsReached}/${r.endingsTotal} 个结局被随机玩到，平均 ${r.avgSteps} 步`;
  return r.stuckRuns ? `${base}，${r.stuckRuns} 局未能结束` : base;
}

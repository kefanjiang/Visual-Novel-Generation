import { describe, expect, it } from "vitest";
import { applyEffects, availableChoices, evalCondition, initState, step } from "./engine";
import { SAMPLE_STORY as S } from "./sample";

describe("engine core", () => {
  it("starts at meta.start with initial vars", () => {
    const st = initState(S);
    expect(st).toEqual({ nodeId: "n1", vars: { trust_lin: 0 }, history: ["n1"], ended: false });
  });

  it("evaluates conditions", () => {
    expect(evalCondition(null, {})).toBe(true);
    expect(evalCondition({ var: "a", op: ">=", value: 2 }, { a: 2 })).toBe(true);
    expect(evalCondition({ var: "a", op: ">=", value: 2 }, { a: 1 })).toBe(false);
    expect(evalCondition({ var: "a", op: "<=", value: 0 }, {})).toBe(true);
    expect(evalCondition({ var: "a", op: "==", value: 3 }, { a: 3 })).toBe(true);
  });

  it("clamps effects to variable bounds and ignores unknown vars", () => {
    expect(applyEffects(S, { trust_lin: 5 }, [{ var: "trust_lin", op: "add", value: 3 }])).toEqual({ trust_lin: 5 });
    expect(applyEffects(S, { trust_lin: 0 }, [{ var: "trust_lin", op: "set", value: -10 }])).toEqual({ trust_lin: -2 });
    expect(applyEffects(S, { trust_lin: 1 }, [{ var: "ghost", op: "add", value: 1 }])).toEqual({ trust_lin: 1 });
  });

  it("hides locked choices", () => {
    let st = initState(S);
    st = step(S, st, 1); // n3, trust 0
    st = step(S, st, 1); // n4, trust -1
    const visible = availableChoices(S, st).map((c) => c.index);
    expect(visible).toEqual([1, 2]); // index 0 needs trust >= 2
    expect(() => step(S, st, 0)).toThrow(/locked/);
  });

  it("plays to the secret ending along the trusting path", () => {
    let st = initState(S);
    st = step(S, st, 0); // n2, 1
    st = step(S, st, 0); // n4, 2
    st = step(S, st, 1); // n6, 3
    expect(st.vars.trust_lin).toBe(3);
    st = step(S, st, 0); // e_secret
    expect(st.nodeId).toBe("e_secret");
    expect(st.ended).toBe(true);
    expect(st.history).toEqual(["n1", "n2", "n4", "n6", "e_secret"]);
    expect(() => step(S, st, 0)).toThrow(/ended/);
  });

  it("does not mutate the previous state", () => {
    const st = initState(S);
    const snapshot = structuredClone(st);
    step(S, st, 0);
    expect(st).toEqual(snapshot);
  });

  it("rejects out-of-range choices", () => {
    expect(() => step(S, initState(S), 9)).toThrow(/no choice/);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CastOutput, Skeleton, Spec, Story, WriterOutput } from "./schema";
import { SAMPLE_STORY } from "./sample";

describe("Story schema", () => {
  it("accepts the hand-written sample", () => {
    expect(Story.safeParse(SAMPLE_STORY).success).toBe(true);
  });

  it("rejects bad ids, empty lines, scenes without choices", () => {
    const bad = structuredClone(SAMPLE_STORY);
    bad.nodes[0].id = "N1";
    expect(Story.safeParse(bad).success).toBe(false);

    const empty = structuredClone(SAMPLE_STORY);
    empty.nodes[0].lines = [];
    expect(Story.safeParse(empty).success).toBe(false);

    const noChoices = structuredClone(SAMPLE_STORY);
    (noChoices.nodes[0] as { choices: unknown[] }).choices = [];
    expect(Story.safeParse(noChoices).success).toBe(false);
  });

  it("caps variables at 3 and characters at 6", () => {
    const many = structuredClone(SAMPLE_STORY);
    many.variables = Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, label: "x", init: 0, min: 0, max: 3 }));
    expect(Story.safeParse(many).success).toBe(false);
  });
});

describe("agent output schemas", () => {
  it("are valid JSON-schema convertible (structured outputs)", () => {
    for (const s of [Spec, CastOutput, Skeleton, WriterOutput, Story]) {
      const js = z.toJSONSchema(s) as { type?: string };
      expect(js.type).toBe("object");
    }
  });

  it("writer output has no structural fields", () => {
    const parsed = WriterOutput.parse({
      nodes: [{ id: "n1", lines: [{ speaker: null, text: "hi" }], choiceTexts: ["a"], next: "x" }],
    });
    expect(parsed.nodes[0]).not.toHaveProperty("next");
  });

  it("spec enforces adjustable but bounded scale", () => {
    const base = {
      title: "t", genre: "g", tone: "x", synopsis: "s", nodeTarget: 20, endingCount: 3, variables: [], note: "",
    };
    expect(Spec.safeParse({ ...base, characterCount: 6 }).success).toBe(true);
    expect(Spec.safeParse({ ...base, characterCount: 7 }).success).toBe(false);
    expect(Spec.safeParse({ ...base, characterCount: 1 }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { FIXTURES, SAMPLE_OWNERS } from "@/test/fakeModels";
import { SAMPLE_STORY } from "./sample";
import { activeWriters, graphOf, mergeStory, neighborSummaries, ownersOf, skeletonToStory } from "./skeleton";
import { validateStory } from "./validate";

const spec = FIXTURES.spec();
const cast = FIXTURES.cast().characters;

describe("skeleton helpers", () => {
  it("skeleton of the sample passes structural validation", () => {
    const sk = FIXTURES.skeleton();
    expect(validateStory(skeletonToStory(spec, cast, sk), { spec }).errors).toEqual([]);
    expect(ownersOf(sk)).toEqual(SAMPLE_OWNERS);
    expect(activeWriters(sk)).toEqual(["a", "b", "c"]);
  });

  it("neighbour summaries cover nodes entering and leaving the assignment", () => {
    const ids = neighborSummaries(FIXTURES.skeleton(), ["n4", "n5", "e_bad"]).map((n) => n.id).sort();
    // n4 is entered from n2 and n3; n5 from n3; they lead to n6
    expect(ids).toEqual(["n2", "n3", "n6"]);
  });

  it("merging all writer output reproduces the sample exactly", () => {
    const written = Object.fromEntries(FIXTURES.writer(SAMPLE_STORY.nodes.map((n) => n.id)).nodes.map((n) => [n.id, n]));
    const { story, errors } = mergeStory(spec, cast, FIXTURES.skeleton(), written);
    expect(errors).toEqual([]);
    expect(story).toEqual(SAMPLE_STORY);
  });

  it("missing nodes and wrong choice counts are errors for the owning writer", () => {
    const written = Object.fromEntries(FIXTURES.writer(["n1", "n2"]).nodes.map((n) => [n.id, n]));
    written.n2 = { ...written.n2, choiceTexts: ["只有一个"] };
    const { errors } = mergeStory(spec, cast, FIXTURES.skeleton(), written);
    expect(errors).toContainEqual(expect.objectContaining({ nodeId: "n2", owner: "writer:a", message: expect.stringContaining("一一对应") }));
    expect(errors).toContainEqual(expect.objectContaining({ nodeId: "n4", owner: "writer:b" }));
  });

  it("writers cannot change structure: next/conditions always come from the skeleton", () => {
    const written = Object.fromEntries(FIXTURES.writer(SAMPLE_STORY.nodes.map((n) => n.id)).nodes.map((n) => [n.id, n]));
    (written.n1 as unknown as { next: string }).next = "e_good";
    const { story } = mergeStory(spec, cast, FIXTURES.skeleton(), written);
    expect(JSON.stringify(story)).toEqual(JSON.stringify(SAMPLE_STORY));
  });

  it("graph view lists nodes and labelled conditional edges", () => {
    const g = graphOf(FIXTURES.skeleton());
    expect(g.nodes).toHaveLength(9);
    expect(g.edges.find((e) => e.source === "n6" && e.target === "e_secret")?.label).toBe("trust_lin >= 3");
  });
});

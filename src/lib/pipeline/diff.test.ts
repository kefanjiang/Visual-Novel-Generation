import { describe, expect, it } from "vitest";
import { SAMPLE_STORY } from "@/lib/story/sample";
import type { Story } from "@/lib/story/schema";
import { assembleFiles, README_PATH, THEME_PATH } from "@/lib/template/assemble";
import { changeSummary, describeChanges } from "./diff";

const base = () => {
  const story = structuredClone(SAMPLE_STORY);
  return { story, files: assembleFiles({ story }) };
};

describe("describeChanges", () => {
  it("nothing changed", () => {
    const r = describeChanges(base(), base());
    expect(r).toEqual({ none: true, visible: false, items: [] });
    expect(changeSummary(r)).toBe("没有产生任何改动");
  });

  it("ending epilogue and scene lines are named by what changed", () => {
    const after = base();
    const e = after.story.nodes.find((n) => n.id === "e_bad")!;
    if (e.type === "ending") e.epilogue = "真凶另有其人。";
    after.story.nodes[0].lines[0].text = "雨更大了。";
    after.files = assembleFiles({ story: after.story });
    const r = describeChanges(base(), after);
    expect(r.visible).toBe(true);
    expect(r.items).toEqual(["n1（雨夜·旧书店门口）的台词", `结局「${e.type === "ending" ? e.title : ""}」的结局说明`]);
  });

  it("README-only edits are not visible", () => {
    const after = base();
    after.files = { ...after.files, [README_PATH]: "# x" };
    const r = describeChanges(base(), after);
    expect(r).toMatchObject({ none: false, visible: false, items: ["README"] });
  });

  it("theme changes are visible; added and removed nodes are listed", () => {
    const after = base();
    after.files = { ...after.files, [THEME_PATH]: ":root{}" };
    after.story.nodes = after.story.nodes.filter((n) => n.id !== "e_secret") as Story["nodes"];
    const r = describeChanges(base(), after);
    expect(r.visible).toBe(true);
    expect(r.items).toContain("界面配色");
    expect(r.items.some((i) => i.startsWith("删除结局"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SAMPLE_STORY } from "@/lib/story/sample";
import { assembleFiles, HUD_PATH, README_PATH, STORY_PATH, THEME_PATH, withDefaultHud } from "./assemble";
import { TEMPLATE_FILES } from "./generated";
import { buildTemplateSource } from "../../../scripts/gen-template.mjs";

describe("template bundle", () => {
  it("generated.ts is in sync with template/", () => {
    const onDisk = readFileSync(path.resolve("src/lib/template/generated.ts"), "utf8");
    expect(onDisk).toBe(buildTemplateSource());
  });

  it("contains the entry, engine, default HUD and theme", () => {
    for (const f of ["/index.js", "/App.js", "/engine/core.js", "/engine/Player.js", HUD_PATH, THEME_PATH, "/styles.css"]) {
      expect(TEMPLATE_FILES[f], f).toBeTruthy();
    }
    expect(Object.keys(TEMPLATE_FILES).some((k) => k.endsWith(".d.ts"))).toBe(false);
  });

  it("App imports story, theme, player and hud", () => {
    const app = TEMPLATE_FILES["/App.js"];
    for (const imp of ["./story.json", "./theme.css", "./engine/Player", "./components/Hud"]) expect(app).toContain(imp);
  });
});

describe("assembleFiles", () => {
  it("writes story.json and falls back to template defaults", () => {
    const files = assembleFiles({ story: SAMPLE_STORY });
    expect(JSON.parse(files[STORY_PATH])).toEqual(SAMPLE_STORY);
    expect(files[THEME_PATH]).toBe(TEMPLATE_FILES[THEME_PATH]);
    expect(files[HUD_PATH]).toBe(TEMPLATE_FILES[HUD_PATH]);
    expect(files[README_PATH]).toContain("雨夜书店");
    expect(files[README_PATH]).toContain("旧信");
  });

  it("uses generated theme/hud/readme when given, and can revert the HUD", () => {
    const files = assembleFiles({ story: SAMPLE_STORY, themeCss: ":root{}", hudJs: "export default () => null", readme: "# r" });
    expect(files[THEME_PATH]).toBe(":root{}");
    expect(files[README_PATH]).toBe("# r");
    expect(withDefaultHud(files)[HUD_PATH]).toBe(TEMPLATE_FILES[HUD_PATH]);
  });
});

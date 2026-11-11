import type { Story } from "@/lib/story/schema";
import { TEMPLATE_FILES } from "./generated";

export const STORY_PATH = "/story.json";
export const THEME_PATH = "/theme.css";
export const HUD_PATH = "/components/Hud.js";
export const README_PATH = "/README.md";

/** Files the agents write; everything else comes from the template. */
export const GENERATED_PATHS = [STORY_PATH, THEME_PATH, HUD_PATH, README_PATH] as const;

export function defaultReadme(story: Story): string {
  const endings = story.nodes.filter((n) => n.type === "ending");
  return [
    `# ${story.meta.title}`,
    "",
    story.meta.preface ?? story.meta.synopsis,
    "",
    ...(story.meta.player ? ["## 你扮演", `${story.meta.player.name ? `**${story.meta.player.name}**：` : ""}${story.meta.player.identity}`, ""] : []),
    "## 角色",
    ...story.characters.map((c) => `- ${c.avatar} **${c.name}**（${c.role}）：${c.personality}`),
    "",
    `## 结局（共 ${endings.length} 个）`,
    ...endings.map((e) => `- ${e.type === "ending" ? e.title : ""}`),
    "",
  ].join("\n");
}

/** Build the full project file map shown in the code tab and compiled by Sandpack. */
export function assembleFiles(input: {
  story: Story;
  themeCss?: string | null;
  hudJs?: string | null;
  readme?: string | null;
}): Record<string, string> {
  return {
    ...TEMPLATE_FILES,
    [STORY_PATH]: JSON.stringify(input.story, null, 2) + "\n",
    [THEME_PATH]: input.themeCss ?? TEMPLATE_FILES[THEME_PATH],
    [HUD_PATH]: input.hudJs ?? TEMPLATE_FILES[HUD_PATH],
    [README_PATH]: input.readme ?? defaultReadme(input.story),
  };
}

/** Swap the custom HUD for the template default (used when generated code fails to compile). */
export function withDefaultHud(files: Record<string, string>): Record<string, string> {
  return { ...files, [HUD_PATH]: TEMPLATE_FILES[HUD_PATH] };
}

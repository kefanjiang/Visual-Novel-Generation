import type { Story, StoryNode } from "@/lib/story/schema";
import { HUD_PATH, README_PATH, STORY_PATH, THEME_PATH } from "@/lib/template/assemble";

export interface ChangeReport {
  /** Nothing at all differs from the version the edit started from. */
  none: boolean;
  /** Something a player would notice: story text/structure, theme or HUD. */
  visible: boolean;
  /** Short phrases for the chat, e.g. 结局「雨中人」的说明、n3 的台词. */
  items: string[];
}

const label = (n: StoryNode) => (n.type === "ending" ? `结局「${n.title}」` : `${n.id}（${n.bg}）`);

/** What an edit actually changed, so the completion message reports facts instead of the plan. */
export function describeChanges(
  before: { story: Story; files: Record<string, string> },
  after: { story: Story; files: Record<string, string> },
): ChangeReport {
  const items: string[] = [];
  const old = new Map(before.story.nodes.map((n) => [n.id, n]));
  const now = new Set(after.story.nodes.map((n) => n.id));

  for (const n of after.story.nodes) {
    const o = old.get(n.id);
    if (!o) {
      items.push(`新增${label(n)}`);
      continue;
    }
    if (stableStringify(o) === stableStringify(n)) continue;
    const parts: string[] = [];
    if (stableStringify(o.lines) !== stableStringify(n.lines)) parts.push("台词");
    if (n.type === "ending" && o.type === "ending") {
      if ((o.epilogue ?? "") !== (n.epilogue ?? "")) parts.push("结局说明");
      if (o.title !== n.title) parts.push("标题");
    }
    if (n.type === "scene" && o.type === "scene" && stableStringify(o.choices) !== stableStringify(n.choices)) parts.push("选项");
    items.push(`${label(n)}的${parts.length ? parts.join("、") : "内容"}`);
  }
  for (const o of before.story.nodes) if (!now.has(o.id)) items.push(`删除${label(o)}`);
  if (stableStringify(before.story.meta) !== stableStringify(after.story.meta)) items.push("序幕/简介");
  if (stableStringify(before.story.characters) !== stableStringify(after.story.characters)) items.push("角色设定");

  if (before.files[THEME_PATH] !== after.files[THEME_PATH]) items.push("界面配色");
  if (before.files[HUD_PATH] !== after.files[HUD_PATH]) items.push("状态栏组件");
  const visible = items.length > 0;
  if (before.files[README_PATH] !== after.files[README_PATH]) items.push("README");

  const other = Object.keys({ ...before.files, ...after.files }).filter(
    (k) => ![STORY_PATH, THEME_PATH, HUD_PATH, README_PATH].includes(k) && before.files[k] !== after.files[k],
  );
  // Engine files change when the platform template is upgraded: worth saving, not worth listing.
  return { none: items.length === 0 && other.length === 0, visible, items };
}

/** One line for the chat. */
export function changeSummary(r: ChangeReport, max = 6): string {
  if (r.none) return "没有产生任何改动";
  if (!r.items.length) return "只更新了游戏引擎文件";
  const shown = r.items.slice(0, max).join("、");
  return r.items.length > max ? `${shown} 等 ${r.items.length} 处` : shown;
}

/** Key-order independent JSON (jsonb reorders object keys on the way back from Postgres). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

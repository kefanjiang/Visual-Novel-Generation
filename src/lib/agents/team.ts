export type AgentKey =
  | "producer"
  | "cast"
  | "architect"
  | "writer_a"
  | "writer_b"
  | "writer_c"
  | "writer_d"
  | "reviewer"
  | "engineer"
  | "system";

export interface Persona {
  key: AgentKey;
  name: string;
  title: string;
  avatar: string;
  color: string;
  duty: string;
}

export const TEAM: Record<AgentKey, Persona> = {
  producer: { key: "producer", name: "Mira", title: "制作人", avatar: "🎬", color: "#e0a458", duty: "理解需求、定规模、分派任务" },
  cast: { key: "cast", name: "Leo", title: "角色设计", avatar: "🎭", color: "#c97b9c", duty: "设计人物卡：性格、口吻、关系" },
  architect: { key: "architect", name: "Ada", title: "剧情架构师", avatar: "🗺️", color: "#7aa6d6", duty: "搭剧情骨架：分支、条件、结局" },
  writer_a: { key: "writer_a", name: "Wen", title: "编剧 A", avatar: "✒️", color: "#8bbf8f", duty: "按分配的剧情线写台词和选项" },
  writer_b: { key: "writer_b", name: "Yu", title: "编剧 B", avatar: "🖋️", color: "#6fb5a8", duty: "按分配的剧情线写台词和选项" },
  writer_c: { key: "writer_c", name: "Qiu", title: "编剧 C", avatar: "📝", color: "#a7b86a", duty: "按分配的剧情线写台词和选项" },
  writer_d: { key: "writer_d", name: "Lan", title: "编剧 D", avatar: "🪶", color: "#89a3c9", duty: "按分配的剧情线写台词和选项" },
  reviewer: { key: "reviewer", name: "Iris", title: "一致性审校", avatar: "🔍", color: "#b59ad6", duty: "检查口吻、设定、衔接" },
  engineer: { key: "engineer", name: "Kai", title: "前端工程师", avatar: "🛠️", color: "#d68a6f", duty: "写主题样式和界面组件" },
  system: { key: "system", name: "系统", title: "校验与试玩", avatar: "⚙️", color: "#9a9890", duty: "确定性校验、自动试玩、组装版本" },
};

export const writerKey = (id: string) => `writer_${id}` as AgentKey;

/** Agents a user can @mention directly. */
export const MENTIONABLE: AgentKey[] = ["producer", "cast", "architect", "writer_a", "reviewer", "engineer"];

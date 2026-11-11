import { z } from "zod";

/**
 * The contract of the whole system. Agent outputs, the validator, the engine
 * and the UI all derive their types from here.
 *
 * Everything is arrays + nullable (no records, no optionals) so the same
 * schemas work as structured-output schemas for every model provider.
 */

export const Id = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "id 只能是小写字母开头的 a-z0-9_");

export const Condition = z.object({
  var: Id,
  op: z.enum([">=", "<=", "=="]),
  value: z.number().int(),
});
export type Condition = z.infer<typeof Condition>;

export const Effect = z.object({
  var: Id,
  op: z.enum(["add", "set"]),
  value: z.number().int(),
});
export type Effect = z.infer<typeof Effect>;

/** Reserved speaker id for the player's own lines (never a character id). */
export const PLAYER_SPEAKER = "player";

export const Line = z.object({
  speaker: Id.nullable().describe("角色 id；玩家自己说话用 player；旁白为 null"),
  text: z.string().min(1).max(200),
});
export type Line = z.infer<typeof Line>;

export const Variable = z.object({
  id: Id,
  label: z.string().min(1).max(20),
  init: z.number().int(),
  min: z.number().int(),
  max: z.number().int(),
});
export type Variable = z.infer<typeof Variable>;

const CharacterBase = z.object({
  id: Id,
  name: z.string().min(1).max(12),
  role: z.string().min(1).max(30),
  personality: z.string().min(1).max(80),
  voice: z.string().min(1).max(80).describe("说话方式，编剧据此写台词"),
  avatar: z.string().min(1).max(8).describe("一个 emoji"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
const Intro = z.string().max(60).describe("给玩家看的一句介绍：身份和与你的关系，不剧透");
/** Older stories have no intro, so it is optional in a story; the cast designer must always write one. */
export const Character = CharacterBase.extend({ intro: Intro.optional() });
export type Character = z.infer<typeof Character>;
export const CastCharacter = CharacterBase.extend({ intro: Intro.min(1) });

/** Who the player is. The player is never one of the characters. */
export const PlayerRole = z.object({
  name: z.string().min(1).max(12).nullable().describe("玩家角色的名字；不需要名字就为 null"),
  identity: z.string().min(1).max(60).describe("第二人称写玩家是谁，如「你是入职刚满一周的项目助理」"),
});
export type PlayerRole = z.infer<typeof PlayerRole>;

/** The dramatic core every agent works from. hiddenTruth is for the team only. */
export const Premise = z.object({
  question: z.string().min(1).max(80).describe("贯穿全剧、让玩家想一直玩下去的核心问题"),
  playerGoal: z.string().min(1).max(80).describe("玩家想要达成什么"),
  stakes: z.string().min(1).max(80).describe("失败或选错会失去什么"),
  hiddenTruth: z.string().min(1).max(200).describe("故事背后的真相：谁、做了什么、为什么。只给团队看，不能出现在序幕里"),
});
export type Premise = z.infer<typeof Premise>;

export const EndingKind = z.enum(["good", "bad", "neutral", "secret"]);

export const Choice = z.object({
  text: z.string().min(1).max(60),
  next: Id,
  condition: Condition.nullable(),
  effects: z.array(Effect).max(3),
});
export type Choice = z.infer<typeof Choice>;

export const SceneNode = z.object({
  id: Id,
  type: z.literal("scene"),
  bg: z.string().min(1).max(40).describe("场景名，如 雨夜·旧书店"),
  lines: z.array(Line).min(1).max(8),
  choices: z.array(Choice).min(1).max(4),
});
export const EndingNode = z.object({
  id: Id,
  type: z.literal("ending"),
  bg: z.string().min(1).max(40),
  endingKind: EndingKind,
  title: z.string().min(1).max(20),
  lines: z.array(Line).min(1).max(8),
  /** Shown under the ending title. Optional so earlier games still load. */
  epilogue: z.string().max(200).optional(),
});
export const StoryNode = z.discriminatedUnion("type", [SceneNode, EndingNode]);
export type SceneNode = z.infer<typeof SceneNode>;
export type EndingNode = z.infer<typeof EndingNode>;
export type StoryNode = z.infer<typeof StoryNode>;

export const Meta = z.object({
  title: z.string().min(1).max(30),
  genre: z.string().min(1).max(20),
  tone: z.string().min(1).max(40),
  synopsis: z.string().min(1).max(200),
  start: Id,
  // Added later; optional so earlier games still load.
  preface: z.string().max(300).optional(),
  player: PlayerRole.optional(),
  premise: Premise.optional(),
});
export type Meta = z.infer<typeof Meta>;

export const Story = z.object({
  meta: Meta,
  variables: z.array(Variable).max(3),
  characters: z.array(Character).min(1).max(6),
  nodes: z.array(StoryNode).min(2).max(40),
});
export type Story = z.infer<typeof Story>;

// ---------------- agent outputs ----------------

/** 制作人: generation spec. */
export const Spec = z.object({
  title: z.string().min(1).max(30),
  genre: z.string().min(1).max(20),
  tone: z.string().min(1).max(40),
  synopsis: z.string().min(1).max(200),
  premise: Premise,
  player: PlayerRole,
  preface: z.string().min(1).max(300).describe("开场序幕：2–4 句第二人称旁白，交代时间地点、你的处境、引出核心问题，不剧透"),
  characterCount: z.number().int().min(2).max(6).describe("登场角色数，不含玩家"),
  endingCount: z.number().int().min(2).max(4),
  nodeTarget: z.number().int().min(12).max(35),
  variables: z.array(Variable).max(3),
  note: z.string().max(200).describe("对用户说的一句话：规模如何定、需求是否被收窄"),
});
export type Spec = z.infer<typeof Spec>;

/** 角色设计 */
export const CastOutput = z.object({ characters: z.array(CastCharacter).min(2).max(6) });
export type CastOutput = z.infer<typeof CastOutput>;

export const WriterId = z.enum(["a", "b", "c", "d"]);
export type WriterId = z.infer<typeof WriterId>;

export const SkeletonChoice = z.object({
  intent: z.string().min(1).max(40).describe("这个选项的意思，编剧据此写玩家看到的文字"),
  next: Id,
  condition: Condition.nullable(),
  effects: z.array(Effect).max(3),
});
export type SkeletonChoice = z.infer<typeof SkeletonChoice>;

export const SkeletonNode = z.object({
  id: Id,
  type: z.enum(["scene", "ending"]),
  chapter: z.number().int().min(1).max(5),
  owner: WriterId.describe("负责写这个节点的编剧"),
  bg: z.string().min(1).max(40),
  summary: z.string().min(1).max(120).describe("一句话梗概：这一场发生什么"),
  endingKind: EndingKind.nullable().describe("结局节点必填，场景节点为 null"),
  endingTitle: z.string().max(20).nullable(),
  choices: z.array(SkeletonChoice).max(4).describe("结局节点为空数组"),
});
export type SkeletonNode = z.infer<typeof SkeletonNode>;

export const Skeleton = z.object({
  start: Id,
  writers: z
    .array(z.object({ id: WriterId, focus: z.string().min(1).max(60) }))
    .min(1)
    .max(4),
  nodes: z.array(SkeletonNode).min(2).max(40),
});
export type Skeleton = z.infer<typeof Skeleton>;

/** 编剧: content only — no structural fields, so it cannot change the graph. */
export const WriterNode = z.object({
  id: Id,
  lines: z.array(Line).min(1).max(8),
  choiceTexts: z.array(z.string().min(1).max(60)).max(4),
  epilogue: z
    .string()
    .max(200)
    .nullable()
    .describe("结局节点必填：显示在结局标题下方的结局说明，1–3 句；场景节点为 null"),
});
export const WriterOutput = z.object({ nodes: z.array(WriterNode) });
export type WriterNode = z.infer<typeof WriterNode>;
export type WriterOutput = z.infer<typeof WriterOutput>;

/** 一致性审校 */
export const ReviewOutput = z.object({
  issues: z
    .array(
      z.object({
        nodeId: Id,
        problem: z.string().min(1).max(120),
        suggestion: z.string().min(1).max(120),
      }),
    )
    .max(10),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

/** 审校 reading the skeleton before anyone writes: is it worth playing? */
export const PlotReview = z.object({
  verdict: z.enum(["pass", "revise"]).describe("pass=可以开写；revise=有明显影响趣味的问题，退回架构师改一轮"),
  highlights: z.string().min(1).max(120).describe("一句话：这个骨架最吸引人的地方"),
  issues: z
    .array(
      z.object({
        nodeId: Id.nullable().describe("相关节点；针对整体就为 null"),
        problem: z.string().min(1).max(120),
        suggestion: z.string().min(1).max(160),
      }),
    )
    .max(5),
});
export type PlotReview = z.infer<typeof PlotReview>;

/** 工程师 */
export const EngineerOutput = z.object({
  themeCss: z.string().min(1).max(4000).describe("只包含 :root CSS 变量和少量全局样式"),
  hudJs: z.string().min(1).max(4000).describe("React 组件源码，export default function Hud({ vars, variables, characters })"),
  readme: z.string().min(1).max(3000),
});
export type EngineerOutput = z.infer<typeof EngineerOutput>;

/** 制作人 routing a follow-up message. */
export const EditPlan = z.object({
  kind: z
    .enum(["text", "structure", "style", "question", "new_game"])
    .describe("text=改台词口吻；structure=加/删分支、结局、改走向；style=配色字体界面组件；question=只是提问；new_game=想做全新的游戏"),
  reply: z.string().min(1).max(300).describe("对用户说的话：你理解的需求和交给谁"),
  nodeIds: z.array(Id).max(40).describe("text 修改涉及的节点；不确定就留空"),
  characterIds: z.array(Id).max(6).describe("text 修改针对的角色；没有就留空"),
  instructions: z.string().min(1).max(400).describe("给执行者的具体修改要求"),
  summary: z.string().min(1).max(40).describe("这次修改的简短标题，用作版本说明"),
});
export type EditPlan = z.infer<typeof EditPlan>;

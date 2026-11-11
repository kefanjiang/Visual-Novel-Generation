import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import type { z } from "zod";
import {
  CastOutput,
  EngineerOutput,
  ReviewOutput,
  Skeleton,
  Spec,
  WriterOutput,
  type Character,
  type Story,
} from "@/lib/story/schema";
import { neighborSummaries, nodesForWriter } from "@/lib/story/skeleton";
import type { Models } from "./models";
import * as P from "./prompts";

export interface AgentResult<T> {
  output: T;
  tokens: number;
}

/** One structured call; on a schema miss, retry once telling the model what was wrong. */
export async function callAgent<S extends z.ZodType>(
  model: LanguageModel,
  schema: S,
  system: string,
  prompt: string,
): Promise<AgentResult<z.infer<S>>> {
  let tokens = 0;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await generateText({
        model,
        system,
        prompt: lastError ? `${prompt}\n\n上一次输出不符合格式要求：${lastError}\n请严格按 schema 重新输出。` : prompt,
        output: Output.object({ schema }),
        maxRetries: 1,
      });
      tokens += r.usage.totalTokens ?? 0;
      return { output: r.output as z.infer<S>, tokens };
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err) && attempt === 0) {
        tokens += err.usage?.totalTokens ?? 0;
        lastError = (err.cause instanceof Error ? err.cause.message : err.message).slice(0, 500);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

const json = (v: unknown) => JSON.stringify(v, null, 1);

export function runProducer(m: Models, userPrompt: string) {
  return callAgent(m.strong, Spec, P.PRODUCER, `用户需求：\n${userPrompt}`);
}

export function runCast(m: Models, spec: Spec) {
  return callAgent(m.fast, CastOutput, P.CAST, `规格：\n${json(spec)}`);
}

export function runArchitect(m: Models, spec: Spec, cast: Character[], feedback: string[] = [], previous?: Skeleton) {
  const parts = [`规格：\n${json(spec)}`, `角色：\n${json(cast)}`];
  if (previous) parts.push(`你上一版的骨架：\n${json(previous)}`);
  if (feedback.length) parts.push(`需要修正的问题：\n${feedback.map((f) => `- ${f}`).join("\n")}`);
  return callAgent(m.strong, Skeleton, P.ARCHITECT, parts.join("\n\n"));
}

export function runWriter(
  m: Models,
  writerId: string,
  ctx: { spec: Spec; cast: Character[]; skeleton: Skeleton; focus?: string },
  onlyIds?: string[],
  feedback: string[] = [],
  current?: Record<string, unknown>,
) {
  const mine = nodesForWriter(ctx.skeleton, writerId).filter((n) => !onlyIds || onlyIds.includes(n.id));
  const ids = mine.map((n) => n.id);
  const parts = [
    `ASSIGNED_IDS: ${ids.join(",")}`,
    `题材：${ctx.spec.genre}；基调：${ctx.spec.tone}；简介：${ctx.spec.synopsis}`,
    ctx.focus ? `你负责的剧情线：${ctx.focus}` : "",
    `角色卡：\n${json(ctx.cast)}`,
    `你要写的节点（骨架）：\n${json(mine.map((n) => ({ id: n.id, type: n.type, bg: n.bg, summary: n.summary, endingTitle: n.endingTitle, choiceIntents: n.choices.map((c) => c.intent) })))}`,
    `相邻节点梗概：\n${json(neighborSummaries(ctx.skeleton, ids))}`,
  ];
  if (current) parts.push(`这些节点当前的内容：\n${json(current)}`);
  if (feedback.length) parts.push(`需要修正的问题：\n${feedback.map((f) => `- ${f}`).join("\n")}`);
  return callAgent(m.fast, WriterOutput, P.WRITER, parts.filter(Boolean).join("\n\n"));
}

export function runReviewer(m: Models, story: Story) {
  return callAgent(m.fast, ReviewOutput, P.REVIEWER, `完整剧情：\n${json(story)}`);
}

export function runEngineer(m: Models, spec: Spec, cast: Character[], feedback: string[] = []) {
  const parts = [`规格：\n${json(spec)}`, `角色：\n${json(cast)}`];
  if (feedback.length) parts.push(`上一版代码的问题：\n${feedback.map((f) => `- ${f}`).join("\n")}`);
  return callAgent(m.strong, EngineerOutput, P.ENGINEER, parts.join("\n\n"));
}

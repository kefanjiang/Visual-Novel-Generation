import { getUsage, incrementUsage } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";

export type LimitKind = "generate" | "edit";

export interface Limits {
  perIp: Record<LimitKind, number>;
  global: Record<LimitKind, number>;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): Limits {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    perIp: { generate: n(env.LIMIT_IP_GENERATE, 3), edit: n(env.LIMIT_IP_EDIT, 15) },
    global: { generate: n(env.LIMIT_GLOBAL_GENERATE, 60), edit: n(env.LIMIT_GLOBAL_EDIT, 300) },
  };
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export type LimitResult = { ok: true; remaining: number } | { ok: false; reason: "ip" | "global"; message: string };

/** Check both limits first, then count the request. Over-limit requests are not counted. */
export async function checkAndCount(
  db: Db,
  ipHash: string,
  kind: LimitKind,
  limits: Limits,
  now = new Date(),
): Promise<LimitResult> {
  const day = today(now);
  const [mine, all] = await Promise.all([getUsage(db, ipHash, day, kind), getUsage(db, "__global__", day, kind)]);
  const label = kind === "generate" ? "生成" : "修改";
  if (all >= limits.global[kind]) {
    return { ok: false, reason: "global", message: `今天的全站${label}额度已用完，先看看示例项目，或 remix 一个示例继续改吧。` };
  }
  if (mine >= limits.perIp[kind]) {
    return { ok: false, reason: "ip", message: `你今天的${label}次数（${limits.perIp[kind]} 次）已用完，明天再来，或者先玩玩示例项目。` };
  }
  const used = await incrementUsage(db, ipHash, day, kind);
  await incrementUsage(db, "__global__", day, kind);
  return { ok: true, remaining: Math.max(0, limits.perIp[kind] - used) };
}

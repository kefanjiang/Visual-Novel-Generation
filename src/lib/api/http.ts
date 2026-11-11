import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { modelsFromEnv } from "@/lib/agents/models";
import type { Deps } from "@/lib/pipeline/runner";
import { ensureOwnerId, hashIp, OWNER_COOKIE } from "@/lib/owner";
import type { Result } from "./handlers";

/** Anonymous owner id from the cookie; mints and sets one when missing. */
export async function getOwner(): Promise<string> {
  const jar = await cookies();
  const { id, isNew } = ensureOwnerId(jar.get(OWNER_COOKIE)?.value);
  if (isNew) {
    jar.set(OWNER_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
  }
  return id;
}

export async function getIpHash(req: Request): Promise<string> {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return hashIp(ip);
}

export function respond<T>(r: Result<T>): Response {
  return Response.json(r.body, { status: r.status });
}

let depsPromise: Promise<Deps> | null = null;

/** Models from env + compile check (skipped gracefully if esbuild cannot load on this platform). */
export function getDeps(): Promise<Deps> {
  depsPromise ??= (async () => {
    const models = await modelsFromEnv();
    const compile = async (files: Record<string, string>) => {
      try {
        const { checkProjectCompiles } = await import("@/lib/template/compile");
        return await checkProjectCompiles(files);
      } catch (err) {
        console.warn("compile check unavailable, skipping", err);
        return { ok: true, errors: [] };
      }
    };
    return { models, compile };
  })();
  return depsPromise;
}

export { getDb };

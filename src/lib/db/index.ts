import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import type { Db } from "./types";

let cached: Db | null = null;
let local: Promise<Db> | null = null;

/** Production database (Neon over HTTP). Lazily created so builds work without DATABASE_URL. */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite")) throw new Error("use getDbAsync() for the local pglite database");
  cached = drizzle(neon(url), { schema }) as unknown as Db;
  return cached;
}

/**
 * Same as getDb, but also supports DATABASE_URL=pglite (in-memory Postgres, local smoke tests only).
 */
export async function getDbAsync(): Promise<Db> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("pglite")) return getDb();
  local ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const db = drizzleLite(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    return db as unknown as Db;
  })();
  return local;
}

export type { Db };
export { schema };

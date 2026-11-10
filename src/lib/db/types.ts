import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Driver-agnostic database handle: Neon HTTP in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

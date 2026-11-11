import { playHandler } from "@/lib/api/handlers";
import { getDb, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(await playHandler(getDb(), id));
}

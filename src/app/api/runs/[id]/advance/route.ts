import { advanceHandler } from "@/lib/api/handlers";
import { getDb, getDeps, getOwner, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(await advanceHandler(await getDb(), id, await getOwner(), await getDeps()));
}

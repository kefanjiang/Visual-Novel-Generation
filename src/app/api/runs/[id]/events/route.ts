import { eventsHandler } from "@/lib/api/handlers";
import { getDb, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  return respond(await eventsHandler(await getDb(), id, after));
}

import { remixHandler } from "@/lib/api/handlers";
import { getDb, getOwner, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(await remixHandler(await getDb(), { projectId: id, owner: await getOwner() }));
}

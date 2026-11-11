import { restoreHandler } from "@/lib/api/handlers";
import { getDb, getOwner, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { versionId?: unknown };
  return respond(await restoreHandler(await getDb(), { projectId: id, owner: await getOwner(), versionId: body.versionId }));
}

import { saveVersionHandler } from "@/lib/api/handlers";
import { getDb, getDeps, getOwner, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { files?: unknown };
  const deps = await getDeps();
  return respond(await saveVersionHandler(getDb(), { projectId: id, owner: await getOwner(), files: body.files }, deps.compile));
}

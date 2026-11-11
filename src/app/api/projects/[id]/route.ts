import { deleteProjectHandler, getProjectHandler } from "@/lib/api/handlers";
import { getDb, getOwner, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(await getProjectHandler(await getDb(), id, await getOwner()));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond(await deleteProjectHandler(await getDb(), { projectId: id, owner: await getOwner() }));
}

import { postMessageHandler } from "@/lib/api/handlers";
import { getDb, getIpHash, getOwner, respond } from "@/lib/api/http";
import { limitsFromEnv } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  return respond(await postMessageHandler(getDb(), { projectId: id, owner: await getOwner(), ipHash: await getIpHash(req), text: body.text }, limitsFromEnv()));
}

import { setExampleHandler } from "@/lib/api/handlers";
import { getDb, respond } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/** POST with header `x-admin-token: $ADMIN_TOKEN` and body {"isExample": true|false}. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { isExample?: boolean };
  return respond(
    await setExampleHandler(await getDb(), { projectId: id, token: req.headers.get("x-admin-token"), isExample: body.isExample !== false }, process.env.ADMIN_TOKEN),
  );
}

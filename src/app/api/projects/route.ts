import { createProjectHandler, listProjectsHandler } from "@/lib/api/handlers";
import { getDb, getIpHash, getOwner, respond } from "@/lib/api/http";
import { limitsFromEnv } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET() {
  return respond(await listProjectsHandler(getDb(), await getOwner()));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  const result = await createProjectHandler(
    getDb(),
    { owner: await getOwner(), ipHash: await getIpHash(req), prompt: body.prompt },
    limitsFromEnv(),
  );
  return respond(result);
}

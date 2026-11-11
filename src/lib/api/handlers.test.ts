import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createFakeModels } from "@/test/fakeModels";
import type { Db } from "@/lib/db/types";
import type { Limits } from "@/lib/ratelimit";
import { checkProjectCompiles } from "@/lib/template/compile";
import {
  advanceHandler,
  createProjectHandler,
  eventsHandler,
  getProjectHandler,
  getVersionHandler,
  listProjectsHandler,
  retryHandler,
} from "./handlers";

const limits: Limits = { perIp: { generate: 2, edit: 5 }, global: { generate: 3, edit: 10 } };
let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("API handlers", () => {
  it("validates the prompt", async () => {
    expect((await createProjectHandler(db, { owner: "o", ipHash: "h", prompt: "" }, limits)).status).toBe(400);
    expect((await createProjectHandler(db, { owner: "o", ipHash: "h", prompt: 42 }, limits)).status).toBe(400);
  });

  it("rate-limits per IP and globally, without counting rejected requests", async () => {
    const make = (ip: string) => createProjectHandler(db, { owner: "o", ipHash: ip, prompt: "悬疑" }, limits);
    expect((await make("h1")).status).toBe(201);
    expect((await make("h1")).status).toBe(201);
    const third = await make("h1");
    expect(third.status).toBe(429);
    expect((third.body as { error: string }).error).toContain("2 次");
    expect((await make("h2")).status).toBe(201); // global now 3
    const g = await make("h3");
    expect(g.status).toBe(429);
    expect((g.body as { error: string }).error).toContain("全站");
  });

  it("full flow: create → advance until done → project shows version, messages, finished run", async () => {
    const deps = { models: createFakeModels(), compile: checkProjectCompiles };
    const created = await createProjectHandler(db, { owner: "o_me", ipHash: "h", prompt: "雨夜书店" }, limits);
    const { projectId, runId } = created.body as { projectId: string; runId: string };

    expect((await advanceHandler(db, runId, "o_other", deps)).status).toBe(403);
    for (let i = 0; i < 20; i++) {
      const r = await advanceHandler(db, runId, "o_me", deps);
      if ((r.body as { status: string }).status !== "running") break;
    }

    const events = await eventsHandler(db, runId, 0);
    const evBody = events.body as { run: { status: string }; events: { id: number }[] };
    expect(evBody.run.status).toBe("done");
    const lastId = evBody.events.at(-1)!.id;
    expect(((await eventsHandler(db, runId, lastId)).body as { events: unknown[] }).events).toEqual([]);

    const proj = (await getProjectHandler(db, projectId, "o_me")).body as {
      project: { title: string; isOwner: boolean };
      versions: { n: number }[];
      currentVersion: { id: string; files: Record<string, string> };
      run: { status: string };
      messages: unknown[];
    };
    expect(proj.project).toMatchObject({ title: "雨夜书店", isOwner: true });
    expect(proj.versions.map((v) => v.n)).toEqual([1]);
    expect(proj.currentVersion.files["/story.json"]).toBeTruthy();
    expect(proj.run.status).toBe("done");
    expect(proj.messages.length).toBeGreaterThan(5);
    expect(((await getProjectHandler(db, projectId, "o_else")).body as { project: { isOwner: boolean } }).project.isOwner).toBe(false);

    expect((await getVersionHandler(db, proj.currentVersion.id)).status).toBe(200);
    expect((await getVersionHandler(db, "v_missing")).status).toBe(404);

    const list = (await listProjectsHandler(db, "o_me")).body as { mine: { id: string }[]; examples: unknown[] };
    expect(list.mine.map((p) => p.id)).toEqual([projectId]);
    expect(list.examples).toEqual([]);
  });

  it("retry only works on failed runs of your own project", async () => {
    const models = createFakeModels();
    models.queue("producer", new Error("boom"));
    const deps = { models, compile: checkProjectCompiles };
    const { runId } = (await createProjectHandler(db, { owner: "o_me", ipHash: "h", prompt: "x" }, limits)).body as { runId: string };
    expect((await retryHandler(db, runId, "o_me")).status).toBe(409);
    await advanceHandler(db, runId, "o_me", deps);
    expect((await retryHandler(db, runId, "o_other")).status).toBe(403);
    expect((await retryHandler(db, runId, "o_me")).status).toBe(200);
    expect((await getProjectHandler(db, "p_missing", "o")).status).toBe(404);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createFakeModels } from "@/test/fakeModels";
import type { Db } from "@/lib/db/types";
import type { Limits } from "@/lib/ratelimit";
import { checkProjectCompiles } from "@/lib/template/compile";
import { getActiveRun, listMessages, listVersions } from "@/lib/db/repo";
import {
  advanceHandler,
  createProjectHandler,
  deleteProjectHandler,
  eventsHandler,
  getProjectHandler,
  getVersionHandler,
  listProjectsHandler,
  playHandler,
  postMessageHandler,
  remixHandler,
  restoreHandler,
  retryHandler,
  saveVersionHandler,
  setExampleHandler,
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

describe("step 6 handlers", () => {
  async function generatedProject(owner = "o_me") {
    const deps = { models: createFakeModels(), compile: checkProjectCompiles };
    const { projectId, runId } = (await createProjectHandler(db, { owner, ipHash: "h0", prompt: "雨夜书店" }, { ...limits, perIp: { generate: 99, edit: 99 }, global: { generate: 99, edit: 99 } })).body as { projectId: string; runId: string };
    for (let i = 0; i < 20; i++) {
      const r = await advanceHandler(db, runId, owner, deps);
      if ((r.body as { status: string }).status !== "running") break;
    }
    return { projectId, deps };
  }

  it("posting a message starts an edit run; guards map to HTTP codes", async () => {
    const { projectId } = await generatedProject();
    expect((await postMessageHandler(db, { projectId, owner: "o_me", ipHash: "h", text: "" }, limits)).status).toBe(400);
    expect((await postMessageHandler(db, { projectId, owner: "o_x", ipHash: "h", text: "hi" }, limits)).status).toBe(403);
    expect((await postMessageHandler(db, { projectId: "p_nope", owner: "o_me", ipHash: "h", text: "hi" }, limits)).status).toBe(404);
    const r = await postMessageHandler(db, { projectId, owner: "o_me", ipHash: "h", text: "@Kai 换个颜色" }, limits);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ mention: "engineer" });
    // a second message while the run is active is rejected
    expect((await postMessageHandler(db, { projectId, owner: "o_me", ipHash: "h", text: "再改" }, limits)).status).toBe(409);
  });

  it("edit messages are rate limited separately", async () => {
    const { projectId } = await generatedProject();
    const tight = { ...limits, perIp: { generate: 9, edit: 0 } };
    const r = await postMessageHandler(db, { projectId, owner: "o_me", ipHash: "h", text: "hi" }, tight);
    expect(r.status).toBe(429);
  });

  it("restore, manual save, remix, play and examples", async () => {
    const { projectId } = await generatedProject();
    const proj = (await getProjectHandler(db, projectId, "o_me")).body as { currentVersion: { id: string; files: Record<string, string> } };

    expect((await restoreHandler(db, { projectId, owner: "o_me", versionId: 5 })).status).toBe(400);
    expect((await restoreHandler(db, { projectId, owner: "o_me", versionId: proj.currentVersion.id })).body).toMatchObject({ n: 2 });

    expect((await saveVersionHandler(db, { projectId, owner: "o_me", files: { "/a.js": 1 } })).status).toBe(400);
    expect((await saveVersionHandler(db, { projectId, owner: "o_me", files: { "/story.json": "{bad" } })).status).toBe(400);
    expect((await saveVersionHandler(db, { projectId, owner: "o_me", files: { "/README.md": "# hi" } }, checkProjectCompiles)).body).toMatchObject({ n: 3 });

    const remix = await remixHandler(db, { projectId, owner: "o_guest" });
    expect(remix.status).toBe(201);
    expect((await remixHandler(db, { projectId: "p_nope", owner: "o_guest" })).status).toBe(404);

    const play = await playHandler(db, projectId);
    expect(play.body).toMatchObject({ title: "雨夜书店", n: 3 });
    expect((await playHandler(db, "p_nope")).status).toBe(404);

    expect((await setExampleHandler(db, { projectId, token: "x", isExample: true }, "secret")).status).toBe(401);
    expect((await setExampleHandler(db, { projectId, token: "secret", isExample: true }, undefined)).status).toBe(401);
    expect((await setExampleHandler(db, { projectId, token: "secret", isExample: true }, "secret")).status).toBe(200);
    expect(((await listProjectsHandler(db, "o_anyone")).body as { examples: { id: string }[] }).examples.map((e) => e.id)).toEqual([projectId]);
  });

  it("delete: owner only, keeps examples and running projects, removes everything else", async () => {
    const { projectId } = await generatedProject();
    expect((await deleteProjectHandler(db, { projectId, owner: "o_x" })).status).toBe(403);
    expect((await deleteProjectHandler(db, { projectId: "p_nope", owner: "o_me" })).status).toBe(404);

    await postMessageHandler(db, { projectId, owner: "o_me", ipHash: "h", text: "改一下" }, limits);
    expect(await getActiveRun(db, projectId)).toBeTruthy();
    expect((await deleteProjectHandler(db, { projectId, owner: "o_me" })).status).toBe(409);

    const { projectId: other } = await generatedProject();
    await setExampleHandler(db, { projectId: other, token: "s", isExample: true }, "s");
    expect((await deleteProjectHandler(db, { projectId: other, owner: "o_me" })).status).toBe(409);
    await setExampleHandler(db, { projectId: other, token: "s", isExample: false }, "s");

    // a remix of it survives the original being deleted
    const remix = (await remixHandler(db, { projectId: other, owner: "o_guest" })).body as { projectId: string };
    expect((await deleteProjectHandler(db, { projectId: other, owner: "o_me" })).status).toBe(200);
    expect((await getProjectHandler(db, other, "o_me")).status).toBe(404);
    expect(await listVersions(db, other)).toEqual([]);
    expect(await listMessages(db, other)).toEqual([]);
    expect((await getProjectHandler(db, remix.projectId, "o_guest")).status).toBe(200);

    const mine = (await listProjectsHandler(db, "o_guest")).body as { mine: { id: string; forkedFrom: string | null }[] };
    expect(mine.mine[0]).toMatchObject({ id: remix.projectId, forkedFrom: other });
  });
});

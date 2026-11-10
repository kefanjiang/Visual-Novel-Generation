import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import type { Db } from "./types";
import {
  acquireLease,
  addEvent,
  addMessage,
  addVersion,
  createProject,
  createRun,
  getActiveRun,
  getProject,
  getRun,
  getVersion,
  incrementUsage,
  getUsage,
  listEvents,
  listExamples,
  listMessages,
  listProjectsByOwner,
  listVersions,
  releaseLease,
  updateRun,
} from "./repo";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("projects", () => {
  it("creates and lists projects per owner, examples separately", async () => {
    const a = await createProject(db, { owner: "o_a", prompt: "雨夜书店悬疑" });
    await createProject(db, { owner: "o_b", prompt: "校园恋爱" });
    await createProject(db, { owner: "o_sys", prompt: "示例", isExample: true });

    expect((await getProject(db, a.id))?.prompt).toBe("雨夜书店悬疑");
    expect((await listProjectsByOwner(db, "o_a")).map((p) => p.id)).toEqual([a.id]);
    expect(await listExamples(db)).toHaveLength(1);
    expect(await getProject(db, "p_missing")).toBeNull();
  });
});

describe("versions", () => {
  it("numbers versions sequentially and moves current pointer", async () => {
    const p = await createProject(db, { owner: "o_a", prompt: "x" });
    const v1 = await addVersion(db, { projectId: p.id, files: { "/a.js": "1" }, story: { s: 1 }, source: "generate" });
    const v2 = await addVersion(db, { projectId: p.id, files: { "/a.js": "2" }, story: { s: 2 }, source: "chat_edit", summary: "改结局" });

    expect(v1.n).toBe(1);
    expect(v2.n).toBe(2);
    expect((await getProject(db, p.id))?.currentVersionId).toBe(v2.id);
    expect((await getVersion(db, v1.id))?.files).toEqual({ "/a.js": "1" });

    const list = await listVersions(db, p.id);
    expect(list.map((v) => v.n)).toEqual([2, 1]);
    expect(list[0]).not.toHaveProperty("files");
  });
});

describe("messages", () => {
  it("returns messages in creation order", async () => {
    const p = await createProject(db, { owner: "o_a", prompt: "x" });
    await addMessage(db, { projectId: p.id, role: "user", content: "做一个悬疑游戏" });
    await addMessage(db, { projectId: p.id, role: "agent", agent: "producer", content: "收到" });
    const list = await listMessages(db, p.id);
    expect(list.map((m) => m.content)).toEqual(["做一个悬疑游戏", "收到"]);
    expect(list[1].agent).toBe("producer");
  });
});

describe("runs and leases", () => {
  it("only one caller can hold the lease until it expires or is released", async () => {
    const p = await createProject(db, { owner: "o_a", prompt: "x" });
    const run = await createRun(db, { projectId: p.id, kind: "generate", stage: "plan" });
    const t0 = new Date("2026-01-01T00:00:00Z");

    expect(await acquireLease(db, run.id, 60_000, t0)).not.toBeNull();
    expect(await acquireLease(db, run.id, 60_000, new Date(t0.getTime() + 1000))).toBeNull();
    // expired lease can be taken over
    expect(await acquireLease(db, run.id, 60_000, new Date(t0.getTime() + 61_000))).not.toBeNull();

    await releaseLease(db, run.id);
    expect(await acquireLease(db, run.id, 60_000, new Date(t0.getTime() + 62_000))).not.toBeNull();
  });

  it("concurrent acquires: exactly one wins", async () => {
    const p = await createProject(db, { owner: "o_a", prompt: "x" });
    const run = await createRun(db, { projectId: p.id, kind: "generate", stage: "plan" });
    const results = await Promise.all(Array.from({ length: 5 }, () => acquireLease(db, run.id, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("finished runs cannot be leased and are not active", async () => {
    const p = await createProject(db, { owner: "o_a", prompt: "x" });
    const run = await createRun(db, { projectId: p.id, kind: "generate", stage: "plan", state: { a: 1 } });
    expect((await getActiveRun(db, p.id))?.id).toBe(run.id);
    await updateRun(db, run.id, { status: "done", stage: "done" });
    expect(await acquireLease(db, run.id, 60_000)).toBeNull();
    expect(await getActiveRun(db, p.id)).toBeNull();
    expect((await getRun(db, run.id))?.state).toEqual({ a: 1 });
  });
});

describe("events", () => {
  it("lists events after a cursor", async () => {
    const p = await createProject(db, { owner: "o_a", prompt: "x" });
    const run = await createRun(db, { projectId: p.id, kind: "generate", stage: "plan" });
    const e1 = await addEvent(db, { runId: run.id, agent: "producer", type: "started" });
    await addEvent(db, { runId: run.id, agent: "producer", type: "done", payload: { title: "雨夜书店" } });
    expect(await listEvents(db, run.id)).toHaveLength(2);
    const after = await listEvents(db, run.id, e1.id);
    expect(after).toHaveLength(1);
    expect(after[0].payload).toEqual({ title: "雨夜书店" });
  });
});

describe("usage", () => {
  it("increments per ip/day/kind", async () => {
    expect(await incrementUsage(db, "h1", "2026-11-10", "generate")).toBe(1);
    expect(await incrementUsage(db, "h1", "2026-11-10", "generate")).toBe(2);
    expect(await incrementUsage(db, "h1", "2026-11-11", "generate")).toBe(1);
    expect(await incrementUsage(db, "h1", "2026-11-10", "edit")).toBe(1);
    expect(await getUsage(db, "h1", "2026-11-10", "generate")).toBe(2);
    expect(await getUsage(db, "h2", "2026-11-10", "generate")).toBe(0);
  });
});

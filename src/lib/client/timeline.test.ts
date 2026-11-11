import { describe, expect, it } from "vitest";
import { graphOf } from "@/lib/story/skeleton";
import { FIXTURES } from "@/test/fakeModels";
import { emptyTimeline, layoutGraph, parseMention, reduceEvents, type ClientEvent } from "./timeline";

const ev = (id: number, agent: string, type: string, payload: Record<string, unknown> = {}): ClientEvent => ({ id, agent, type, payload });

describe("reduceEvents", () => {
  it("tracks agent status, graph, node status and version", () => {
    const g = graphOf(FIXTURES.skeleton());
    let s = reduceEvents(emptyTimeline(), [
      ev(1, "producer", "started"),
      ev(2, "producer", "done"),
      ev(3, "writer_a", "started"),
      ev(4, "system", "graph", { ...g, status: "outline" }),
      ev(5, "system", "graph_status", { ids: ["n1", "n2"], status: "written" }),
    ]);
    expect(s.agents).toEqual({ producer: "done", writer_a: "working" });
    expect(s.graph?.nodes).toHaveLength(9);
    expect(s.nodeStatus.n1).toBe("written");
    expect(s.nodeStatus.n6).toBe("outline");
    expect(s.lastId).toBe(5);

    s = reduceEvents(s, [ev(5, "x", "started"), ev(6, "system", "version", { versionId: "v_1" })]);
    expect(s.agents.x).toBeUndefined(); // duplicate id ignored
    expect(s.versionId).toBe("v_1");
  });

  it("records validation errors and failures; a new start clears the failure", () => {
    let s = reduceEvents(emptyTimeline(), [
      ev(1, "system", "validation", { errors: [{ nodeId: "n2", message: "x", rule: "text", owner: "writer:a" }] }),
      ev(2, "system", "failed", { error: "boom" }),
    ]);
    expect(s.validationErrors).toEqual([{ nodeId: "n2", message: "x" }]);
    expect(s.failedError).toBe("boom");
    s = reduceEvents(s, [ev(3, "cast", "started")]);
    expect(s.failedError).toBeNull();
  });
});

describe("layoutGraph", () => {
  it("places nodes in columns by distance from start", () => {
    const g = graphOf(FIXTURES.skeleton());
    const pos = layoutGraph(g, "n1", { x: 100, y: 10 });
    expect(pos.n1.x).toBe(0);
    expect(pos.n2.x).toBe(100);
    expect(pos.n3.x).toBe(100);
    expect(pos.n4.x).toBe(200);
    expect(pos.e_secret.x).toBe(400);
    // nodes in one column are centred and do not overlap
    expect(pos.n2.y).not.toBe(pos.n3.y);
    expect(pos.n2.y + pos.n3.y).toBe(0);
  });

  it("puts unreachable nodes in an extra column", () => {
    const pos = layoutGraph({ nodes: [{ id: "a", type: "scene", label: "", owner: "a", chapter: 1 }, { id: "z", type: "scene", label: "", owner: "a", chapter: 1 }], edges: [] }, "a");
    expect(pos.z.x).toBeGreaterThan(pos.a.x);
  });
});

describe("parseMention", () => {
  const aliases = { 编剧: "writer_a", wen: "writer_a", 工程师: "engineer", kai: "engineer" };
  it("extracts a known mention anywhere in the text", () => {
    expect(parseMention("@工程师 换成暖色调", aliases)).toEqual({ agent: "engineer", text: "换成暖色调" });
    expect(parseMention("请 @Kai 把字体调大", aliases)).toEqual({ agent: "engineer", text: "请  把字体调大" });
  });
  it("ignores unknown mentions and plain text", () => {
    expect(parseMention("@nobody hi", aliases)).toEqual({ agent: null, text: "@nobody hi" });
    expect(parseMention("加一个结局", aliases)).toEqual({ agent: null, text: "加一个结局" });
  });
});

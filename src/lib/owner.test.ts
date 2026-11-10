import { describe, expect, it } from "vitest";
import { ensureOwnerId, hashIp } from "./owner";
import { newId } from "./ids";

describe("ensureOwnerId", () => {
  it("keeps a valid id", () => {
    const { id } = ensureOwnerId(undefined);
    expect(ensureOwnerId(id)).toEqual({ id, isNew: false });
  });

  it("replaces missing or malformed ids", () => {
    for (const bad of [undefined, null, "", "o_short", "x_aaaaaaaaaaaaaaaa", "o_AAAAAAAAAAAAAAAA"]) {
      const r = ensureOwnerId(bad);
      expect(r.isNew).toBe(true);
      expect(r.id).toMatch(/^o_[0-9a-z]{16}$/);
    }
  });
});

describe("newId", () => {
  it("has prefix and length, and is unique enough", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId("p")));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^p_[0-9a-z]{12}$/);
  });
});

describe("hashIp", () => {
  it("is stable, salted and does not leak the ip", async () => {
    const a = await hashIp("1.2.3.4", "s");
    expect(await hashIp("1.2.3.4", "s")).toBe(a);
    expect(await hashIp("1.2.3.4", "t")).not.toBe(a);
    expect(a).not.toContain("1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });
});

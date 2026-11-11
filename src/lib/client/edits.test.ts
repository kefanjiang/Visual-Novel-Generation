import { describe, expect, it } from "vitest";
import { editedFiles } from "./edits";

describe("editedFiles", () => {
  const base = { "/App.js": "a", "/story.json": "{}", "/package.json": "{}", "/public/index.html": "<html>" };

  it("reports nothing when the editor matches the baseline (template files included)", () => {
    expect(editedFiles(base, { ...base })).toEqual({ files: null, signature: "" });
  });

  it("returns every user file once something changed, without template-only files", () => {
    const r = editedFiles(base, { ...base, "/story.json": '{"x":1}' });
    expect(r.files).toEqual({ "/App.js": "a", "/story.json": '{"x":1}' });
    expect(r.signature).not.toBe("");
  });

  it("signature is stable for the same edit and changes with a different edit", () => {
    const a = editedFiles(base, { ...base, "/App.js": "b" }).signature;
    expect(editedFiles(base, { ...base, "/App.js": "b" }).signature).toBe(a);
    expect(editedFiles(base, { ...base, "/App.js": "c" }).signature).not.toBe(a);
  });

  it("counts added and removed files as edits", () => {
    expect(editedFiles(base, { ...base, "/extra.js": "x" }).files).toHaveProperty("/extra.js");
    const rest: Record<string, string> = { ...base };
    delete rest["/App.js"];
    expect(editedFiles(base, rest).files).not.toBeNull();
  });
});

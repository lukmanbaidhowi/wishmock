import { describe, expect, test } from "bun:test";
import { renderSchema } from "../frontend/lib/schema.js";

describe("frontend/lib/schema: renderSchema", () => {
  test("renders message with fields and flags", () => {
    const info = {
      kind: "message",
      name: "pkg.Message",
      fields: [
        { name: "id", id: 1, type: "int32", repeated: false, optional: false, map: false },
        { name: "tags", id: 2, type: "string", repeated: true, optional: false, map: false },
        { name: "meta", id: 3, type: "string", repeated: false, optional: false, map: true, keyType: "string" },
        { name: "opt", id: 4, type: "string", repeated: false, optional: true, map: false },
      ],
      oneofs: { sel: ["a", "b"] },
    } as any;

    const html = renderSchema("pkg.Message", info);
    expect(html).toContain("Message:");
    expect(html).toContain("id");
    expect(html).toContain("int32");
    expect(html).toContain("repeated");
    expect(html).toContain("optional");
    expect(html).toContain("map&lt;string, string&gt;");
    expect(html).toContain("oneof");
  });

  test("renders enum values", () => {
    const info = {
      kind: "enum",
      name: "pkg.Kind",
      values: { A: 0, B: 1 },
    } as any;
    const html = renderSchema("pkg.Kind", info);
    expect(html).toContain("Enum:");
    expect(html).toContain("A");
    expect(html).toContain("1");
  });

  test("escapes html in inputs", () => {
    const info = {
      kind: "message",
      name: "X",
      fields: [{ name: "<b>bad</b>", id: 1, type: "string" }],
    } as any;
    const html = renderSchema("<script>" as any, info);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });

  test("fallback on unknown", () => {
    const html = renderSchema("X", { kind: "unknown", name: "X" } as any);
    expect(html).toContain("unknown");
  });

  test("handles missing or non-object info", () => {
    const html = renderSchema("<x>", null as any);
    expect(html).toContain("No schema info for ");
    expect(html).toContain("&lt;x&gt;");
  });
});

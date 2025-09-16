import { describe, expect, test } from "bun:test";
import { allowFileByExt } from "../frontend/lib/files.js";

describe("frontend: allowFileByExt", () => {
  test("allows when extension matches (case-insensitive)", () => {
    expect(allowFileByExt("a.proto", [".proto"])).toBe(true);
    expect(allowFileByExt("B.PROTO", [".proto"])).toBe(true);
  });

  test("allows when exts empty", () => {
    expect(allowFileByExt("whatever", [])).toBe(true);
  });

  test("supports multiple extensions", () => {
    expect(allowFileByExt("file.yaml", [".yaml", ".yml"])).toBe(true);
    expect(allowFileByExt("file.yml", [".yaml", ".yml"])).toBe(true);
    expect(allowFileByExt("file.json", [".yaml", ".yml"])).toBe(false);
  });
});

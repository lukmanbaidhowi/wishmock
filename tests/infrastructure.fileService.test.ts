import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { writeFileAtPath } from "../src/infrastructure/fileService.js";

function makeTempRoot(): string {
  const base = path.join(process.cwd(), "tmp", "fileService");
  fs.mkdirSync(base, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("infrastructure/fileService: writeFileAtPath", () => {
  test("writes file under nested directories and returns absolute path", () => {
    const root = makeTempRoot();
    const rel = path.join("nested", "dir", "file.txt");
    const content = "hello world";
    const abs = writeFileAtPath(root, rel, content);

    expect(abs).toBe(path.resolve(root, rel));
    const onDisk = fs.readFileSync(abs, "utf8");
    expect(onDisk).toBe(content);
  });

  test("throws if relPath escapes root directory", () => {
    const root = makeTempRoot();
    expect(() => writeFileAtPath(root, path.join("..", "escape.txt"), "oops"))
      .toThrow("resolved path escapes root directory");
  });
});

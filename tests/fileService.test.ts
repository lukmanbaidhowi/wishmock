import { describe, it, expect, beforeEach } from "bun:test";
import fs from "fs";
import path from "path";
import { listFiles, readFile, writeFile } from "../src/infrastructure/fileService.js";

function makeTmpDir(prefix = "fs-") {
  const base = path.join("tmp");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, prefix));
  return dir;
}

describe("fileService", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("fileService-");
  });

  describe("listFiles", () => {
    it("filters by extensions", () => {
      // Arrange
      const files = [
        "a.proto",
        "b.proto",
        "c.yaml",
        "d.json",
        "e.txt",
      ];
      for (const f of files) {
        fs.writeFileSync(path.join(dir, f), "x", "utf8");
      }

      // Act
      const onlyProto = listFiles(dir, [".proto"]);
      const onlyRules = listFiles(dir, [".yaml", ".json"]);

      // Assert
      expect(onlyProto.map(f => f.filename).sort()).toEqual(["a.proto", "b.proto"]);
      expect(onlyRules.map(f => f.filename).sort()).toEqual(["c.yaml", "d.json"]);
    });
  });

  describe("readFile", () => {
    it("reads existing file content", () => {
      const fname = "hello.txt";
      const content = "hello world";
      fs.writeFileSync(path.join(dir, fname), content, "utf8");

      const got = readFile(dir, fname);
      expect(got).toBe(content);
    });

    it("throws when file not found", () => {
      expect(() => readFile(dir, "missing.txt")).toThrow("File not found: missing.txt");
    });
  });

  describe("writeFile", () => {
    it("writes file successfully to tmp dir", () => {
      const fname = "out.txt";
      const content = "content-123";
      const savedPath = writeFile(dir, fname, content);

      expect(savedPath).toBe(path.join(dir, fname));
      const written = fs.readFileSync(savedPath, "utf8");
      expect(written).toBe(content);
    });
  });
});


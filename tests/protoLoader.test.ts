import { describe, it, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import protobuf from "protobufjs";
import { loadProtos } from "../src/infrastructure/protoLoader.js";

describe("protoLoader", () => {
  it("returns an empty root when no protos are available", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wishmock-empty-protos-"));
    try {
      const { root, report } = await loadProtos(tmpDir);
      expect(report.length).toBe(0);
      expect(root).toBeInstanceOf(protobuf.Root);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

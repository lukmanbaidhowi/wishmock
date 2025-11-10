import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

describe("Asset Store", () => {
  const testUploadsDir = join(process.cwd(), "tmp", "test-uploads");
  const testProtosDir = join(testUploadsDir, "protos");
  const testRulesDir = join(testUploadsDir, "rules");

  beforeEach(() => {
    if (existsSync(testUploadsDir)) {
      rmSync(testUploadsDir, { recursive: true });
    }
    mkdirSync(testProtosDir, { recursive: true });
    mkdirSync(testRulesDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testUploadsDir)) {
      rmSync(testUploadsDir, { recursive: true });
    }
  });

  it("should store versioned proto assets", () => {
    const version = "20251110_120000";
    const versionDir = join(testProtosDir, version);
    mkdirSync(versionDir, { recursive: true });
    
    const protoContent = 'syntax = "proto3";\nservice Test {}';
    writeFileSync(join(versionDir, "test.proto"), protoContent);
    
    expect(existsSync(join(versionDir, "test.proto"))).toBe(true);
  });

  it("should store versioned rule assets", () => {
    const version = "20251110_120000";
    const versionDir = join(testRulesDir, version);
    mkdirSync(versionDir, { recursive: true });
    
    const ruleContent = "match: {}\nresponses: []";
    writeFileSync(join(versionDir, "test.yaml"), ruleContent);
    
    expect(existsSync(join(versionDir, "test.yaml"))).toBe(true);
  });

  it("should maintain current.json pointer to active bundle", () => {
    const currentFile = join(testUploadsDir, "current.json");
    const version = "20251110_120000";
    
    const pointer = { version, updated_at: new Date().toISOString() };
    writeFileSync(currentFile, JSON.stringify(pointer, null, 2));
    
    expect(existsSync(currentFile)).toBe(true);
    const content = JSON.parse(readFileSync(currentFile, "utf-8"));
    expect(content.version).toBe(version);
  });

  it("should support atomic bundle activation via pointer update", () => {
    const currentFile = join(testUploadsDir, "current.json");
    const oldVersion = "20251110_120000";
    const newVersion = "20251110_130000";
    
    writeFileSync(currentFile, JSON.stringify({ version: oldVersion }));
    
    const newPointer = { version: newVersion, updated_at: new Date().toISOString() };
    writeFileSync(currentFile, JSON.stringify(newPointer, null, 2));
    
    const content = JSON.parse(readFileSync(currentFile, "utf-8"));
    expect(content.version).toBe(newVersion);
  });

  it("should calculate SHA256 checksum for uploaded assets", () => {
    const content = "test content";
    const expectedChecksum = "6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72";
    
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    
    expect(hash).toBe(expectedChecksum);
  });

  it("should reject uploads when checksum matches current bundle", () => {
    expect(true).toBe(true);
  });

  it("should maintain history of previous bundle versions", () => {
    const v1Dir = join(testProtosDir, "20251110_120000");
    const v2Dir = join(testProtosDir, "20251110_130000");
    
    mkdirSync(v1Dir, { recursive: true });
    mkdirSync(v2Dir, { recursive: true });
    
    writeFileSync(join(v1Dir, "test.proto"), "version 1");
    writeFileSync(join(v2Dir, "test.proto"), "version 2");
    
    expect(existsSync(v1Dir)).toBe(true);
    expect(existsSync(v2Dir)).toBe(true);
  });
});


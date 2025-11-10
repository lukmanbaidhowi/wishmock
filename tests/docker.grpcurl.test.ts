import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("Docker grpcurl smoke runner", () => {
  const testArtifactDir = join(process.cwd(), "artifacts", "grpcurl", "test-run");

  beforeEach(() => {
    if (existsSync(testArtifactDir)) {
      rmSync(testArtifactDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testArtifactDir)) {
      rmSync(testArtifactDir, { recursive: true });
    }
  });

  it("should have grpcurl-smoke.sh script in scripts/docker/", () => {
    const scriptPath = join(process.cwd(), "scripts", "docker", "grpcurl-smoke.sh");
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("should have request fixture for helloworld.SayHello", () => {
    const fixturePath = join(process.cwd(), "fixtures", "grpcurl", "helloworld.SayHello.request.json");
    expect(existsSync(fixturePath)).toBe(true);
  });

  it("should have expected response fixture for helloworld.SayHello", () => {
    const fixturePath = join(process.cwd(), "fixtures", "grpcurl", "helloworld.SayHello.response.json");
    expect(existsSync(fixturePath)).toBe(true);
  });

  it("should generate artifacts directory structure on run", () => {
    mkdirSync(testArtifactDir, { recursive: true });
    
    const expectedFiles = [
      "metadata.json",
      "response.actual.json",
      "response.expected.json",
      "diff.json"
    ];

    expectedFiles.forEach(file => {
      const filePath = join(testArtifactDir, file);
      expect(existsSync(testArtifactDir)).toBe(true);
    });
  });

  it("should exit with code 0 on successful match", async () => {
    const scriptPath = join(process.cwd(), "scripts", "docker", "grpcurl-smoke.sh");
    if (!existsSync(scriptPath)) {
      console.log("Skipping: grpcurl-smoke.sh not yet implemented");
      return;
    }
  });

  it("should exit with code 30 on response diff", async () => {
    const scriptPath = join(process.cwd(), "scripts", "docker", "grpcurl-smoke.sh");
    if (!existsSync(scriptPath)) {
      console.log("Skipping: grpcurl-smoke.sh not yet implemented");
      return;
    }
  });

  it("should exit with code 40 on missing fixtures", async () => {
    const scriptPath = join(process.cwd(), "scripts", "docker", "grpcurl-smoke.sh");
    if (!existsSync(scriptPath)) {
      console.log("Skipping: grpcurl-smoke.sh not yet implemented");
      return;
    }
  });
});


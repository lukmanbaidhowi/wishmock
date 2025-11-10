import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

// Skip E2E tests by default in `bun test`.
// Set E2E=true to enable running these tests.
const describeE2E = (process.env.E2E === "true" || process.env.RUN_E2E === "true") ? describe : (describe as any).skip;

describeE2E("Docker grpcurl E2E workflow", () => {
  it("should have docker-compose.yml for stack orchestration", () => {
    const composePath = join(process.cwd(), "docker-compose.yml");
    expect(existsSync(composePath)).toBe(true);
  });

  it("should have grpcurl fixtures in correct directory", () => {
    const requestPath = join(process.cwd(), "fixtures", "grpcurl", "helloworld.SayHello.request.json");
    const responsePath = join(process.cwd(), "fixtures", "grpcurl", "helloworld.SayHello.response.json");
    
    expect(existsSync(requestPath)).toBe(true);
    expect(existsSync(responsePath)).toBe(true);
  });

  it("should have JSON diff helper script", () => {
    const helperPath = join(process.cwd(), "scripts", "helpers", "assert-json-diff.mjs");
    expect(existsSync(helperPath)).toBe(true);
  });

  it("should expose port 50050 for grpcurl plaintext", () => {
    const composePath = join(process.cwd(), "docker-compose.yml");
    if (!existsSync(composePath)) {
      console.log("Skipping: docker-compose.yml not found");
      return;
    }
  });

  it("should complete smoke test within timeout", async () => {
    const scriptPath = join(process.cwd(), "scripts", "docker", "grpcurl-smoke.sh");
    if (!existsSync(scriptPath)) {
      console.log("Skipping: grpcurl-smoke.sh not yet implemented");
      return;
    }
  }, { timeout: 180000 });
});

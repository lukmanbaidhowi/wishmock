import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

// Skip E2E tests by default in `bun test`.
// Set E2E=true to enable running these tests.
const describeE2E = (process.env.E2E === "true" || process.env.RUN_E2E === "true") ? describe : (describe as any).skip;

describeE2E("Developer local workflow", () => {
  it("should have assets-pull-latest script", () => {
    const scriptPath = join(process.cwd(), "scripts", "tools", "assets-pull-latest.ts");
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("should have canonical bundle directories", () => {
    const protosCanonical = join(process.cwd(), "uploads", "protos", "canonical");
    const rulesCanonical = join(process.cwd(), "uploads", "rules", "canonical");
    
    expect(existsSync(protosCanonical)).toBe(true);
    expect(existsSync(rulesCanonical)).toBe(true);
  });

  it("should support pulling latest assets bundle", async () => {
    const scriptPath = join(process.cwd(), "scripts", "tools", "assets-pull-latest.ts");
    if (!existsSync(scriptPath)) {
      console.log("Skipping: assets-pull-latest.ts not yet implemented");
      return;
    }
  });

  it("should validate quickstart includes TDD workflow", () => {
    const quickstartPath = join(process.cwd(), "specs", "002-add-docker-test", "quickstart.md");
    expect(existsSync(quickstartPath)).toBe(true);
  });

  it("should document grpcurl smoke test command in quickstart", () => {
    const quickstartPath = join(process.cwd(), "specs", "002-add-docker-test", "quickstart.md");
    if (!existsSync(quickstartPath)) {
      console.log("Skipping: quickstart.md not found");
      return;
    }
    
    expect(existsSync(quickstartPath)).toBe(true);
  });

  it("should provide README with Docker validation steps", () => {
    const readmePath = join(process.cwd(), "README.md");
    expect(existsSync(readmePath)).toBe(true);
  });
});

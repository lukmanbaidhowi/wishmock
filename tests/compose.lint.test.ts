import { describe, test, expect, beforeAll } from "bun:test";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const execAsync = promisify(exec);

const LINT_SCRIPT = join(process.cwd(), "scripts/compose/lint.sh");
const TEST_TEMP_DIR = join(process.cwd(), "tmp/test-compose-lint");

describe("compose lint script", () => {
  beforeAll(async () => {
    await mkdir(TEST_TEMP_DIR, { recursive: true });
  });

  test("exits with error when --file is missing", async () => {
    try {
      await execAsync(`${LINT_SCRIPT}`);
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("--file is required");
    }
  });

  test("exits with error when compose file does not exist", async () => {
    const nonExistentFile = join(TEST_TEMP_DIR, "nonexistent.yml");
    try {
      await execAsync(`${LINT_SCRIPT} --file ${nonExistentFile}`);
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Compose file not found");
    }
  });

  test("exits with error for invalid compose syntax", async () => {
    const invalidCompose = join(TEST_TEMP_DIR, "invalid.yml");
    await writeFile(invalidCompose, "invalid: yaml: content:\n  - broken");

    try {
      await execAsync(`${LINT_SCRIPT} --file ${invalidCompose}`);
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.code).toBe(2);
      expect(error.stderr).toContain("ERROR: Lint failed");
    }
  });

  test("succeeds for valid compose file", async () => {
    const validCompose = join(TEST_TEMP_DIR, "valid.yml");
    const validContent = `
services:
  test:
    image: alpine:latest
    command: echo "test"
`;
    await writeFile(validCompose, validContent);

    const { stdout, stderr } = await execAsync(`${LINT_SCRIPT} --file ${validCompose}`);
    expect(stdout).toContain('"status": "ok"');
    expect(stdout).toContain('"file":');
    expect(stderr).toBe("");
  });

  test("generates artifact with lint results", async () => {
    const validCompose = join(TEST_TEMP_DIR, "artifact-test.yml");
    const validContent = `
services:
  test:
    image: alpine:latest
`;
    await writeFile(validCompose, validContent);

    const { stdout } = await execAsync(`${LINT_SCRIPT} --file ${validCompose}`);
    
    const lines = stdout.trim().split('\n');
    const jsonStartIndex = lines.findIndex(line => line.trim().startsWith('{'));
    expect(jsonStartIndex).toBeGreaterThanOrEqual(0);
    
    const jsonLines = lines.slice(jsonStartIndex);
    const jsonText = jsonLines.join('\n');
    const result = JSON.parse(jsonText);
    
    expect(result.file).toContain("artifact-test.yml");
    expect(result.status).toBe("ok");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("shows help message with --help", async () => {
    const { stdout } = await execAsync(`${LINT_SCRIPT} --help`);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--file");
    expect(stdout).toContain("--strict");
  });
});


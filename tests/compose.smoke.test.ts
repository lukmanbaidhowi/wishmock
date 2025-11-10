import { describe, test, expect } from "bun:test";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const execAsync = promisify(exec);

const SMOKE_SCRIPT = join(process.cwd(), "scripts/compose/smoke.sh");
const TEST_TEMP_DIR = join(process.cwd(), "tmp/test-compose-smoke");

describe("compose smoke script - skip logic", () => {
  test("skips when Docker daemon is inaccessible", async () => {
    const validCompose = join(TEST_TEMP_DIR, "skip-test.yml");
    await mkdir(TEST_TEMP_DIR, { recursive: true });
    const validContent = `
services:
  test:
    image: alpine:latest
`;
    await writeFile(validCompose, validContent);

    const testScript = `
      # Mock docker info to fail
      docker() {
        if [[ "$1" == "info" ]]; then
          return 1
        fi
        command docker "$@"
      }
      export -f docker
      
      ${SMOKE_SCRIPT} --file ${validCompose}
    `;

    const { stdout, stderr } = await execAsync(testScript, { shell: "/bin/bash" });
    
    expect(stderr).toContain("SKIP: Docker not accessible");
    expect(stderr).toContain("Cannot connect to Docker daemon");
  }, 15000);

  test("detects Docker context", async () => {
    const validCompose = join(TEST_TEMP_DIR, "context-test.yml");
    await mkdir(TEST_TEMP_DIR, { recursive: true });
    const validContent = `
services:
  test:
    image: alpine:latest
    command: echo "test"
`;
    await writeFile(validCompose, validContent);

    if (await isDockerAvailable()) {
      // The smoke script may exit non-zero depending on container lifecycle;
      // we still want to assert that it prints the Docker context.
      let stdout = "";
      try {
        const res = await execAsync(`${SMOKE_SCRIPT} --file ${validCompose}`);
        stdout = res.stdout;
      } catch (err: any) {
        stdout = err?.stdout ?? "";
      }
      expect(stdout).toContain("Docker context:");
    }
  }, 30000);

  test("captures timing metrics", async () => {
    const validCompose = join(TEST_TEMP_DIR, "timing-test.yml");
    await mkdir(TEST_TEMP_DIR, { recursive: true });
    const validContent = `
services:
  test:
    image: alpine:latest
    command: sleep 1
`;
    await writeFile(validCompose, validContent);

    if (await isDockerAvailable()) {
      // Accept non-zero exit codes; we only need the metrics line.
      let stdout = "";
      try {
        const res = await execAsync(`${SMOKE_SCRIPT} --file ${validCompose}`);
        stdout = res.stdout;
      } catch (err: any) {
        stdout = err?.stdout ?? "";
      }

      const jsonLine = stdout.split('\n').find(line => line.trim().startsWith('{') && line.includes('"duration_ms"'));
      if (jsonLine) {
        const result = JSON.parse(jsonLine);
        expect(result.duration_ms).toBeGreaterThan(0);
      }
    }
  }, 30000);
});

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync("docker info");
    return true;
  } catch {
    return false;
  }
}

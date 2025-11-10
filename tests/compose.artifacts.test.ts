import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const execAsync = promisify(exec);

const TEST_ARTIFACTS_DIR = join(process.cwd(), "tmp/test-artifacts");

describe("compose artifact helpers", () => {
  beforeAll(async () => {
    await rm(TEST_ARTIFACTS_DIR, { recursive: true, force: true });
    await mkdir(TEST_ARTIFACTS_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_ARTIFACTS_DIR, { recursive: true, force: true });
  });

  test("creates timestamped artifact directory", async () => {
    const testScript = `
      source scripts/compose/_artifacts.sh
      ARTIFACTS_BASE_DIR="${TEST_ARTIFACTS_DIR}"
      artifact_dir=$(create_artifact_dir)
      echo "$artifact_dir"
    `;

    const { stdout } = await execAsync(testScript, { shell: "/bin/bash" });
    const artifactDir = stdout.trim();

    expect(artifactDir).toContain(TEST_ARTIFACTS_DIR);
    expect(artifactDir).toMatch(/\d{8}_\d{6}$/);

    const entries = await readdir(TEST_ARTIFACTS_DIR);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/\d{8}_\d{6}/);
  });

  test("ensures base artifacts directory exists", async () => {
    const newBaseDir = join(TEST_ARTIFACTS_DIR, "nested/path");
    
    const testScript = `
      source scripts/compose/_artifacts.sh
      ARTIFACTS_BASE_DIR="${newBaseDir}"
      ensure_artifacts_base
    `;

    await execAsync(testScript, { shell: "/bin/bash" });

    const entries = await readdir(newBaseDir);
    expect(entries).toBeDefined();
  });

  test("writes artifact file with content", async () => {
    const testScript = `
      source scripts/compose/_artifacts.sh
      ARTIFACTS_BASE_DIR="${TEST_ARTIFACTS_DIR}"
      artifact_dir=$(create_artifact_dir)
      echo "test content" | write_artifact "$artifact_dir" "test.txt"
      echo "$artifact_dir"
    `;

    const { stdout } = await execAsync(testScript, { shell: "/bin/bash" });
    const artifactDir = stdout.trim().split('\n').pop()!;

    const content = await readFile(join(artifactDir, "test.txt"), "utf-8");
    expect(content.trim()).toBe("test content");
  });

  test("writes artifact with inline content parameter", async () => {
    const testScript = `
      source scripts/compose/_artifacts.sh
      ARTIFACTS_BASE_DIR="${TEST_ARTIFACTS_DIR}"
      artifact_dir=$(create_artifact_dir)
      write_artifact "$artifact_dir" "inline.txt" "inline content here"
      echo "$artifact_dir"
    `;

    const { stdout } = await execAsync(testScript, { shell: "/bin/bash" });
    const artifactDir = stdout.trim().split('\n').pop()!;

    const content = await readFile(join(artifactDir, "inline.txt"), "utf-8");
    expect(content.trim()).toBe("inline content here");
  });

  test("fails when artifact_dir is missing", async () => {
    const testScript = `
      source scripts/compose/_artifacts.sh
      write_artifact "" "file.txt" "content"
    `;

    try {
      await execAsync(testScript, { shell: "/bin/bash" });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.stderr).toContain("write_artifact requires artifact_dir");
    }
  });

  test("fails when filename is missing", async () => {
    const testScript = `
      source scripts/compose/_artifacts.sh
      ARTIFACTS_BASE_DIR="${TEST_ARTIFACTS_DIR}"
      artifact_dir=$(create_artifact_dir)
      write_artifact "$artifact_dir" ""
    `;

    try {
      await execAsync(testScript, { shell: "/bin/bash" });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.stderr).toContain("write_artifact requires artifact_dir");
    }
  });

  test("creates nested artifact files", async () => {
    const testScript = `
      source scripts/compose/_artifacts.sh
      ARTIFACTS_BASE_DIR="${TEST_ARTIFACTS_DIR}"
      artifact_dir=$(create_artifact_dir)
      mkdir -p "$artifact_dir/smoke"
      write_artifact "$artifact_dir" "smoke/logs.txt" "nested log content"
      echo "$artifact_dir"
    `;

    const { stdout } = await execAsync(testScript, { shell: "/bin/bash" });
    const artifactDir = stdout.trim().split('\n').pop()!;

    const content = await readFile(join(artifactDir, "smoke/logs.txt"), "utf-8");
    expect(content.trim()).toBe("nested log content");
  });

  test("multiple artifact dirs have unique timestamps", async () => {
    const testScript = `
      source scripts/compose/_artifacts.sh
      ARTIFACTS_BASE_DIR="${TEST_ARTIFACTS_DIR}"
      dir1=$(create_artifact_dir)
      sleep 1
      dir2=$(create_artifact_dir)
      echo "$dir1"
      echo "$dir2"
    `;

    const { stdout } = await execAsync(testScript, { shell: "/bin/bash" });
    const [dir1, dir2] = stdout.trim().split('\n');

    expect(dir1).not.toBe(dir2);
    
    const entries = await readdir(TEST_ARTIFACTS_DIR);
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});


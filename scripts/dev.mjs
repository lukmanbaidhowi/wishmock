import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const distEntry = path.resolve("dist/app.js");

function run(cmd, args, name) {
  const child = spawn(cmd, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[dev] ${name} exited via signal ${signal}`);
    } else {
      console.log(`[dev] ${name} exited with code ${code}`);
    }
  });
  child.on("error", (err) => {
    console.error(`[dev] ${name} failed to start:`, err);
  });
  return child;
}

function waitForFile(file, timeoutMs = 30000, intervalMs = 300) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`Timeout waiting for ${file}`));
      }
    }, intervalMs);
  });
}

const procs = [];

// 1) Start TypeScript build in watch mode
const builder = run("bun", ["run", "build:watch"], "tsc-watch");
procs.push(builder);

// 2) After initial build output exists, start app with bun --watch
waitForFile(distEntry)
  .then(() => {
    const app = run("bun", ["--watch", distEntry], "app");
    procs.push(app);
  })
  .catch((e) => {
    console.error("[dev]", e.message);
    process.exitCode = 1;
  });

function shutdown() {
  console.log("[dev] Shutting down...");
  for (const p of procs) {
    try { p.kill("SIGINT"); } catch {}
  }
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);


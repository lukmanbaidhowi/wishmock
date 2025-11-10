#!/usr/bin/env node
// Simulate protoLoader.ts behavior to identify which top-level protos can be
// loaded by protobufjs. This mirrors runtime behavior for "main" protos.

import fs from "fs";
import path from "path";
import protobuf from "protobufjs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, "..", "protos");

async function getLoadableProtos() {
  const files = fs.readdirSync(PROTO_DIR).filter(f => f.endsWith(".proto"));
  const filePaths = files.map(f => path.join(PROTO_DIR, f));

  const root = new protobuf.Root();
  root.resolvePath = (origin, target) => {
    if (path.isAbsolute(target) && fs.existsSync(target)) return target;
    if (origin) {
      const rel = path.resolve(path.dirname(origin), target);
      if (fs.existsSync(rel)) return rel;
    }
    const fromRoot = path.resolve(PROTO_DIR, target);
    if (fs.existsSync(fromRoot)) return fromRoot;
    return path.resolve(path.dirname(origin || PROTO_DIR), target);
  };

  const loaded = [];
  const skipped = [];

  try {
    await root.load(filePaths);
    loaded.push(...files);
  } catch (err) {
    const freshRoot = new protobuf.Root();
    freshRoot.resolvePath = root.resolvePath;

    for (const f of files) {
      const abs = path.join(PROTO_DIR, f);
      try {
        await freshRoot.load(abs);
        loaded.push(f);
      } catch (innerErr) {
        skipped.push(f);
      }
    }
  }

  return { loaded, skipped };
}

const { loaded, skipped } = await getLoadableProtos();

console.log(loaded.join(" "));

if (skipped.length > 0) {
  console.error(`[get-loadable-protos] Skipped (protobufjs): ${skipped.join(", ")}`);
}



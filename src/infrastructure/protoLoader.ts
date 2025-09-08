import fs from "fs";
import path from "path";
import protobuf from "protobufjs";

export type ProtoFileStatus = {
  file: string;
  status: "loaded" | "skipped";
  error?: string;
};

export type ProtoLoadResult = {
  root: protobuf.Root;
  report: ProtoFileStatus[];
};

export async function loadProtos(protoDir: string): Promise<ProtoLoadResult> {
  const files = fs.readdirSync(protoDir).filter(f => f.endsWith(".proto"));
  if (files.length === 0) throw new Error(`No .proto in ${protoDir}`);
  const filePaths = files.map(f => path.join(protoDir, f));

  // Create a custom root so we can resolve imports from the protos/ root as well
  // as relative to the importing file. This avoids issues like trying to resolve
  // "google/protobuf/descriptor.proto" relative to a nested vendor directory.
  const root = new protobuf.Root();
  const exists = (p: string) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  root.resolvePath = (origin, target) => {
    // If target is already absolute and exists, return it.
    if (path.isAbsolute(target) && exists(target)) return target;

    // Try relative to the origin (protobufjs default behavior)
    if (origin) {
      const rel = path.resolve(path.dirname(origin), target);
      if (exists(rel)) return rel;
    }

    // Try resolving from the protos/ root as an include path
    const fromRoot = path.resolve(protoDir, target);
    if (exists(fromRoot)) return fromRoot;

    // As a last attempt, return what protobufjs would do; this will surface a
    // helpful ENOENT with the attempted path.
    return path.resolve(path.dirname(origin || protoDir), target);
  };

  const report: ProtoFileStatus[] = [];

  // Try load-all first for efficiency; if it fails, fall back to per-file skipping
  try {
    const rootNamespace = await root.load(filePaths);
    // If load-all succeeds, mark all as loaded
    for (const f of files) report.push({ file: f, status: "loaded" });
    return { root: rootNamespace, report };
  } catch (e: any) {
    // Fall back: attempt to load files individually, skipping those that error.
    // Use a fresh Root to avoid partial state from the failed bulk load.
    const rootNamespace = new protobuf.Root();
    const exists = (p: string) => {
      try { return fs.statSync(p).isFile(); } catch { return false; }
    };
    rootNamespace.resolvePath = (origin, target) => {
      if (path.isAbsolute(target) && exists(target)) return target;
      if (origin) {
        const rel = path.resolve(path.dirname(origin), target);
        if (exists(rel)) return rel;
      }
      const fromRoot = path.resolve(protoDir, target);
      if (exists(fromRoot)) return fromRoot;
      return path.resolve(path.dirname(origin || protoDir), target);
    };
    for (const f of files) {
      const abs = path.join(protoDir, f);
      try {
        await rootNamespace.load(abs);
        report.push({ file: f, status: "loaded" });
      } catch (err: any) {
        report.push({ file: f, status: "skipped", error: String(err?.message || err) });
      }
    }
    // If nothing loaded, rethrow the original error to signal boot issue
    if (!report.some(r => r.status === "loaded")) throw e;
    return { root: rootNamespace, report };
  }
}

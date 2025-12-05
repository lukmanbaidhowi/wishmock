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

function createRoot(protoDir: string): protobuf.Root {
  const root = new protobuf.Root();
  const exists = (p: string) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  root.resolvePath = (origin, target) => {
    if (path.isAbsolute(target) && exists(target)) return target;

    if (origin) {
      const rel = path.resolve(path.dirname(origin), target);
      if (exists(rel)) return rel;
    }

    const fromRoot = path.resolve(protoDir, target);
    if (exists(fromRoot)) return fromRoot;

    return path.resolve(path.dirname(origin || protoDir), target);
  };
  return root;
}

export async function loadProtos(protoDir: string): Promise<ProtoLoadResult> {
  const files = fs.readdirSync(protoDir).filter(f => f.endsWith(".proto"));
  const report: ProtoFileStatus[] = [];

  if (files.length === 0) {
    return { root: createRoot(protoDir), report };
  }

  const filePaths = files.map(f => path.join(protoDir, f));
  const root = createRoot(protoDir);

  try {
    const rootNamespace = await root.load(filePaths);
    for (const f of files) report.push({ file: f, status: "loaded" });
    return { root: rootNamespace, report };
  } catch (e: any) {
    const rootNamespace = createRoot(protoDir);
    for (const f of files) {
      const abs = path.join(protoDir, f);
      try {
        await rootNamespace.load(abs);
        report.push({ file: f, status: "loaded" });
      } catch (err: any) {
        report.push({ file: f, status: "skipped", error: String(err?.message || err) });
      }
    }
    if (!report.some(r => r.status === "loaded")) throw e;
    return { root: rootNamespace, report };
  }
}

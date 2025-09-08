import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import { loadProtos, type ProtoFileStatus } from "./infrastructure/protoLoader.js";
import { loadRules as loadRulesFromDisk } from "./infrastructure/ruleLoader.js";
import { createGrpcServer, type HandlerMeta } from "./infrastructure/grpcServer.js";
import { createAdminApp } from "./interfaces/httpAdmin.js";

const GRPC_PORT = process.env.GRPC_PORT || 50051;
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const PROTO_DIR = path.resolve("protos");
const RULE_DIR = path.resolve("rules");
const UPLOAD_DIR = path.resolve("uploads");

// ----- state -----
let server: grpc.Server | null = null;
let servicesKeys: string[] = [];
let servicesMeta: Map<string, HandlerMeta> = new Map();
let currentRoot: protobuf.Root | null = null;
let protoReport: ProtoFileStatus[] = [];
const rulesIndex = new Map<string, any>();

// --- util: logging ---
const log = (...a: any[]) => console.log("[grpc-server-mock]", ...a);
const err = (...a: any[]) => console.error("[grpc-server-mock]", ...a);

async function startGrpc(rootNamespace: protobuf.Root) {
  if (server) {
    await new Promise<void>((resolve, reject) => server!.tryShutdown((e?: Error) => (e ? reject(e) : resolve())));
    server = null;
  }
  const { server: s, servicesMap } = await createGrpcServer(rootNamespace, rulesIndex, log, err);
  servicesMeta = servicesMap;
  servicesKeys = [...servicesMap.keys()];
  await new Promise<void>((resolve, reject) => {
    s.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (e) => {
      if (e) return reject(e);
      log(`gRPC listening on ${GRPC_PORT}`);
      resolve();
    });
  });
  server = s;
}

async function rebuild(reason: string) {
  try {
    const { root, report } = await loadProtos(PROTO_DIR);
    protoReport = report;
    currentRoot = root;
    const loaded = report.filter(r => r.status === "loaded").map(r => r.file);
    const skipped = report.filter(r => r.status === "skipped");
    await startGrpc(root);
    log(`Rebuilt & restarted (reason: ${reason})`);
    if (loaded.length) log(`Loaded protos: ${loaded.join(", ")}`);
    if (skipped.length) {
      for (const s of skipped) err(`Skipped proto: ${s.file} (${s.error || "unknown error"})`);
    }
  } catch (e) {
    err("Rebuild failed:", e);
  }
}

function reloadRules() {
  const fresh = loadRulesFromDisk(RULE_DIR);
  rulesIndex.clear();
  for (const [k, v] of fresh.entries()) rulesIndex.set(k, v);
  log(`Loaded rules: ${[...rulesIndex.keys()].join(", ") || "(none)"}`);
}

// --- initial boot ---
(async () => {
  if (!fs.existsSync(PROTO_DIR)) fs.mkdirSync(PROTO_DIR, { recursive: true });
  if (!fs.existsSync(RULE_DIR)) fs.mkdirSync(RULE_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  await rebuild("boot");
  reloadRules();

  // watchers (hot-reload)
  const isBun = typeof (globalThis as any).Bun !== "undefined";
  const watchOpts: any = { ignoreInitial: true, ...(isBun ? { usePolling: true, interval: 500, binaryInterval: 500 } : {}) };

  try {
    const protoWatcher = chokidar.watch(PROTO_DIR, watchOpts);
    protoWatcher.on("all", async () => { await rebuild(".proto changed"); });
    protoWatcher.on("error", (e: unknown) => err("Watcher error (protos)", e));
  } catch (e) {
    err("Failed to start proto watcher; continuing without hot reload", e);
  }

  try {
    const ruleWatcher = chokidar.watch(RULE_DIR, watchOpts);
    ruleWatcher.on("all", async () => { reloadRules(); log("Rules reloaded"); });
    ruleWatcher.on("error", (e: unknown) => err("Watcher error (rules)", e));
  } catch (e) {
    err("Failed to start rule watcher; continuing without hot reload", e);
  }

  // HTTP admin (upload proto/rules)
  createAdminApp({
    httpPort: HTTP_PORT,
    protoDir: PROTO_DIR,
    ruleDir: RULE_DIR,
    uploadsDir: UPLOAD_DIR,
    getStatus: () => ({
      grpc_port: GRPC_PORT,
      loaded_services: servicesKeys,
      rules: [...rulesIndex.keys()],
      protos: {
        loaded: protoReport.filter(r => r.status === "loaded").map(r => r.file),
        skipped: protoReport.filter(r => r.status === "skipped")
      }
    }),
    listServices: () => {
      // Group HandlerMeta by service
      const byService = new Map<string, { pkg: string; service: string; methods: any[] }>();
      for (const [fqmn, meta] of servicesMeta.entries()) {
        const fullServiceName = meta.pkg ? `${meta.pkg}.${meta.serviceName}` : meta.serviceName;
        if (!byService.has(fullServiceName)) byService.set(fullServiceName, { pkg: meta.pkg, service: meta.serviceName, methods: [] });
        byService.get(fullServiceName)!.methods.push({
          name: meta.methodName,
          full_method: fqmn,
          rule_key: meta.ruleKey,
          request_type: meta.reqType.fullName?.replace(/^\./, "") || meta.reqType.name,
          response_type: meta.resType.fullName?.replace(/^\./, "") || meta.resType.name,
        });
      }
      return { services: [...byService.entries()].map(([name, v]) => ({ name, package: v.pkg, service: v.service, methods: v.methods })) };
    },
    getSchema: (typeName: string) => {
      const root = currentRoot;
      if (!root) return null;
      const norm = typeName?.startsWith(".") ? typeName : `.${typeName}`;
      const found = root.lookup(norm);
      if (!found) return undefined;
      // Message type
      if ((found as any).fields) {
        const t = found as unknown as protobuf.Type;
        const fields = t.fieldsArray.map((f) => {
          const keyType = (f as any).keyType as string | undefined;
          const isMap = typeof keyType === "string" && keyType.length > 0;
          return {
            name: f.name,
            id: f.id,
            type: f.type,
            repeated: !!f.repeated,
            optional: !!(f.options && (f.options as any).proto3_optional),
            map: isMap,
            keyType: isMap ? keyType : undefined,
          };
        });
        const oneofs = t.oneofs ? Object.fromEntries(Object.entries(t.oneofs).map(([k, v]) => [k, (v as any).oneof])) : undefined;
        return {
          kind: "message",
          name: t.fullName?.replace(/^\./, "") || t.name,
          fields,
          oneofs,
        };
      }
      // Enum type
      if ((found as any).values) {
        const e = found as unknown as protobuf.Enum;
        return {
          kind: "enum",
          name: e.fullName?.replace(/^\./, "") || e.name,
          values: e.values,
        };
      }
      return { kind: "unknown", name: (found as any).fullName?.replace(/^\./, "") || (found as any).name };
    },
    onRuleUpdated: () => reloadRules()
  });
})();

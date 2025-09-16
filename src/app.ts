import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import { loadProtos, type ProtoFileStatus } from "./infrastructure/protoLoader.js";
import { loadRules as loadRulesFromDisk } from "./infrastructure/ruleLoader.js";
import { createGrpcServer, type HandlerMeta } from "./infrastructure/grpcServer.js";
import { createAdminApp } from "./interfaces/httpAdmin.js";

// Ports
const GRPC_PORT_PLAINTEXT = (process.env.GRPC_PORT_PLAINTEXT || process.env.GRPC_PORT || 50050) as any;
const GRPC_PORT_TLS = (process.env.GRPC_PORT_TLS || 50051) as any;
// TLS config
const TLS_ENABLED_ENV = String(process.env.GRPC_TLS_ENABLED || "").toLowerCase();
const TLS_ENABLED = TLS_ENABLED_ENV === "true" || TLS_ENABLED_ENV === "1";
const TLS_CERT_PATH = process.env.GRPC_TLS_CERT_PATH || "";
const TLS_KEY_PATH = process.env.GRPC_TLS_KEY_PATH || "";
const TLS_CA_PATH = process.env.GRPC_TLS_CA_PATH || ""; // if provided, can enable mTLS
const TLS_REQUIRE_CLIENT_CERT = String(process.env.GRPC_TLS_REQUIRE_CLIENT_CERT || "").toLowerCase();
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const PROTO_DIR = path.resolve("protos");
const RULE_DIR = path.resolve("rules");
const UPLOAD_DIR = path.resolve("uploads");

// ----- state -----
let serverPlain: grpc.Server | null = null;
let serverTls: grpc.Server | null = null;
let tlsEnabled: boolean = false;
let tlsMtls: boolean = false;
let tlsError: string | null = null;
let servicesKeys: string[] = [];
let servicesMeta: Map<string, HandlerMeta> = new Map();
let currentRoot: protobuf.Root | null = null;
let protoReport: ProtoFileStatus[] = [];
const rulesIndex = new Map<string, any>();

// --- util: logging ---
const log = (...a: any[]) => console.log("[wishmock]", ...a);
const err = (...a: any[]) => console.error("[wishmock]", ...a);

async function startGrpc(rootNamespace: protobuf.Root) {
  // Shutdown existing servers if any
  const shutdown = async (srv: grpc.Server | null) => srv ? new Promise<void>((resolve, reject) => srv.tryShutdown((e?: Error) => (e ? reject(e) : resolve()))) : Promise.resolve();
  await shutdown(serverPlain);
  await shutdown(serverTls);
  serverPlain = null;
  serverTls = null;

  // Build a server instance (handlers) once to capture services meta
  const entryFiles = protoReport.filter(r => r.status === "loaded").map(r => path.join(PROTO_DIR, r.file));
  const { server: s1, servicesMap } = await createGrpcServer(rootNamespace, rulesIndex, log, err, { protoDir: PROTO_DIR, entryFiles });
  servicesMeta = servicesMap;
  servicesKeys = [...servicesMap.keys()];

  // Always start plaintext
  await new Promise<void>((resolve, reject) => {
    s1.bindAsync(`0.0.0.0:${GRPC_PORT_PLAINTEXT}`, grpc.ServerCredentials.createInsecure(), (e?: Error | null) => {
      if (e) return reject(e);
      log(`gRPC (plaintext) listening on ${GRPC_PORT_PLAINTEXT}`);
      resolve();
    });
  });
  serverPlain = s1;

  // TLS setup if enabled/requested and cert/key are present
  tlsEnabled = false;
  tlsMtls = false;
  tlsError = null;
  const shouldEnableTls = TLS_ENABLED || (!!TLS_CERT_PATH && !!TLS_KEY_PATH);
  if (shouldEnableTls) {
    try {
      const key = fs.readFileSync(TLS_KEY_PATH);
      const cert = fs.readFileSync(TLS_CERT_PATH);
      const rootCerts = TLS_CA_PATH ? fs.readFileSync(TLS_CA_PATH) : null;
      // Decide mTLS requirement: default is NO client certs required.
      // Only require client certs when explicitly requested via env.
      let requireClientCert = false;
      if (TLS_REQUIRE_CLIENT_CERT === "true" || TLS_REQUIRE_CLIENT_CERT === "1") requireClientCert = true;
      if (TLS_REQUIRE_CLIENT_CERT === "false" || TLS_REQUIRE_CLIENT_CERT === "0") requireClientCert = false;
      const creds = grpc.ServerCredentials.createSsl(rootCerts, [{ private_key: key, cert_chain: cert }], requireClientCert);
      // Build separate secure server with the same handlers
      const entryFiles2 = protoReport.filter(r => r.status === "loaded").map(r => path.join(PROTO_DIR, r.file));
      const { server: s2 } = await createGrpcServer(rootNamespace, rulesIndex, log, err, { protoDir: PROTO_DIR, entryFiles: entryFiles2 });
      await new Promise<void>((resolve, reject) => {
        s2.bindAsync(`0.0.0.0:${GRPC_PORT_TLS}`, creds, (e?: Error | null) => {
          if (e) return reject(e);
          log(`gRPC (TLS${requireClientCert ? ", mTLS" : ""}) listening on ${GRPC_PORT_TLS}`);
          resolve();
        });
      });
      serverTls = s2;
      tlsEnabled = true;
      tlsMtls = !!requireClientCert;
    } catch (e: any) {
      tlsError = e?.message || String(e);
      err("TLS server failed to start; continuing with plaintext only:", tlsError);
    }
  }
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
  // Prevent unexpected crashes from unhandled errors
  process.on('uncaughtException', (e) => err('Uncaught exception', e));
  process.on('unhandledRejection', (r) => err('Unhandled rejection', r));

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
      // Back-compat key; show plaintext port
      grpc_port: GRPC_PORT_PLAINTEXT,
      grpc_ports: {
        plaintext: GRPC_PORT_PLAINTEXT,
        tls: tlsEnabled ? GRPC_PORT_TLS : undefined,
        tls_enabled: tlsEnabled,
        mtls: tlsMtls || undefined,
        tls_error: tlsError,
      },
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

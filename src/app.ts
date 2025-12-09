import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import chokidar from "chokidar";
import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import { loadProtos, type ProtoFileStatus } from "./infrastructure/protoLoader.js";
import { loadRules as loadRulesFromDisk } from "./infrastructure/ruleLoader.js";
import { createGrpcServer, type HandlerMeta } from "./infrastructure/grpcServer.js";
import { createAdminApp } from "./interfaces/httpAdmin.js";
import { runtime as validationRuntime } from "./infrastructure/validation/runtime.js";
import { createConnectServer, type ConnectServer } from "./infrastructure/connectServer.js";
import { sharedMetrics } from "./domain/metrics/sharedMetrics.js";

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
const HTTP_PORT = process.env.HTTP_PORT || 4319;
const PROTO_DIR = path.resolve("protos");
const RULES_ROOT = path.resolve("rules");
const RULE_DIR = path.resolve(RULES_ROOT, "grpc");
const UPLOAD_DIR = path.resolve("uploads");
const REFLECTION_DISABLE_REGEN = String(process.env.REFLECTION_DISABLE_REGEN || "").toLowerCase() === 'true' || process.env.REFLECTION_DISABLE_REGEN === '1';

// Connect RPC configuration
const CONNECT_ENABLED_ENV = String(process.env.CONNECT_ENABLED || "true").toLowerCase();
const CONNECT_ENABLED = CONNECT_ENABLED_ENV === "true" || CONNECT_ENABLED_ENV === "1";
const CONNECT_PORT = parseInt(process.env.CONNECT_PORT || "50052", 10);
const CONNECT_CORS_ENABLED_ENV = String(process.env.CONNECT_CORS_ENABLED || "true").toLowerCase();
const CONNECT_CORS_ENABLED = CONNECT_CORS_ENABLED_ENV === "true" || CONNECT_CORS_ENABLED_ENV === "1";
const CONNECT_CORS_ORIGINS = process.env.CONNECT_CORS_ORIGINS?.split(",") || ["*"];
const CONNECT_CORS_METHODS = process.env.CONNECT_CORS_METHODS?.split(",") || ["GET", "POST", "OPTIONS"];
const CONNECT_CORS_HEADERS = process.env.CONNECT_CORS_HEADERS?.split(",") || ["*"];
const CONNECT_TLS_ENABLED_ENV = String(process.env.CONNECT_TLS_ENABLED || "").toLowerCase();
const CONNECT_TLS_ENABLED = CONNECT_TLS_ENABLED_ENV === "true" || CONNECT_TLS_ENABLED_ENV === "1";
const CONNECT_TLS_CERT_PATH = process.env.CONNECT_TLS_CERT_PATH || TLS_CERT_PATH;
const CONNECT_TLS_KEY_PATH = process.env.CONNECT_TLS_KEY_PATH || TLS_KEY_PATH;
const CONNECT_TLS_CA_PATH = process.env.CONNECT_TLS_CA_PATH || TLS_CA_PATH;

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
let rebuildInProgress = false;
let signalledReady = false;
let lastReloadTimestamp: Date | null = null;
let lastReloadMode: 'cluster' | 'bun-watch' | 'initial' = 'initial';
let reloadDowntimeDetected = false;

// Connect RPC state
let connectServer: ConnectServer | null = null;
let connectEnabled: boolean = false;
let connectError: string | null = null;

// --- util: logging ---
const log = (...a: any[]) => console.log("[wishmock]", ...a);
const err = (...a: any[]) => console.error("[wishmock]", ...a);

// --- util: descriptor generation ---
async function regenerateDescriptors() {
  try {
    if (REFLECTION_DISABLE_REGEN) {
      log("Reflection descriptor regeneration disabled by env (REFLECTION_DISABLE_REGEN)");
      return;
    }
    // Locate the descriptor generation script either in the current working directory
    // or bundled within the installed package (published with files: ["scripts/"])
    const localScriptPath = path.resolve("scripts/generate-descriptor-set.sh");
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const packageScriptPath = path.resolve(moduleDir, "../scripts/generate-descriptor-set.sh");
    const scriptPath = fs.existsSync(localScriptPath)
      ? localScriptPath
      : (fs.existsSync(packageScriptPath) ? packageScriptPath : "");
    if (!scriptPath) throw new Error("Descriptor generation script not found");
    
    const descriptorPath = path.resolve('bin/.descriptors.bin');
    
    // Skip if descriptor exists and is up-to-date (optimization for Docker pre-baked descriptors)
    // Only regenerate if proto files are newer than descriptor
    if (fs.existsSync(descriptorPath)) {
      const descriptorTime = fs.statSync(descriptorPath).mtimeMs;
      const protoFiles = fs.readdirSync(PROTO_DIR)
        .filter(f => f.endsWith('.proto'))
        .map(f => path.join(PROTO_DIR, f));
      
      const hasNewerProto = protoFiles.some(f => {
        try {
          return fs.statSync(f).mtimeMs > descriptorTime;
        } catch {
          return false; // Skip files that can't be stat'd
        }
      });
      
      if (!hasNewerProto) {
        log("✓ Reflection descriptor up-to-date");
        return; // Skip regeneration
      }
    }
    
    log("Regenerating reflection descriptors...");
    execSync(`bash "${scriptPath}"`, { stdio: 'pipe' });
    log("✓ Reflection descriptors regenerated");
  } catch (e: any) {
    err("Failed to regenerate descriptors:", e?.message || e);
    throw e;
  }
}

/**
 * Initialize servers with shared state
 * 
 * This is the core initialization function that sets up both gRPC and Connect RPC
 * servers with shared infrastructure. The key design principle is that both servers
 * use the SAME instances of:
 * - protoRoot: Protobuf definitions loaded from .proto files
 * - rulesIndex: Mock rules loaded from YAML/JSON files
 * - validationRuntime: Validation engine for protovalidate/PGV
 * 
 * This ensures consistent behavior across all protocols (gRPC, Connect, gRPC-Web).
 * 
 * Initialization order is important:
 * 1. Load protos and rules once (shared state)
 * 2. Initialize validation runtime with shared protoRoot
 * 3. Start native gRPC server first (plaintext and TLS if configured)
 * 4. Start Connect RPC server second (if enabled)
 * 
 * If Connect server fails to start, the application continues with gRPC only.
 * This provides graceful degradation if Connect dependencies are missing.
 */
async function initializeServers() {
  log("Initializing servers with shared state...");
  
  // Step 1: Load protos (shared state)
  // This creates a single protobuf.Root instance that both servers will use
  log("Loading protobuf definitions...");
  const { root, report } = await loadProtos(PROTO_DIR);
  protoReport = report;
  currentRoot = root;
  
  const loaded = report.filter(r => r.status === "loaded").map(r => r.file);
  const skipped = report.filter(r => r.status === "skipped");
  if (loaded.length) log(`Loaded protos: ${loaded.join(", ")}`);
  if (skipped.length) {
    for (const s of skipped) err(`Skipped proto: ${s.file} (${s.error || "unknown error"})`);
  }
  
  // Step 2: Load rules (shared state)
  // Rules are loaded from YAML/JSON files in the rules directory
  // Both servers will use this same rulesIndex Map instance
  log("Loading rules...");
  const fresh = loadRulesFromDisk(RULE_DIR);
  rulesIndex.clear();
  for (const [k, v] of fresh.entries()) rulesIndex.set(k, v);
  log(`Loaded ${rulesIndex.size} rules`);
  
  // Step 3: Initialize validation runtime (shared state)
  // The validation runtime extracts protovalidate/PGV constraints from the proto files
  // Both servers will use this same validation runtime instance
  log("Initializing validation runtime...");
  try {
    validationRuntime.loadFromRoot(root);
    log("Validation runtime initialized");
  } catch (e) {
    err('Validation runtime load failed', e);
  }
  
  // Step 4: Shutdown existing servers if any
  // This is important for reload scenarios where we need to stop old servers
  // before starting new ones with updated state
  if (serverPlain || serverTls || connectServer) {
    log("Stopping existing servers...");
    await shutdownServers();
  }
  
  // Step 5: Start native gRPC server (plaintext)
  log("Starting native gRPC server...");
  
  // Build a server instance (handlers) once to capture services meta
  // Exclude validation_examples.proto from proto-loader due to map field limitations.
  // It's still loaded via protobufjs, so validation rules work; reflection uses protoc descriptors.
  const entryFiles = protoReport
    .filter(r => r.status === "loaded")
    .map(r => path.join(PROTO_DIR, r.file))
    .filter(f => !f.endsWith(path.sep + 'validation_examples.proto'));
  const { server: s1, servicesMap } = await createGrpcServer(root, rulesIndex, log, err, { protoDir: PROTO_DIR, entryFiles });
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

  // Step 6: Start native gRPC server (TLS if configured)
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
      const entryFiles2 = protoReport
        .filter(r => r.status === "loaded")
        .map(r => path.join(PROTO_DIR, r.file))
        .filter(f => !f.endsWith(path.sep + 'validation_examples.proto'));
      const { server: s2 } = await createGrpcServer(root, rulesIndex, log, err, { protoDir: PROTO_DIR, entryFiles: entryFiles2 });
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

  // Step 7: Start Connect RPC server (if enabled)
  connectEnabled = false;
  connectError = null;
  if (CONNECT_ENABLED) {
    try {
      log("Starting Connect RPC server...");
      
      // Prepare TLS configuration if enabled
      const tlsConfig = CONNECT_TLS_ENABLED && CONNECT_TLS_CERT_PATH && CONNECT_TLS_KEY_PATH
        ? {
            enabled: true,
            keyPath: CONNECT_TLS_KEY_PATH,
            certPath: CONNECT_TLS_CERT_PATH,
            caPath: CONNECT_TLS_CA_PATH || undefined,
          }
        : undefined;
      
      // Create Connect server with shared protoRoot and rulesIndex
      connectServer = await createConnectServer({
        port: CONNECT_PORT,
        corsEnabled: CONNECT_CORS_ENABLED,
        corsOrigins: CONNECT_CORS_ORIGINS,
        corsMethods: CONNECT_CORS_METHODS,
        corsHeaders: CONNECT_CORS_HEADERS,
        protoRoot: root,
        rulesIndex,
        logger: log,
        errorLogger: err,
        tls: tlsConfig,
      });
      
      // Start the server
      await connectServer.start();
      
      connectEnabled = true;
      const serviceCount = connectServer.getServices().size;
      log(`Connect RPC server started successfully with ${serviceCount} services`);
    } catch (e: any) {
      connectError = e?.message || String(e);
      err("Connect RPC server failed to start:", connectError);
      err("Continuing with native gRPC only");
    }
  } else {
    log("Connect RPC server disabled (CONNECT_ENABLED=false)");
  }

  // Notify cluster master (if any) that this worker is ready (only once)
  if (!signalledReady) {
    try { (process as any).send?.({ type: 'ready' }); } catch {}
    signalledReady = true;
  }
  
  log("Server initialization complete");
}

/**
 * Reload servers with coordinated shutdown and restart
 * 
 * This function implements atomic reload to ensure both servers are always in sync.
 * The reload process is coordinated to prevent state divergence between gRPC and
 * Connect RPC servers.
 * 
 * Reload process:
 * 1. Stop both gRPC and Connect servers gracefully (coordinated shutdown)
 * 2. Reload protos and rules from disk (creates new shared state)
 * 3. Restart both servers with the new shared state (coordinated startup)
 * 
 * During reload, the readiness endpoint returns false to signal that the server
 * is temporarily unavailable. This allows load balancers to route traffic away
 * during the reload window.
 * 
 * The reload is atomic in the sense that both servers use the SAME new state
 * after reload completes. There's no window where one server has old state and
 * the other has new state.
 * 
 * Reload can be triggered by:
 * - File system changes (proto or rule files modified)
 * - Admin API reload endpoint
 * - Cluster master signaling a reload
 * 
 * @param reason - Description of why the reload was triggered (for logging)
 */
async function reloadServers(reason: string) {
  // Set rebuild flag to make readiness endpoint return false
  rebuildInProgress = true;
  const start = Date.now();
  log(`[reload] ⏳ Coordinated reload start (reason: ${reason}) — readiness=not_ready`);
  
  lastReloadTimestamp = new Date();
  if (reason.includes('cluster') || process.env.START_CLUSTER) {
    lastReloadMode = 'cluster';
  } else if (reason.includes('watch')) {
    lastReloadMode = 'bun-watch';
  }
  
  try {
    // Step 1: Stop both servers gracefully using coordinated shutdown
    await shutdownServers();
    
    // Step 2: Reload protos and rules
    log(`[reload] Reloading protos and rules...`);
    
    // Regenerate descriptor set for reflection hot reload
    await regenerateDescriptors();
    
    // Load protos (creates new shared protoRoot)
    const { root, report } = await loadProtos(PROTO_DIR);
    protoReport = report;
    currentRoot = root;
    
    const loaded = report.filter(r => r.status === "loaded").map(r => r.file);
    const skipped = report.filter(r => r.status === "skipped");
    if (loaded.length) log(`[reload] Loaded protos: ${loaded.join(", ")}`);
    if (skipped.length) {
      for (const s of skipped) err(`[reload] Skipped proto: ${s.file} (${s.error || "unknown error"})`);
    }
    
    // Load rules (updates shared rulesIndex)
    const fresh = loadRulesFromDisk(RULE_DIR);
    rulesIndex.clear();
    for (const [k, v] of fresh.entries()) rulesIndex.set(k, v);
    log(`[reload] Loaded ${rulesIndex.size} rules`);
    
    // Initialize validation runtime with new protoRoot
    try {
      validationRuntime.loadFromRoot(root);
      log(`[reload] Validation runtime reinitialized`);
    } catch (e) {
      err('[reload] Validation runtime load failed', e);
    }
    
    // Step 3: Restart both servers with new shared state
    log(`[reload] Restarting servers with new state...`);
    
    // Start native gRPC server (plaintext)
    const entryFiles = protoReport
      .filter(r => r.status === "loaded")
      .map(r => path.join(PROTO_DIR, r.file))
      .filter(f => !f.endsWith(path.sep + 'validation_examples.proto'));
    const { server: s1, servicesMap } = await createGrpcServer(root, rulesIndex, log, err, { protoDir: PROTO_DIR, entryFiles });
    servicesMeta = servicesMap;
    servicesKeys = [...servicesMap.keys()];

    await new Promise<void>((resolve, reject) => {
      s1.bindAsync(`0.0.0.0:${GRPC_PORT_PLAINTEXT}`, grpc.ServerCredentials.createInsecure(), (e?: Error | null) => {
        if (e) return reject(e);
        log(`[reload] gRPC (plaintext) listening on ${GRPC_PORT_PLAINTEXT}`);
        resolve();
      });
    });
    serverPlain = s1;

    // Start native gRPC server (TLS if configured)
    tlsEnabled = false;
    tlsMtls = false;
    tlsError = null;
    const shouldEnableTls = TLS_ENABLED || (!!TLS_CERT_PATH && !!TLS_KEY_PATH);
    if (shouldEnableTls) {
      try {
        const key = fs.readFileSync(TLS_KEY_PATH);
        const cert = fs.readFileSync(TLS_CERT_PATH);
        const rootCerts = TLS_CA_PATH ? fs.readFileSync(TLS_CA_PATH) : null;
        let requireClientCert = false;
        if (TLS_REQUIRE_CLIENT_CERT === "true" || TLS_REQUIRE_CLIENT_CERT === "1") requireClientCert = true;
        if (TLS_REQUIRE_CLIENT_CERT === "false" || TLS_REQUIRE_CLIENT_CERT === "0") requireClientCert = false;
        const creds = grpc.ServerCredentials.createSsl(rootCerts, [{ private_key: key, cert_chain: cert }], requireClientCert);
        const entryFiles2 = protoReport
          .filter(r => r.status === "loaded")
          .map(r => path.join(PROTO_DIR, r.file))
          .filter(f => !f.endsWith(path.sep + 'validation_examples.proto'));
        const { server: s2 } = await createGrpcServer(root, rulesIndex, log, err, { protoDir: PROTO_DIR, entryFiles: entryFiles2 });
        await new Promise<void>((resolve, reject) => {
          s2.bindAsync(`0.0.0.0:${GRPC_PORT_TLS}`, creds, (e?: Error | null) => {
            if (e) return reject(e);
            log(`[reload] gRPC (TLS${requireClientCert ? ", mTLS" : ""}) listening on ${GRPC_PORT_TLS}`);
            resolve();
          });
        });
        serverTls = s2;
        tlsEnabled = true;
        tlsMtls = !!requireClientCert;
      } catch (e: any) {
        tlsError = e?.message || String(e);
        err("[reload] TLS server failed to start; continuing with plaintext only:", tlsError);
      }
    }

    // Start Connect RPC server (if enabled)
    connectEnabled = false;
    connectError = null;
    if (CONNECT_ENABLED) {
      try {
        log("[reload] Starting Connect RPC server...");
        
        const tlsConfig = CONNECT_TLS_ENABLED && CONNECT_TLS_CERT_PATH && CONNECT_TLS_KEY_PATH
          ? {
              enabled: true,
              keyPath: CONNECT_TLS_KEY_PATH,
              certPath: CONNECT_TLS_CERT_PATH,
              caPath: CONNECT_TLS_CA_PATH || undefined,
            }
          : undefined;
        
        connectServer = await createConnectServer({
          port: CONNECT_PORT,
          corsEnabled: CONNECT_CORS_ENABLED,
          corsOrigins: CONNECT_CORS_ORIGINS,
          corsMethods: CONNECT_CORS_METHODS,
          corsHeaders: CONNECT_CORS_HEADERS,
          protoRoot: root,
          rulesIndex,
          logger: log,
          errorLogger: err,
          tls: tlsConfig,
        });
        
        await connectServer.start();
        
        connectEnabled = true;
        const serviceCount = connectServer.getServices().size;
        log(`[reload] Connect RPC server started successfully with ${serviceCount} services`);
      } catch (e: any) {
        connectError = e?.message || String(e);
        err("[reload] Connect RPC server failed to start:", connectError);
        err("[reload] Continuing with native gRPC only");
      }
    }
    
    const dur = Date.now() - start;
    log(`[reload] ✅ Coordinated reload complete in ${dur}ms (reason: ${reason}) — readiness=ready`);
    
    reloadDowntimeDetected = dur > 1000;
  } catch (e: any) {
    const dur = Date.now() - start;
    err(`[reload] ❌ Coordinated reload failed after ${dur}ms (reason: ${reason})`, e?.message || e);
    reloadDowntimeDetected = true;
    throw e;
  } finally {
    rebuildInProgress = false;
  }
}

/**
 * Shutdown all servers gracefully
 * 
 * This function implements coordinated shutdown to ensure both gRPC and Connect
 * servers are stopped cleanly without leaving resources hanging.
 * 
 * Shutdown process:
 * 1. Stop both gRPC servers (plaintext and TLS) gracefully using tryShutdown
 * 2. Stop Connect RPC server gracefully using its stop() method
 * 3. Handle errors during shutdown without throwing (best-effort cleanup)
 * 4. Log clear status messages for each step for observability
 * 5. Clear state variables to prevent stale references
 * 
 * The function uses tryShutdown for gRPC servers, which:
 * - Stops accepting new connections
 * - Waits for in-flight requests to complete
 * - Closes the server gracefully
 * 
 * This function is idempotent and safe to call multiple times. It handles cases
 * where servers may already be stopped or null without throwing errors.
 * 
 * Shutdown can be triggered by:
 * - SIGTERM/SIGINT signals (graceful shutdown)
 * - Cluster worker disconnect
 * - Reload operation (shutdown before restart)
 * - Application exit
 */
async function shutdownServers(): Promise<void> {
  log('[shutdown] Starting coordinated shutdown...');
  
  // Track errors but don't throw - we want to attempt shutdown of all servers
  // even if some fail
  const errors: string[] = [];
  
  // Helper to shutdown a gRPC server gracefully
  const shutdownGrpcServer = async (
    server: grpc.Server | null,
    name: string
  ): Promise<void> => {
    if (!server) {
      log(`[shutdown] ${name} already stopped`);
      return;
    }
    
    try {
      log(`[shutdown] Stopping ${name}...`);
      await new Promise<void>((resolve, reject) => {
        server.tryShutdown((error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      log(`[shutdown] ✓ ${name} stopped successfully`);
    } catch (e: any) {
      const errorMsg = `Failed to stop ${name}: ${e?.message || e}`;
      err(`[shutdown] ${errorMsg}`);
      errors.push(errorMsg);
    }
  };
  
  // Shutdown plaintext gRPC server
  await shutdownGrpcServer(serverPlain, 'gRPC server (plaintext)');
  serverPlain = null;
  
  // Shutdown TLS gRPC server
  await shutdownGrpcServer(serverTls, 'gRPC server (TLS)');
  serverTls = null;
  
  // Shutdown Connect RPC server
  if (connectServer) {
    try {
      log('[shutdown] Stopping Connect RPC server...');
      await connectServer.stop();
      log('[shutdown] ✓ Connect RPC server stopped successfully');
    } catch (e: any) {
      const errorMsg = `Failed to stop Connect RPC server: ${e?.message || e}`;
      err(`[shutdown] ${errorMsg}`);
      errors.push(errorMsg);
    }
    connectServer = null;
  } else {
    log('[shutdown] Connect RPC server already stopped');
  }
  
  // Clear state
  connectEnabled = false;
  tlsEnabled = false;
  
  // Report final status
  if (errors.length > 0) {
    err(`[shutdown] ⚠ Shutdown completed with ${errors.length} error(s):`);
    errors.forEach(error => err(`[shutdown]   - ${error}`));
  } else {
    log('[shutdown] ✅ All servers stopped successfully');
  }
}

/**
 * Legacy rebuild function - now delegates to reloadServers
 * Kept for backward compatibility with existing code
 */
async function rebuild(reason: string) {
  return reloadServers(reason);
}

function reloadRules() {
  const start = Date.now();
  log(`[rules] ⏳ Reload start`);
  try {
    const fresh = loadRulesFromDisk(RULE_DIR);
    rulesIndex.clear();
    for (const [k, v] of fresh.entries()) rulesIndex.set(k, v);
    const dur = Date.now() - start;
    log(`[rules] ✅ Reload complete in ${dur}ms — total=${rulesIndex.size}`);
  } catch (e) {
    const dur = Date.now() - start;
    err(`[rules] ❌ Reload failed after ${dur}ms`, e);
  }
}

// --- initial boot ---
(async () => {
  // Prevent unexpected crashes from unhandled errors
  process.on('uncaughtException', (e) => err('Uncaught exception', e));
  process.on('unhandledRejection', (r) => err('Unhandled rejection', r));

  // Graceful shutdown handlers (cluster master will call worker.disconnect())
  const graceful = async () => {
    try {
      log('[lifecycle] Graceful shutdown initiated');
      await shutdownServers();
    } finally {
      process.exit(0);
    }
  };
  process.on('disconnect', () => { log('[lifecycle] worker disconnect received → graceful shutdown'); void graceful(); });
  process.on('SIGTERM', () => { log('[lifecycle] SIGTERM → graceful shutdown'); void graceful(); });
  process.on('SIGINT', () => { log('[lifecycle] SIGINT → graceful shutdown'); void graceful(); });

  if (!fs.existsSync(PROTO_DIR)) fs.mkdirSync(PROTO_DIR, { recursive: true });
  if (!fs.existsSync(RULE_DIR)) fs.mkdirSync(RULE_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  try {
    await rebuild("boot");
  } catch {
    // Hard fail at boot if descriptor generation or proto load fails
    process.exitCode = 1;
    return;
  }

  // watchers (hot-reload)
  const isBun = typeof (globalThis as any).Bun !== "undefined";
  const startCluster = String(process.env.START_CLUSTER || "").toLowerCase() === 'true';
  // Default behavior:
  //  - In Node cluster (START_CLUSTER=true): disable proto hot-reload to allow zero-downtime rolling restarts on upload
  //  - Otherwise (Bun or single process): enable proto hot-reload
  const HOT_RELOAD_PROTOS_ENV = process.env.HOT_RELOAD_PROTOS;
  const hotReloadProtos = typeof HOT_RELOAD_PROTOS_ENV === 'string'
    ? (HOT_RELOAD_PROTOS_ENV.toLowerCase() === 'true' || HOT_RELOAD_PROTOS_ENV === '1')
    : !(startCluster && !isBun);
  const HOT_RELOAD_RULES_ENV = process.env.HOT_RELOAD_RULES;
  const hotReloadRules = typeof HOT_RELOAD_RULES_ENV === 'string'
    ? (HOT_RELOAD_RULES_ENV.toLowerCase() === 'true' || HOT_RELOAD_RULES_ENV === '1')
    : true;

  const watchOpts: any = { ignoreInitial: true, ...(isBun ? { usePolling: true, interval: 500, binaryInterval: 500 } : {}) };

  if (hotReloadProtos) {
    try {
      const protoWatcher = chokidar.watch(PROTO_DIR, watchOpts);
      protoWatcher.on("all", async () => { await rebuild(".proto changed"); });
      protoWatcher.on("error", (e: unknown) => err("Watcher error (protos)", e));
      log(`[watch] protos hot-reload: enabled`);
    } catch (e) {
      err("Failed to start proto watcher; continuing without hot reload", e);
    }
  } else {
    log(`[watch] protos hot-reload: disabled (cluster mode)`);
  }

  if (hotReloadRules) {
    try {
      const ruleWatcher = chokidar.watch(RULE_DIR, watchOpts);
      ruleWatcher.on("all", async () => { reloadRules(); });
      ruleWatcher.on("error", (e: unknown) => err("Watcher error (rules)", e));
      log(`[watch] rules hot-reload: enabled`);
    } catch (e) {
      err("Failed to start rule watcher; continuing without hot reload", e);
    }
  } else {
    log(`[watch] rules hot-reload: disabled by env`);
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
      connect_rpc: {
        enabled: connectEnabled,
        port: connectEnabled ? CONNECT_PORT : undefined,
        cors_enabled: CONNECT_CORS_ENABLED,
        cors_origins: CONNECT_CORS_ENABLED ? CONNECT_CORS_ORIGINS : undefined,
        tls_enabled: CONNECT_TLS_ENABLED,
        error: connectError,
        services: connectServer ? Array.from(connectServer.getServices().keys()) : [],
        reflection_enabled: connectServer ? connectServer.hasReflection() : false,
        metrics: connectServer ? connectServer.getMetrics() : undefined,
      },
      loaded_services: servicesKeys,
      rules: [...rulesIndex.keys()],
      protos: {
        loaded: protoReport.filter(r => r.status === "loaded").map(r => r.file),
        skipped: protoReport.filter(r => r.status === "skipped")
      },
      validation: validationRuntime.getCoverageInfo(),
      reload: {
        last_triggered: lastReloadTimestamp?.toISOString(),
        mode: lastReloadMode,
        downtime_detected: reloadDowntimeDetected
      },
      shared_metrics: sharedMetrics.getMetrics(),
    }),
    getReadiness: () => !rebuildInProgress,
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
          request_stream: meta.requestStream,
          response_stream: meta.responseStream,
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

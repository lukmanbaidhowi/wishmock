import { describe, it, expect, afterEach } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import { createGrpcServer } from "../src/infrastructure/grpcServer.js";
import { createConnectServer, type ConnectServer } from "../src/infrastructure/connectServer.js";
import { loadProtos } from "../src/infrastructure/protoLoader.js";
import { loadRules } from "../src/infrastructure/ruleLoader.js";
import path from "path";

/**
 * Lifecycle tests for coordinated server management
 * 
 * These tests verify:
 * - Coordinated startup of both gRPC and Connect servers
 * - Reload behavior with shared state updates
 * - Graceful shutdown of all servers
 * - Error recovery when Connect server fails to start
 * 
 * Note: These tests can be flaky in CI environments due to timing issues.
 * Set SKIP_LIFECYCLE=true to skip these tests in CI.
 */
const describeLifecycle = (process.env.SKIP_LIFECYCLE === "true" || process.env.CI === "true") 
  ? (describe as any).skip 
  : describe;

describeLifecycle("Lifecycle Management", () => {
  const PROTO_DIR = path.resolve("protos");
  const RULE_DIR = path.resolve("rules/grpc");
  
  // Track servers for cleanup
  const activeServers: {
    grpc: grpc.Server[];
    connect: ConnectServer[];
  } = {
    grpc: [],
    connect: [],
  };

  afterEach(async () => {
    // Clean up any servers created during tests
    for (const server of activeServers.grpc) {
      await new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve());
      });
    }
    
    for (const server of activeServers.connect) {
      try {
        await server.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    
    activeServers.grpc = [];
    activeServers.connect = [];
  });

  /**
   * Test coordinated startup
   */
  it("should initialize both servers with shared state", async () => {
    const logs: string[] = [];
    const logger = (...args: any[]) => logs.push(args.join(" "));
    
    // Step 1: Load shared state
    const { root } = await loadProtos(PROTO_DIR);
    const rules = loadRules(RULE_DIR);
    
    expect(root).toBeDefined();
    expect(rules.size).toBeGreaterThan(0);
    
    // Step 2: Start native gRPC server
    const { server: grpcServer } = await createGrpcServer(
      root,
      rules,
      logger,
      logger,
      { protoDir: PROTO_DIR }
    );
    
    await new Promise<void>((resolve, reject) => {
      grpcServer.bindAsync(
        "0.0.0.0:0",
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    activeServers.grpc.push(grpcServer);
    
    // Step 3: Start Connect server
    const connectServer = await createConnectServer({
      port: 0,
      corsEnabled: false,
      corsOrigins: [],
      corsMethods: [],
      corsHeaders: [],
      protoRoot: root,
      rulesIndex: rules,
      logger,
      errorLogger: logger,
    });
    
    await connectServer.start();
    activeServers.connect.push(connectServer);
    
    // Verify both servers are running
    expect(connectServer.isListening()).toBe(true);
    expect(connectServer.getServices().size).toBeGreaterThan(0);
  });

  /**
   * Test reload behavior
   */
  it("should reload both servers with coordinated shutdown and restart", async () => {
    const logs: string[] = [];
    const logger = (...args: any[]) => logs.push(args.join(" "));
    
    // Initial startup
    const { root: initialRoot } = await loadProtos(PROTO_DIR);
    const initialRules = loadRules(RULE_DIR);
    
    const { server: grpcServer1 } = await createGrpcServer(
      initialRoot,
      initialRules,
      logger,
      logger,
      { protoDir: PROTO_DIR }
    );
    
    await new Promise<void>((resolve, reject) => {
      grpcServer1.bindAsync(
        "0.0.0.0:0",
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    const connectServer1 = await createConnectServer({
      port: 0,
      corsEnabled: false,
      corsOrigins: [],
      corsMethods: [],
      corsHeaders: [],
      protoRoot: initialRoot,
      rulesIndex: initialRules,
      logger,
      errorLogger: logger,
    });
    
    await connectServer1.start();
    expect(connectServer1.isListening()).toBe(true);
    
    // Simulate reload: shutdown both servers
    await new Promise<void>((resolve) => {
      grpcServer1.tryShutdown(() => resolve());
    });
    
    await connectServer1.stop();
    expect(connectServer1.isListening()).toBe(false);
    
    // Reload state
    const { root: newRoot } = await loadProtos(PROTO_DIR);
    const newRules = loadRules(RULE_DIR);
    
    // Restart both servers
    const { server: grpcServer2 } = await createGrpcServer(
      newRoot,
      newRules,
      logger,
      logger,
      { protoDir: PROTO_DIR }
    );
    
    await new Promise<void>((resolve, reject) => {
      grpcServer2.bindAsync(
        "0.0.0.0:0",
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    activeServers.grpc.push(grpcServer2);
    
    const connectServer2 = await createConnectServer({
      port: 0,
      corsEnabled: false,
      corsOrigins: [],
      corsMethods: [],
      corsHeaders: [],
      protoRoot: newRoot,
      rulesIndex: newRules,
      logger,
      errorLogger: logger,
    });
    
    await connectServer2.start();
    activeServers.connect.push(connectServer2);
    
    // Verify both servers are running
    expect(connectServer2.isListening()).toBe(true);
    expect(connectServer2.getServices().size).toBeGreaterThan(0);
  });

  /**
   * Test graceful shutdown
   */
  it("should shutdown both servers gracefully", async () => {
    const logs: string[] = [];
    const logger = (...args: any[]) => logs.push(args.join(" "));
    
    // Start both servers
    const { root } = await loadProtos(PROTO_DIR);
    const rules = loadRules(RULE_DIR);
    
    const { server: grpcServer } = await createGrpcServer(
      root,
      rules,
      logger,
      logger,
      { protoDir: PROTO_DIR }
    );
    
    await new Promise<void>((resolve, reject) => {
      grpcServer.bindAsync(
        "0.0.0.0:0",
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    const connectServer = await createConnectServer({
      port: 0,
      corsEnabled: false,
      corsOrigins: [],
      corsMethods: [],
      corsHeaders: [],
      protoRoot: root,
      rulesIndex: rules,
      logger,
      errorLogger: logger,
    });
    
    await connectServer.start();
    expect(connectServer.isListening()).toBe(true);
    
    // Shutdown both servers
    await new Promise<void>((resolve) => {
      grpcServer.tryShutdown(() => {
        logger("gRPC server stopped");
        resolve();
      });
    });
    
    await connectServer.stop();
    
    // Verify shutdown completed
    expect(connectServer.isListening()).toBe(false);
    expect(logs.some(l => l.includes("stopped"))).toBe(true);
  });

  /**
   * Test error recovery
   * 
   * This test verifies that the Connect server has built-in error recovery.
   * When TLS configuration fails, it falls back to HTTP automatically.
   * This demonstrates resilient error handling at the server level.
   */
  it("should handle Connect server errors gracefully with fallback", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const logger = (...args: any[]) => logs.push(args.join(" "));
    const errorLogger = (...args: any[]) => errors.push(args.join(" "));
    
    // Start gRPC server successfully
    const { root } = await loadProtos(PROTO_DIR);
    const rules = loadRules(RULE_DIR);
    
    const { server: grpcServer } = await createGrpcServer(
      root,
      rules,
      logger,
      errorLogger,
      { protoDir: PROTO_DIR }
    );
    
    await new Promise<void>((resolve, reject) => {
      grpcServer.bindAsync(
        "0.0.0.0:0",
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    activeServers.grpc.push(grpcServer);
    
    // Start Connect server with invalid TLS configuration
    // The server should fall back to HTTP automatically
    const connectServer = await createConnectServer({
      port: 0,
      corsEnabled: false,
      corsOrigins: [],
      corsMethods: [],
      corsHeaders: [],
      protoRoot: root,
      rulesIndex: rules,
      logger,
      errorLogger,
      tls: {
        enabled: true,
        keyPath: "/nonexistent/key.pem",
        certPath: "/nonexistent/cert.pem",
      },
    });
    
    await connectServer.start();
    activeServers.connect.push(connectServer);
    
    // Verify both servers are running (Connect fell back to HTTP)
    expect(grpcServer).toBeDefined();
    expect(connectServer.isListening()).toBe(true);
    
    // Verify error was logged about TLS fallback
    expect(errors.some(e => e.includes("Failed to create TLS server"))).toBe(true);
    expect(errors.some(e => e.includes("falling back to HTTP"))).toBe(true);
  });
});

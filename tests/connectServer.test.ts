import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createConnectServer, type ConnectServer } from "../src/infrastructure/connectServer.js";
import protobuf from "protobufjs";

describe("Connect RPC Server", () => {
  let server: ConnectServer;
  let protoRoot: protobuf.Root;

  beforeAll(async () => {
    // Create a minimal proto root for testing
    protoRoot = new protobuf.Root();
    
    // Define a simple test service using protobuf's builder pattern
    const testNamespace = protoRoot.define("test");
    
    // Define request and response types
    const requestType = new protobuf.Type("TestRequest");
    requestType.add(new protobuf.Field("name", 1, "string"));
    testNamespace.add(requestType);
    
    const responseType = new protobuf.Type("TestResponse");
    responseType.add(new protobuf.Field("message", 1, "string"));
    testNamespace.add(responseType);
    
    // Define service
    const testService = new protobuf.Service("TestService");
    testService.add(new protobuf.Method("SayHello", "rpc", "TestRequest", "TestResponse"));
    testNamespace.add(testService);
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  test("should create Connect server instance", async () => {
    server = await createConnectServer({
      port: 0, // Use random available port
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
    expect(server.start).toBeDefined();
    expect(server.stop).toBeDefined();
    expect(server.getServices).toBeDefined();
  });

  test("should register services from proto root", async () => {
    const services = server.getServices();
    // The test proto root has one service (test.TestService)
    expect(services.size).toBe(1);
    expect(services.has("test.TestService")).toBe(true);
    
    const testService = services.get("test.TestService");
    expect(testService).toBeDefined();
    expect(testService?.serviceName).toBe("TestService");
    expect(testService?.packageName).toBe("test");
    expect(testService?.methods.size).toBe(1);
    expect(testService?.methods.has("SayHello")).toBe(true);
  });

  test("should start and stop server", async () => {
    // Start server
    await server.start();
    
    // Verify server is listening
    expect(server.server.listening).toBe(true);
    
    // Stop server
    await server.stop();
    
    // Verify server is stopped
    expect(server.server.listening).toBe(false);
  });

  test("should create server with CORS configuration", async () => {
    const corsServer = await createConnectServer({
      port: 0,
      corsEnabled: true,
      corsOrigins: ["https://example.com"],
      corsMethods: ["GET", "POST"],
      corsHeaders: ["Content-Type", "Authorization"],
      corsExposedHeaders: ["X-Custom-Header"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    expect(corsServer).toBeDefined();
    await corsServer.stop();
  });

  test("should create server without CORS", async () => {
    const noCorsServer = await createConnectServer({
      port: 0,
      corsEnabled: false,
      corsOrigins: [],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    expect(noCorsServer).toBeDefined();
    await noCorsServer.stop();
  });

  test("should report reflection status", async () => {
    // Server should have hasReflection method
    expect(server.hasReflection).toBeDefined();
    expect(typeof server.hasReflection).toBe("function");
    
    // Reflection status depends on whether bin/.descriptors.bin exists
    const hasReflection = server.hasReflection();
    expect(typeof hasReflection).toBe("boolean");
  });
});

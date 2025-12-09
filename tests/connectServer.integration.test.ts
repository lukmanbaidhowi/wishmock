import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createConnectServer, type ConnectServer } from "../src/infrastructure/connectServer.js";
import protobuf from "protobufjs";

describe("Connect RPC Server Integration", () => {
  let protoRoot: protobuf.Root;

  beforeAll(async () => {
    // Create a test proto root with a service
    protoRoot = new protobuf.Root();
    const testNamespace = protoRoot.define("helloworld");
    
    const requestType = new protobuf.Type("HelloRequest");
    requestType.add(new protobuf.Field("name", 1, "string"));
    testNamespace.add(requestType);
    
    const responseType = new protobuf.Type("HelloResponse");
    responseType.add(new protobuf.Field("message", 1, "string"));
    testNamespace.add(responseType);
    
    const greeterService = new protobuf.Service("Greeter");
    greeterService.add(new protobuf.Method("SayHello", "rpc", "HelloRequest", "HelloResponse"));
    testNamespace.add(greeterService);
  });

  test("should initialize with HTTP/1.1 and HTTP/2 support", async () => {
    const server = await createConnectServer({
      port: 0,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
    
    await server.start();
    expect(server.isListening()).toBe(true);
    
    await server.stop();
    expect(server.isListening()).toBe(false);
  });

  test("should register services from protobuf root", async () => {
    const server = await createConnectServer({
      port: 0,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    const services = server.getServices();
    expect(services.size).toBe(1);
    expect(services.has("helloworld.Greeter")).toBe(true);
    
    const greeterService = services.get("helloworld.Greeter");
    expect(greeterService?.serviceName).toBe("Greeter");
    expect(greeterService?.packageName).toBe("helloworld");
    expect(greeterService?.fullServiceName).toBe("helloworld.Greeter");
    expect(greeterService?.methods.size).toBe(1);
    expect(greeterService?.methods.has("SayHello")).toBe(true);
    
    await server.stop();
  });

  test("should configure server port from config", async () => {
    const testPort = 18081;
    const server = await createConnectServer({
      port: testPort,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    await server.start();
    
    // Verify server is listening on the correct port
    const address = server.server.address();
    expect(address).toBeDefined();
    expect((address as any).port).toBe(testPort);
    
    await server.stop();
  });

  test("should handle graceful shutdown", async () => {
    const server = await createConnectServer({
      port: 0,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    await server.start();
    expect(server.isListening()).toBe(true);
    
    // Graceful shutdown
    await server.stop();
    expect(server.isListening()).toBe(false);
    
    // Should be safe to call stop again
    await server.stop();
    expect(server.isListening()).toBe(false);
  });

  test("should support CORS configuration", async () => {
    const server = await createConnectServer({
      port: 0,
      corsEnabled: true,
      corsOrigins: ["https://example.com", "https://test.com"],
      corsMethods: ["GET", "POST", "OPTIONS"],
      corsHeaders: ["Content-Type", "Authorization"],
      corsExposedHeaders: ["X-Custom-Header"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    expect(server).toBeDefined();
    await server.stop();
  });

  test("should support TLS configuration", async () => {
    // Test with TLS disabled (no cert/key paths)
    const server = await createConnectServer({
      port: 0,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
      tls: undefined,
    });

    expect(server).toBeDefined();
    await server.stop();
  });

  test("should provide health check endpoint", async () => {
    const server = await createConnectServer({
      port: 18082,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    await server.start();
    
    // Check health endpoint
    const response = await fetch("http://localhost:18082/health");
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.status).toBe("serving");
    expect(data.services).toEqual(["helloworld.Greeter"]);
    
    await server.stop();
  });

  test("should handle multiple services", async () => {
    // Create proto root with multiple services
    const multiRoot = new protobuf.Root();
    
    // Service 1
    const ns1 = multiRoot.define("service1");
    const req1 = new protobuf.Type("Request1");
    req1.add(new protobuf.Field("data", 1, "string"));
    ns1.add(req1);
    const res1 = new protobuf.Type("Response1");
    res1.add(new protobuf.Field("result", 1, "string"));
    ns1.add(res1);
    const svc1 = new protobuf.Service("Service1");
    svc1.add(new protobuf.Method("Method1", "rpc", "Request1", "Response1"));
    ns1.add(svc1);
    
    // Service 2
    const ns2 = multiRoot.define("service2");
    const req2 = new protobuf.Type("Request2");
    req2.add(new protobuf.Field("data", 1, "string"));
    ns2.add(req2);
    const res2 = new protobuf.Type("Response2");
    res2.add(new protobuf.Field("result", 1, "string"));
    ns2.add(res2);
    const svc2 = new protobuf.Service("Service2");
    svc2.add(new protobuf.Method("Method2", "rpc", "Request2", "Response2"));
    ns2.add(svc2);
    
    const server = await createConnectServer({
      port: 0,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot: multiRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    const services = server.getServices();
    expect(services.size).toBe(2);
    expect(services.has("service1.Service1")).toBe(true);
    expect(services.has("service2.Service2")).toBe(true);
    
    await server.stop();
  });

  test("should track request metrics", async () => {
    const server = await createConnectServer({
      port: 18090,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    await server.start();

    // Initial metrics should be zero
    let metrics = server.getMetrics();
    expect(metrics.requests_total).toBe(0);
    expect(metrics.requests_by_protocol.connect).toBe(0);
    expect(metrics.requests_by_protocol.grpc_web).toBe(0);
    expect(metrics.requests_by_protocol.grpc).toBe(0);
    expect(metrics.errors_total).toBe(0);

    // Make a Connect protocol request (JSON)
    await fetch("http://localhost:18090/helloworld.Greeter/SayHello", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "test" }),
    });

    // Check metrics after Connect request
    metrics = server.getMetrics();
    expect(metrics.requests_total).toBe(1);
    expect(metrics.requests_by_protocol.connect).toBe(1);
    expect(metrics.errors_total).toBe(1); // Unimplemented error

    // Make a gRPC-Web request
    await fetch("http://localhost:18090/helloworld.Greeter/SayHello", {
      method: "POST",
      headers: {
        "Content-Type": "application/grpc-web+proto",
      },
      body: new Uint8Array([]),
    });

    // Check metrics after gRPC-Web request
    metrics = server.getMetrics();
    expect(metrics.requests_total).toBe(2);
    expect(metrics.requests_by_protocol.connect).toBe(1);
    expect(metrics.requests_by_protocol.grpc_web).toBe(1);
    expect(metrics.errors_total).toBe(2);

    // Make a standard gRPC request
    await fetch("http://localhost:18090/helloworld.Greeter/SayHello", {
      method: "POST",
      headers: {
        "Content-Type": "application/grpc+proto",
      },
      body: new Uint8Array([]),
    });

    // Check metrics after gRPC request
    metrics = server.getMetrics();
    expect(metrics.requests_total).toBe(3);
    expect(metrics.requests_by_protocol.connect).toBe(1);
    expect(metrics.requests_by_protocol.grpc_web).toBe(1);
    expect(metrics.requests_by_protocol.grpc).toBe(1);
    expect(metrics.errors_total).toBe(3);

    await server.stop();
  });

  test("should not count health checks in metrics", async () => {
    const server = await createConnectServer({
      port: 18091,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    await server.start();

    // Make health check requests
    await fetch("http://localhost:18091/health");
    await fetch("http://localhost:18091/connect/health");

    // Metrics should still be zero
    const metrics = server.getMetrics();
    expect(metrics.requests_total).toBe(0);
    expect(metrics.errors_total).toBe(0);

    await server.stop();
  });

  test("should not count OPTIONS preflight in metrics", async () => {
    const server = await createConnectServer({
      port: 18092,
      corsEnabled: true,
      corsOrigins: ["*"],
      protoRoot,
      rulesIndex: new Map(),
      logger: () => {},
      errorLogger: () => {},
    });

    await server.start();

    // Make OPTIONS preflight request
    await fetch("http://localhost:18092/test", {
      method: "OPTIONS",
    });

    // Metrics should still be zero
    const metrics = server.getMetrics();
    expect(metrics.requests_total).toBe(0);
    expect(metrics.errors_total).toBe(0);

    await server.stop();
  });

  describe("CORS Headers", () => {
    test("should add CORS headers to preflight OPTIONS requests", async () => {
      const server = await createConnectServer({
        port: 18083,
        corsEnabled: true,
        corsOrigins: ["*"],
        corsMethods: ["GET", "POST", "OPTIONS"],
        corsHeaders: ["Content-Type", "Authorization"],
        corsExposedHeaders: ["X-Custom-Header"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();

      // Send OPTIONS preflight request
      const response = await fetch("http://localhost:18083/test", {
        method: "OPTIONS",
        headers: {
          "Origin": "https://example.com",
          "Access-Control-Request-Method": "POST",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST,OPTIONS");
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Authorization");
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Custom-Header");
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");

      await server.stop();
    });

    test("should add CORS headers to regular requests when enabled", async () => {
      const server = await createConnectServer({
        port: 18084,
        corsEnabled: true,
        corsOrigins: ["https://example.com", "https://test.com"],
        corsMethods: ["GET", "POST"],
        corsHeaders: ["Content-Type"],
        corsExposedHeaders: ["Grpc-Status", "Grpc-Message"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();

      // Send regular GET request
      const response = await fetch("http://localhost:18084/health", {
        method: "GET",
        headers: {
          "Origin": "https://example.com",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com,https://test.com");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("Grpc-Status,Grpc-Message");
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");

      await server.stop();
    });

    test("should not add CORS headers when CORS is disabled", async () => {
      const server = await createConnectServer({
        port: 18085,
        corsEnabled: false,
        corsOrigins: [],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();

      // Send regular GET request
      const response = await fetch("http://localhost:18085/health", {
        method: "GET",
        headers: {
          "Origin": "https://example.com",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull();

      await server.stop();
    });

    test("should support wildcard origin for CORS", async () => {
      const server = await createConnectServer({
        port: 18086,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();

      const response = await fetch("http://localhost:18086/health", {
        method: "GET",
        headers: {
          "Origin": "https://any-origin.com",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

      await server.stop();
    });

    test("should include gRPC-Web compatible headers in exposed headers", async () => {
      const server = await createConnectServer({
        port: 18087,
        corsEnabled: true,
        corsOrigins: ["*"],
        corsExposedHeaders: [
          "Connect-Protocol-Version",
          "Connect-Timeout-Ms",
          "Grpc-Status",
          "Grpc-Message",
        ],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();

      const response = await fetch("http://localhost:18087/health");

      expect(response.status).toBe(200);
      const exposedHeaders = response.headers.get("Access-Control-Expose-Headers");
      expect(exposedHeaders).toContain("Connect-Protocol-Version");
      expect(exposedHeaders).toContain("Connect-Timeout-Ms");
      expect(exposedHeaders).toContain("Grpc-Status");
      expect(exposedHeaders).toContain("Grpc-Message");

      await server.stop();
    });

    test("should handle custom CORS methods configuration", async () => {
      const server = await createConnectServer({
        port: 18088,
        corsEnabled: true,
        corsOrigins: ["*"],
        corsMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();

      const response = await fetch("http://localhost:18088/test", {
        method: "OPTIONS",
      });

      expect(response.status).toBe(204);
      const allowedMethods = response.headers.get("Access-Control-Allow-Methods");
      expect(allowedMethods).toBe("GET,POST,PUT,DELETE,OPTIONS");

      await server.stop();
    });

    test("should handle custom CORS headers configuration", async () => {
      const server = await createConnectServer({
        port: 18089,
        corsEnabled: true,
        corsOrigins: ["*"],
        corsHeaders: [
          "Content-Type",
          "Authorization",
          "X-Custom-Header",
          "Connect-Protocol-Version",
        ],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();

      const response = await fetch("http://localhost:18089/test", {
        method: "OPTIONS",
      });

      expect(response.status).toBe(204);
      const allowedHeaders = response.headers.get("Access-Control-Allow-Headers");
      expect(allowedHeaders).toContain("Content-Type");
      expect(allowedHeaders).toContain("Authorization");
      expect(allowedHeaders).toContain("X-Custom-Header");
      expect(allowedHeaders).toContain("Connect-Protocol-Version");

      await server.stop();
    });
  });

  describe("Reflection Support", () => {
    test("should report reflection status", async () => {
      const server = await createConnectServer({
        port: 0,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      // Server should have hasReflection method
      expect(server.hasReflection).toBeDefined();
      expect(typeof server.hasReflection).toBe("function");
      
      // Reflection status depends on whether bin/.descriptors.bin exists
      const hasReflection = server.hasReflection();
      expect(typeof hasReflection).toBe("boolean");
      
      await server.stop();
    });

    test("should include reflection status in health check", async () => {
      const server = await createConnectServer({
        port: 18093,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();
      
      // Check health endpoint includes reflection status
      const response = await fetch("http://localhost:18093/health");
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.status).toBe("serving");
      expect(data.services).toEqual(["helloworld.Greeter"]);
      expect(data.reflection).toBeDefined();
      expect(typeof data.reflection).toBe("boolean");
      
      await server.stop();
    });

    test("should handle reflection requests when enabled", async () => {
      const server = await createConnectServer({
        port: 18094,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();
      
      // Only test if reflection is enabled (descriptor set exists)
      if (server.hasReflection()) {
        // Test list services reflection request
        const listServicesResponse = await fetch(
          "http://localhost:18094/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              listServices: true,
            }),
          }
        );

        expect(listServicesResponse.status).toBe(200);
        const listServicesData = await listServicesResponse.json();
        expect(listServicesData.listServicesResponse).toBeDefined();
        expect(listServicesData.listServicesResponse.service).toBeDefined();
        expect(Array.isArray(listServicesData.listServicesResponse.service)).toBe(true);
      }
      
      await server.stop();
    });

    test("should handle file_containing_symbol reflection request", async () => {
      const server = await createConnectServer({
        port: 18095,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();
      
      // Only test if reflection is enabled
      if (server.hasReflection()) {
        const response = await fetch(
          "http://localhost:18095/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileContainingSymbol: "helloworld.Greeter",
            }),
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.fileDescriptorResponse).toBeDefined();
        expect(data.fileDescriptorResponse.fileDescriptorProto).toBeDefined();
        expect(Array.isArray(data.fileDescriptorResponse.fileDescriptorProto)).toBe(true);
      }
      
      await server.stop();
    });

    test("should handle file_by_filename reflection request", async () => {
      const server = await createConnectServer({
        port: 18096,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();
      
      // Only test if reflection is enabled
      if (server.hasReflection()) {
        const response = await fetch(
          "http://localhost:18096/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileByFilename: "helloworld.proto",
            }),
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.fileDescriptorResponse).toBeDefined();
        expect(data.fileDescriptorResponse.fileDescriptorProto).toBeDefined();
        expect(Array.isArray(data.fileDescriptorResponse.fileDescriptorProto)).toBe(true);
      }
      
      await server.stop();
    });

    test("should reject binary reflection requests", async () => {
      const server = await createConnectServer({
        port: 18097,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();
      
      // Only test if reflection is enabled
      if (server.hasReflection()) {
        const response = await fetch(
          "http://localhost:18097/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/grpc+proto",
            },
            body: new Uint8Array([]),
          }
        );

        expect(response.status).toBe(415);
        const data = await response.json();
        expect(data.code).toBe("unsupported_media_type");
      }
      
      await server.stop();
    });

    test("should handle unknown reflection endpoints", async () => {
      const server = await createConnectServer({
        port: 18098,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex: new Map(),
        logger: () => {},
        errorLogger: () => {},
      });

      await server.start();
      
      // Only test if reflection is enabled
      if (server.hasReflection()) {
        const response = await fetch(
          "http://localhost:18098/grpc.reflection.v1alpha.ServerReflection/UnknownMethod",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          }
        );

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.code).toBe("not_found");
      }
      
      await server.stop();
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createAdminApp } from "../src/interfaces/httpAdmin.js";
import type { StatusResponse, ServicesResponse } from "../src/interfaces/types.js";

describe("Admin API Integration - Connect RPC Status", () => {
  let server: any;
  const TEST_PORT = 14319; // Use a different port to avoid conflicts
  const BASE_URL = `http://localhost:${TEST_PORT}`;

  beforeAll(() => {
    // Create a test admin app with mock data
    server = createAdminApp({
      httpPort: TEST_PORT,
      protoDir: "protos",
      ruleDir: "rules/grpc",
      uploadsDir: "uploads",
      getStatus: (): StatusResponse => ({
        grpc_port: 50050,
        grpc_ports: {
          plaintext: 50050,
          tls: 50051,
          tls_enabled: true,
          mtls: false,
          tls_error: null,
        },
        connect_rpc: {
          enabled: true,
          port: 8080,
          cors_enabled: true,
          cors_origins: ["*"],
          tls_enabled: false,
          error: null,
          services: ["helloworld.Greeter", "calendar.CalendarService"],
          metrics: {
            requests_total: 100,
            requests_by_protocol: {
              connect: 50,
              grpc_web: 30,
              grpc: 20,
            },
            errors_total: 5,
          },
        },
        loaded_services: ["helloworld.Greeter", "calendar.CalendarService"],
        rules: ["helloworld.greeter.sayhello"],
        protos: {
          loaded: ["helloworld.proto", "calendar.proto"],
          skipped: [],
        },
      }),
      listServices: (): ServicesResponse => ({
        services: [],
      }),
      getSchema: () => null,
      onRuleUpdated: () => {},
      getReadiness: () => true,
    });

    // Give the server a moment to start
    return new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    // Express app doesn't need explicit cleanup in tests
    // The server will be cleaned up automatically
  });

  describe("GET /admin/status", () => {
    it("should return status with Connect RPC information", async () => {
      const response = await fetch(`${BASE_URL}/admin/status`);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Verify basic structure
      expect(data).toBeDefined();
      expect(data.grpc_ports).toBeDefined();
      expect(data.loaded_services).toBeDefined();
      expect(data.rules).toBeDefined();

      // Verify Connect RPC information is present
      expect(data.connect_rpc).toBeDefined();
      expect(data.connect_rpc.enabled).toBe(true);
      expect(data.connect_rpc.port).toBe(8080);
      expect(data.connect_rpc.cors_enabled).toBe(true);
      expect(data.connect_rpc.cors_origins).toEqual(["*"]);
      expect(data.connect_rpc.tls_enabled).toBe(false);
      expect(data.connect_rpc.error).toBeNull();
      
      // Verify services list
      expect(data.connect_rpc.services).toHaveLength(2);
      expect(data.connect_rpc.services).toContain("helloworld.Greeter");
      expect(data.connect_rpc.services).toContain("calendar.CalendarService");

      // Verify metrics
      expect(data.connect_rpc.metrics).toBeDefined();
      expect(data.connect_rpc.metrics.requests_total).toBe(100);
      expect(data.connect_rpc.metrics.requests_by_protocol).toBeDefined();
      expect(data.connect_rpc.metrics.requests_by_protocol.connect).toBe(50);
      expect(data.connect_rpc.metrics.requests_by_protocol.grpc_web).toBe(30);
      expect(data.connect_rpc.metrics.requests_by_protocol.grpc).toBe(20);
      expect(data.connect_rpc.metrics.errors_total).toBe(5);
    });
  });

  describe("GET /admin/status - Connect RPC disabled", () => {
    let disabledServer: any;
    const DISABLED_PORT = 14320;
    const DISABLED_URL = `http://localhost:${DISABLED_PORT}`;

    beforeAll(() => {
      disabledServer = createAdminApp({
        httpPort: DISABLED_PORT,
        protoDir: "protos",
        ruleDir: "rules/grpc",
        uploadsDir: "uploads",
        getStatus: (): StatusResponse => ({
          grpc_port: 50050,
          grpc_ports: {
            plaintext: 50050,
            tls_enabled: false,
          },
          connect_rpc: {
            enabled: false,
            port: undefined,
            cors_enabled: false,
            cors_origins: undefined,
            tls_enabled: false,
            error: null,
            services: [],
            metrics: undefined,
          },
          loaded_services: ["helloworld.Greeter"],
          rules: [],
        }),
        listServices: (): ServicesResponse => ({
          services: [],
        }),
        getSchema: () => null,
        onRuleUpdated: () => {},
      });

      return new Promise((resolve) => setTimeout(resolve, 100));
    });

    afterAll(() => {
      // Express app doesn't need explicit cleanup in tests
    });

    it("should return status with Connect RPC disabled", async () => {
      const response = await fetch(`${DISABLED_URL}/admin/status`);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Verify Connect RPC is disabled
      expect(data.connect_rpc).toBeDefined();
      expect(data.connect_rpc.enabled).toBe(false);
      expect(data.connect_rpc.port).toBeUndefined();
      expect(data.connect_rpc.metrics).toBeUndefined();
      expect(data.connect_rpc.services).toHaveLength(0);
    });
  });

  describe("GET /admin/status - Connect RPC with error", () => {
    let errorServer: any;
    const ERROR_PORT = 14321;
    const ERROR_URL = `http://localhost:${ERROR_PORT}`;

    beforeAll(() => {
      errorServer = createAdminApp({
        httpPort: ERROR_PORT,
        protoDir: "protos",
        ruleDir: "rules/grpc",
        uploadsDir: "uploads",
        getStatus: (): StatusResponse => ({
          grpc_port: 50050,
          grpc_ports: {
            plaintext: 50050,
            tls_enabled: false,
          },
          connect_rpc: {
            enabled: false,
            port: undefined,
            cors_enabled: true,
            cors_origins: ["*"],
            tls_enabled: false,
            error: "Failed to bind to port 8080: address already in use",
            services: [],
            metrics: undefined,
          },
          loaded_services: ["helloworld.Greeter"],
          rules: [],
        }),
        listServices: (): ServicesResponse => ({
          services: [],
        }),
        getSchema: () => null,
        onRuleUpdated: () => {},
      });

      return new Promise((resolve) => setTimeout(resolve, 100));
    });

    afterAll(() => {
      // Express app doesn't need explicit cleanup in tests
    });

    it("should return status with Connect RPC error", async () => {
      const response = await fetch(`${ERROR_URL}/admin/status`);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Verify Connect RPC error is reported
      expect(data.connect_rpc).toBeDefined();
      expect(data.connect_rpc.enabled).toBe(false);
      expect(data.connect_rpc.error).toBe("Failed to bind to port 8080: address already in use");
    });
  });
});

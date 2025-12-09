import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createAdminApp } from "../src/interfaces/httpAdmin.js";
import { sharedMetrics } from "../src/domain/metrics/sharedMetrics.js";
import type { StatusResponse, ServicesResponse } from "../src/interfaces/types.js";

/**
 * Tests for Admin API unified metrics
 * 
 * These tests verify that:
 * 1. Status endpoint returns unified metrics from both gRPC and Connect servers
 * 2. Metrics are accurate and reflect activity from both servers
 * 3. Backward compatibility is maintained with existing status format
 * 
 */
describe("Admin API - Unified Metrics", () => {
  let server: any;
  const TEST_PORT = 14322;
  const BASE_URL = `http://localhost:${TEST_PORT}`;

  beforeEach(() => {
    // Reset shared metrics before each test
    sharedMetrics.reset();
  });

  beforeAll(async () => {
    // Create admin app
    server = createAdminApp({
      httpPort: TEST_PORT,
      protoDir: "protos",
      ruleDir: "rules/grpc",
      uploadsDir: "uploads",
      getStatus: (): StatusResponse => {
        // Get current shared metrics
        const metrics = sharedMetrics.getMetrics();
        
        return {
          grpc_port: 50050,
          grpc_ports: {
            plaintext: 50050,
            tls: 50051,
            tls_enabled: true,
          },
          connect_rpc: {
            enabled: true,
            port: 50052,
            cors_enabled: true,
            cors_origins: ["*"],
            tls_enabled: false,
            error: null,
            services: ["helloworld.Greeter"],
            metrics: {
              requests_total: 50,
              requests_by_protocol: {
                connect: 30,
                grpc_web: 15,
                grpc: 5,
              },
              errors_total: 2,
            },
          },
          loaded_services: ["helloworld.Greeter"],
          rules: ["helloworld.greeter.sayhello"],
          shared_metrics: metrics,
        };
      },
      listServices: (): ServicesResponse => ({
        services: [],
      }),
      getSchema: () => null,
      onRuleUpdated: () => {},
    });

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Verify server is responding
    let retries = 10;
    while (retries > 0) {
      try {
        const response = await fetch(`${BASE_URL}/admin/status`);
        if (response.ok) break;
      } catch (e) {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries--;
    }
  });

  afterAll(async () => {
    // Close server
    if (server && server.close) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  describe("Unified metrics structure", () => {
    it("should include shared_metrics in status response", async () => {
      const response = await fetch(`${BASE_URL}/admin/status`);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Verify shared_metrics exists
      expect(data.shared_metrics).toBeDefined();
      expect(data.shared_metrics.validation).toBeDefined();
      expect(data.shared_metrics.rule_matching).toBeDefined();
    });

    it("should have correct validation metrics structure", async () => {
      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const validation = data.shared_metrics.validation;
      expect(validation).toHaveProperty("checks_total");
      expect(validation).toHaveProperty("failures_total");
      expect(validation).toHaveProperty("failures_by_type");
      
      expect(typeof validation.checks_total).toBe("number");
      expect(typeof validation.failures_total).toBe("number");
      expect(typeof validation.failures_by_type).toBe("object");
    });

    it("should have correct rule matching metrics structure", async () => {
      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const ruleMatching = data.shared_metrics.rule_matching;
      expect(ruleMatching).toHaveProperty("attempts_total");
      expect(ruleMatching).toHaveProperty("matches_total");
      expect(ruleMatching).toHaveProperty("misses_total");
      expect(ruleMatching).toHaveProperty("matches_by_rule");
      
      expect(typeof ruleMatching.attempts_total).toBe("number");
      expect(typeof ruleMatching.matches_total).toBe("number");
      expect(typeof ruleMatching.misses_total).toBe("number");
      expect(typeof ruleMatching.matches_by_rule).toBe("object");
    });
  });

  describe("Metrics accuracy from both servers", () => {
    it("should reflect validation metrics from both gRPC and Connect servers", async () => {
      // Simulate validation checks from both servers
      sharedMetrics.recordValidationCheck("helloworld.HelloRequest", true);
      sharedMetrics.recordValidationCheck("helloworld.HelloRequest", true);
      sharedMetrics.recordValidationCheck("helloworld.HelloRequest", false);
      sharedMetrics.recordValidationCheck("calendar.Event", false);

      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const validation = data.shared_metrics.validation;
      expect(validation.checks_total).toBe(4);
      expect(validation.failures_total).toBe(2);
      expect(validation.failures_by_type["helloworld.HelloRequest"]).toBe(1);
      expect(validation.failures_by_type["calendar.Event"]).toBe(1);
    });

    it("should reflect rule matching metrics from both gRPC and Connect servers", async () => {
      // Simulate rule matching from both servers
      sharedMetrics.recordRuleMatchAttempt("helloworld.greeter.sayhello", true);
      sharedMetrics.recordRuleMatchAttempt("helloworld.greeter.sayhello", true);
      sharedMetrics.recordRuleMatchAttempt("helloworld.greeter.sayhello", true);
      sharedMetrics.recordRuleMatchAttempt("calendar.calendarservice.createevent", true);
      sharedMetrics.recordRuleMatchAttempt("unknown.service.method", false);

      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const ruleMatching = data.shared_metrics.rule_matching;
      expect(ruleMatching.attempts_total).toBe(5);
      expect(ruleMatching.matches_total).toBe(4);
      expect(ruleMatching.misses_total).toBe(1);
      expect(ruleMatching.matches_by_rule["helloworld.greeter.sayhello"]).toBe(3);
      expect(ruleMatching.matches_by_rule["calendar.calendarservice.createevent"]).toBe(1);
    });

    it("should track metrics incrementally across multiple requests", async () => {
      // First batch of metrics
      sharedMetrics.recordValidationCheck("TestMessage", true);
      sharedMetrics.recordRuleMatchAttempt("test.service.method", true);

      let response = await fetch(`${BASE_URL}/admin/status`);
      let data = await response.json();
      
      expect(data.shared_metrics.validation.checks_total).toBe(1);
      expect(data.shared_metrics.rule_matching.attempts_total).toBe(1);

      // Second batch of metrics
      sharedMetrics.recordValidationCheck("TestMessage", true);
      sharedMetrics.recordValidationCheck("TestMessage", false);
      sharedMetrics.recordRuleMatchAttempt("test.service.method", true);
      sharedMetrics.recordRuleMatchAttempt("test.service.method2", false);

      response = await fetch(`${BASE_URL}/admin/status`);
      data = await response.json();
      
      expect(data.shared_metrics.validation.checks_total).toBe(3);
      expect(data.shared_metrics.validation.failures_total).toBe(1);
      expect(data.shared_metrics.rule_matching.attempts_total).toBe(3);
      expect(data.shared_metrics.rule_matching.matches_total).toBe(2);
      expect(data.shared_metrics.rule_matching.misses_total).toBe(1);
    });
  });

  describe("Backward compatibility", () => {
    it("should maintain all existing status fields", async () => {
      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      // Legacy fields
      expect(data.grpc_port).toBeDefined();
      
      // Current fields
      expect(data.grpc_ports).toBeDefined();
      expect(data.grpc_ports.plaintext).toBeDefined();
      expect(data.grpc_ports.tls_enabled).toBeDefined();
      
      expect(data.loaded_services).toBeDefined();
      expect(data.rules).toBeDefined();
      
      // Connect RPC fields
      expect(data.connect_rpc).toBeDefined();
      expect(data.connect_rpc.enabled).toBeDefined();
      
      // New shared metrics field
      expect(data.shared_metrics).toBeDefined();
    });

    it("should not break existing status consumers", async () => {
      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      // Verify structure matches expected StatusResponse type
      expect(typeof data.grpc_port).toBe("number");
      expect(Array.isArray(data.loaded_services)).toBe(true);
      expect(Array.isArray(data.rules)).toBe(true);
      expect(typeof data.connect_rpc).toBe("object");
      expect(typeof data.shared_metrics).toBe("object");
    });

    it("should include Connect RPC metrics alongside shared metrics", async () => {
      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      // Connect RPC specific metrics
      expect(data.connect_rpc.metrics).toBeDefined();
      expect(data.connect_rpc.metrics.requests_total).toBe(50);
      expect(data.connect_rpc.metrics.requests_by_protocol).toBeDefined();
      expect(data.connect_rpc.metrics.errors_total).toBe(2);
      
      // Shared metrics (used by both servers)
      expect(data.shared_metrics).toBeDefined();
      expect(data.shared_metrics.validation).toBeDefined();
      expect(data.shared_metrics.rule_matching).toBeDefined();
    });
  });

  describe("Empty metrics state", () => {
    it("should return zero values when no metrics recorded", async () => {
      // Ensure metrics are reset
      sharedMetrics.reset();

      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const validation = data.shared_metrics.validation;
      expect(validation.checks_total).toBe(0);
      expect(validation.failures_total).toBe(0);
      expect(Object.keys(validation.failures_by_type)).toHaveLength(0);
      
      const ruleMatching = data.shared_metrics.rule_matching;
      expect(ruleMatching.attempts_total).toBe(0);
      expect(ruleMatching.matches_total).toBe(0);
      expect(ruleMatching.misses_total).toBe(0);
      expect(Object.keys(ruleMatching.matches_by_rule)).toHaveLength(0);
    });
  });

  describe("High volume metrics", () => {
    it("should accurately track large numbers of metrics", async () => {
      // Simulate high volume of requests
      for (let i = 0; i < 1000; i++) {
        sharedMetrics.recordValidationCheck("TestMessage", i % 10 !== 0);
        sharedMetrics.recordRuleMatchAttempt("test.service.method", i % 5 !== 0);
      }

      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const validation = data.shared_metrics.validation;
      expect(validation.checks_total).toBe(1000);
      expect(validation.failures_total).toBe(100); // Every 10th fails
      
      const ruleMatching = data.shared_metrics.rule_matching;
      expect(ruleMatching.attempts_total).toBe(1000);
      expect(ruleMatching.matches_total).toBe(800); // 4 out of 5 match
      expect(ruleMatching.misses_total).toBe(200); // 1 out of 5 miss
    });
  });

  describe("Multiple message types", () => {
    it("should track failures for multiple message types separately", async () => {
      // Record failures for different message types
      sharedMetrics.recordValidationCheck("MessageA", false);
      sharedMetrics.recordValidationCheck("MessageA", false);
      sharedMetrics.recordValidationCheck("MessageA", true);
      sharedMetrics.recordValidationCheck("MessageB", false);
      sharedMetrics.recordValidationCheck("MessageC", true);
      sharedMetrics.recordValidationCheck("MessageC", true);

      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const validation = data.shared_metrics.validation;
      expect(validation.checks_total).toBe(6);
      expect(validation.failures_total).toBe(3);
      expect(validation.failures_by_type["MessageA"]).toBe(2);
      expect(validation.failures_by_type["MessageB"]).toBe(1);
      expect(validation.failures_by_type["MessageC"]).toBeUndefined();
    });
  });

  describe("Multiple rule keys", () => {
    it("should track matches for multiple rule keys separately", async () => {
      // Record matches for different rule keys
      sharedMetrics.recordRuleMatchAttempt("service1.method1", true);
      sharedMetrics.recordRuleMatchAttempt("service1.method1", true);
      sharedMetrics.recordRuleMatchAttempt("service1.method1", true);
      sharedMetrics.recordRuleMatchAttempt("service2.method2", true);
      sharedMetrics.recordRuleMatchAttempt("service2.method2", true);
      sharedMetrics.recordRuleMatchAttempt("service3.method3", false);

      const response = await fetch(`${BASE_URL}/admin/status`);
      const data = await response.json();
      
      const ruleMatching = data.shared_metrics.rule_matching;
      expect(ruleMatching.attempts_total).toBe(6);
      expect(ruleMatching.matches_total).toBe(5);
      expect(ruleMatching.misses_total).toBe(1);
      expect(ruleMatching.matches_by_rule["service1.method1"]).toBe(3);
      expect(ruleMatching.matches_by_rule["service2.method2"]).toBe(2);
      expect(ruleMatching.matches_by_rule["service3.method3"]).toBeUndefined();
    });
  });
});

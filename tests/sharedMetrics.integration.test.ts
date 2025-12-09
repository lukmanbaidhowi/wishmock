import { describe, it, expect, beforeEach } from "bun:test";
import { handleUnaryRequest } from "../src/domain/usecases/handleRequest.js";
import type { NormalizedRequest } from "../src/domain/types/normalized.js";
import type { RuleDoc } from "../src/domain/types.js";
import { sharedMetrics } from "../src/domain/metrics/sharedMetrics.js";
import { runtime as validationRuntime } from "../src/infrastructure/validation/runtime.js";
import protobuf from "protobufjs";

describe("Shared Metrics Integration", () => {
  let mockRequestType: protobuf.Type;
  let mockResponseType: protobuf.Type;
  let rulesIndex: Map<string, RuleDoc>;
  let logger: (...args: any[]) => void;

  beforeEach(() => {
    // Reset metrics before each test
    sharedMetrics.reset();

    // Create mock protobuf types
    mockRequestType = new protobuf.Type("TestRequest");
    mockRequestType.add(new protobuf.Field("name", 1, "string"));
    
    mockResponseType = new protobuf.Type("TestResponse");
    mockResponseType.add(new protobuf.Field("message", 1, "string"));

    // Initialize rules index
    rulesIndex = new Map();

    // Setup logger
    logger = () => {};

    // Disable validation by default
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  it("should track metrics across multiple requests", async () => {
    // Setup rules
    const rule1: RuleDoc = {
      responses: [
        {
          body: { message: "Response 1" },
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    const rule2: RuleDoc = {
      responses: [
        {
          body: { message: "Response 2" },
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("service1.method1", rule1);
    rulesIndex.set("service2.method2", rule2);

    // Make multiple requests
    const request1: NormalizedRequest = {
      service: "Service1",
      method: "Method1",
      metadata: {},
      data: { name: "Test1" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: false,
    };

    const request2: NormalizedRequest = {
      service: "Service2",
      method: "Method2",
      metadata: {},
      data: { name: "Test2" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: false,
    };

    const request3: NormalizedRequest = {
      service: "Service3",
      method: "Method3",
      metadata: {},
      data: { name: "Test3" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: false,
    };

    // Execute requests
    await handleUnaryRequest(request1, rulesIndex, logger);
    await handleUnaryRequest(request2, rulesIndex, logger);
    await handleUnaryRequest(request3, rulesIndex, logger); // This one has no rule

    // Get metrics
    const metrics = sharedMetrics.getMetrics();

    // Verify rule matching metrics
    expect(metrics.rule_matching.attempts_total).toBe(3);
    expect(metrics.rule_matching.matches_total).toBe(2);
    expect(metrics.rule_matching.misses_total).toBe(1);
    expect(metrics.rule_matching.matches_by_rule["service1.method1"]).toBe(1);
    expect(metrics.rule_matching.matches_by_rule["service2.method2"]).toBe(1);
  });

  it("should track validation metrics when validation is enabled", async () => {
    // Enable validation
    process.env.VALIDATION_ENABLED = "true";
    validationRuntime.configureFromEnv();

    // Mock validators
    let callCount = 0;
    const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
    (validationRuntime as any).getValidator = (typeName: string) => {
      return (data: any) => {
        callCount++;
        // First call succeeds, second fails
        if (callCount === 2) {
          return {
            ok: false,
            violations: [{ field: "name", rule: "test", description: "Validation failed" }],
          };
        }
        return { ok: true };
      };
    };

    // Setup rule
    const rule: RuleDoc = {
      responses: [
        {
          body: { message: "Success" },
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Make requests
    const request1: NormalizedRequest = {
      service: "TestService",
      method: "TestMethod",
      metadata: {},
      data: { name: "Test1" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: false,
    };

    const request2: NormalizedRequest = {
      service: "TestService",
      method: "TestMethod",
      metadata: {},
      data: { name: "Test2" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: false,
    };

    // Execute requests
    await handleUnaryRequest(request1, rulesIndex, logger);
    await handleUnaryRequest(request2, rulesIndex, logger);

    // Get metrics
    const metrics = sharedMetrics.getMetrics();

    // Verify validation metrics
    expect(metrics.validation.checks_total).toBe(2);
    expect(metrics.validation.failures_total).toBe(1);
    expect(metrics.validation.failures_by_type["TestRequest"]).toBe(1);

    // Cleanup
    validationRuntime.getValidator = originalGetValidator;
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  it("should track metrics for both successful and failed requests", async () => {
    // Enable validation
    process.env.VALIDATION_ENABLED = "true";
    validationRuntime.configureFromEnv();

    // Mock validator that always succeeds
    const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
    (validationRuntime as any).getValidator = (typeName: string) => {
      return (data: any) => ({ ok: true });
    };

    // Setup rule
    const rule: RuleDoc = {
      responses: [
        {
          body: { message: "Success" },
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("service.method", rule);

    // Make successful request
    const successRequest: NormalizedRequest = {
      service: "Service",
      method: "Method",
      metadata: {},
      data: { name: "Test" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: false,
    };

    // Make request without matching rule
    const failRequest: NormalizedRequest = {
      service: "UnknownService",
      method: "UnknownMethod",
      metadata: {},
      data: { name: "Test" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: false,
    };

    // Execute requests
    await handleUnaryRequest(successRequest, rulesIndex, logger);
    await handleUnaryRequest(failRequest, rulesIndex, logger);

    // Get metrics
    const metrics = sharedMetrics.getMetrics();

    // Verify metrics
    expect(metrics.validation.checks_total).toBe(2);
    expect(metrics.validation.failures_total).toBe(0);
    expect(metrics.rule_matching.attempts_total).toBe(2);
    expect(metrics.rule_matching.matches_total).toBe(1);
    expect(metrics.rule_matching.misses_total).toBe(1);

    // Cleanup
    validationRuntime.getValidator = originalGetValidator;
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  it("should provide metrics in the format expected by Admin API", () => {
    // Record some metrics
    sharedMetrics.recordValidationCheck("MessageA", true);
    sharedMetrics.recordValidationCheck("MessageA", false);
    sharedMetrics.recordValidationCheck("MessageB", false);
    sharedMetrics.recordRuleMatchAttempt("service.method1", true);
    sharedMetrics.recordRuleMatchAttempt("service.method2", true);
    sharedMetrics.recordRuleMatchAttempt("service.method3", false);

    // Get metrics
    const metrics = sharedMetrics.getMetrics();

    // Verify structure matches expected format
    expect(metrics).toHaveProperty("validation");
    expect(metrics).toHaveProperty("rule_matching");
    
    expect(metrics.validation).toHaveProperty("checks_total");
    expect(metrics.validation).toHaveProperty("failures_total");
    expect(metrics.validation).toHaveProperty("failures_by_type");
    
    expect(metrics.rule_matching).toHaveProperty("attempts_total");
    expect(metrics.rule_matching).toHaveProperty("matches_total");
    expect(metrics.rule_matching).toHaveProperty("misses_total");
    expect(metrics.rule_matching).toHaveProperty("matches_by_rule");

    // Verify values
    expect(metrics.validation.checks_total).toBe(3);
    expect(metrics.validation.failures_total).toBe(2);
    expect(metrics.validation.failures_by_type).toEqual({
      MessageA: 1,
      MessageB: 1,
    });
    
    expect(metrics.rule_matching.attempts_total).toBe(3);
    expect(metrics.rule_matching.matches_total).toBe(2);
    expect(metrics.rule_matching.misses_total).toBe(1);
    expect(metrics.rule_matching.matches_by_rule).toEqual({
      "service.method1": 1,
      "service.method2": 1,
    });
  });
});

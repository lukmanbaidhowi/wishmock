import { describe, it, expect, beforeEach } from "bun:test";
import { handleUnaryRequest } from "../src/domain/usecases/handleRequest.js";
import type { NormalizedRequest, NormalizedResponse, NormalizedError } from "../src/domain/types/normalized.js";
import type { RuleDoc } from "../src/domain/types.js";
import { runtime as validationRuntime } from "../src/infrastructure/validation/runtime.js";
import protobuf from "protobufjs";

describe("handleUnaryRequest", () => {
  let mockRequestType: protobuf.Type;
  let mockResponseType: protobuf.Type;
  let rulesIndex: Map<string, RuleDoc>;
  let logger: (...args: any[]) => void;
  let logMessages: string[];

  beforeEach(() => {
    // Create mock protobuf types
    mockRequestType = new protobuf.Type("TestRequest");
    mockRequestType.add(new protobuf.Field("name", 1, "string"));
    
    mockResponseType = new protobuf.Type("TestResponse");
    mockResponseType.add(new protobuf.Field("message", 1, "string"));

    // Initialize rules index
    rulesIndex = new Map();

    // Setup logger
    logMessages = [];
    logger = (...args: any[]) => {
      logMessages.push(args.join(" "));
    };

    // Disable validation by default
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  describe("successful request handling", () => {
    it("should return success response when rule matches", async () => {
      // Setup rule
      const rule: RuleDoc = {
        responses: [
          {
            body: { message: "Hello, World!" },
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify result
      expect((result as NormalizedResponse).data).toEqual({ message: "Hello, World!" });
      expect(logMessages).toContain("[shared] TestService/TestMethod - validation passed");
      expect(logMessages).toContain("[shared] TestService/TestMethod - rule matched: testservice.testmethod");
      expect(logMessages).toContain("[shared] TestService/TestMethod - returning success response");
    });

    it("should handle rule with metadata", async () => {
      // Setup rule with metadata matching
      const rule: RuleDoc = {
        match: {
          metadata: { auth: "token123" },
        },
        responses: [
          {
            body: { message: "Authenticated" },
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request with matching metadata
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: { auth: "token123" },
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify result
      expect((result as NormalizedResponse).data).toEqual({ message: "Authenticated" });
    });

    it("should handle rule with request matching", async () => {
      // Setup rule with request matching
      const rule: RuleDoc = {
        match: {
          request: { name: "Alice" },
        },
        responses: [
          {
            body: { message: "Hello, Alice!" },
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request with matching data
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Alice" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify result
      expect((result as NormalizedResponse).data).toEqual({ message: "Hello, Alice!" });
    });

    it("should handle rule with trailers", async () => {
      // Setup rule with custom trailers
      const rule: RuleDoc = {
        responses: [
          {
            body: { message: "Success" },
            trailers: {
              "grpc-status": "0",
              "custom-header": "value",
            },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify result
      expect((result as NormalizedResponse).data).toEqual({ message: "Success" });
      expect((result as NormalizedResponse).trailer).toEqual({ "custom-header": "value" });
    });
  });

  describe("validation", () => {
    it("should validate request when validation is enabled", async () => {
      // Enable validation
      process.env.VALIDATION_ENABLED = "true";
      validationRuntime.configureFromEnv();

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

      // Create request with valid data
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Should succeed (no validator registered for mock type)
      expect((result as NormalizedResponse).data).toEqual({ message: "Success" });
      
      // Cleanup
      process.env.VALIDATION_ENABLED = "false";
      validationRuntime.configureFromEnv();
    });

    it("should return validation error when validation fails", async () => {
      // Enable validation
      process.env.VALIDATION_ENABLED = "true";
      validationRuntime.configureFromEnv();

      // Mock a validator that fails
      const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
      (validationRuntime as any).getValidator = (typeName: string) => {
        return (data: any) => ({
          ok: false,
          violations: [
            {
              field: "name",
              rule: "string.min_len",
              description: "name must be at least 3 characters",
            },
          ],
        });
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

      // Create request with invalid data
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "ab" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Should return validation error
      expect((result as NormalizedError).code).toBe("INVALID_ARGUMENT");
      expect((result as NormalizedError).message).toBe("Request validation failed");
      expect((result as NormalizedError).details).toHaveLength(1);
      expect((result as NormalizedError).details![0].rule).toBe("string.min_len");
      expect(logMessages).toContain("[shared] TestService/TestMethod - validation failed");

      // Cleanup
      validationRuntime.getValidator = originalGetValidator;
      process.env.VALIDATION_ENABLED = "false";
      validationRuntime.configureFromEnv();
    });

    it("should handle validation engine errors gracefully", async () => {
      // Enable validation
      process.env.VALIDATION_ENABLED = "true";
      validationRuntime.configureFromEnv();

      // Mock a validator that throws
      const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
      (validationRuntime as any).getValidator = (typeName: string) => {
        return (data: any) => {
          throw new Error("Validation engine crashed");
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

      // Create request
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Should return internal error
      expect((result as NormalizedError).code).toBe("INTERNAL");
      expect((result as NormalizedError).message).toContain("Validation engine crashed");

      // Cleanup
      validationRuntime.getValidator = originalGetValidator;
      process.env.VALIDATION_ENABLED = "false";
      validationRuntime.configureFromEnv();
    });
  });

  describe("error handling", () => {
    it("should return UNIMPLEMENTED when no rule matches", async () => {
      // Create request without matching rule
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify error
      expect((result as NormalizedError).code).toBe("UNIMPLEMENTED");
      expect((result as NormalizedError).message).toBe("No rule matched for TestService/TestMethod");
      expect(logMessages).toContain("[shared] TestService/TestMethod - no rule matched");
    });

    it("should return error response when rule specifies error status", async () => {
      // Setup rule with error status
      const rule: RuleDoc = {
        responses: [
          {
            body: {},
            trailers: {
              "grpc-status": "5",
              "grpc-message": "Resource not found",
            },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify error
      expect((result as NormalizedError).code).toBe("NOT_FOUND");
      expect((result as NormalizedError).message).toBe("Resource not found");
      expect(logMessages).toContain("[shared] TestService/TestMethod - returning error: NOT_FOUND");
    });

    it("should map various gRPC status codes correctly", async () => {
      const testCases = [
        { status: 3, expectedCode: "INVALID_ARGUMENT" },
        { status: 7, expectedCode: "PERMISSION_DENIED" },
        { status: 12, expectedCode: "UNIMPLEMENTED" },
        { status: 13, expectedCode: "INTERNAL" },
        { status: 16, expectedCode: "UNAUTHENTICATED" },
      ];

      for (const { status, expectedCode } of testCases) {
        const rule: RuleDoc = {
          responses: [
            {
              body: {},
              trailers: {
                "grpc-status": status,
                "grpc-message": "Test error",
              },
            },
          ],
        };
        rulesIndex.set("testservice.testmethod", rule);

        const request: NormalizedRequest = {
          service: "TestService",
          method: "TestMethod",
          metadata: {},
          data: { name: "Test" },
          requestType: mockRequestType,
          responseType: mockResponseType,
          requestStream: false,
          responseStream: false,
        };

        const result = await handleUnaryRequest(request, rulesIndex, logger);
        expect((result as NormalizedError).code).toBe(expectedCode);
      }
    });

    it("should handle internal errors gracefully", async () => {
      // Setup a rules index that will throw an error when accessed
      const errorRulesIndex = new Map();
      Object.defineProperty(errorRulesIndex, 'get', {
        value: () => {
          throw new Error("Simulated internal error");
        }
      });

      // Create request
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, errorRulesIndex as any, logger);

      // Should not throw, but return error
      expect((result as NormalizedError).code).toBe("INTERNAL");
      expect((result as NormalizedError).message).toContain("Simulated internal error");
      expect(logMessages.some(msg => msg.includes("internal error"))).toBe(true);
    });
  });

  describe("rule matching", () => {
    it("should match rule case-insensitively", async () => {
      // Setup rule with lowercase key
      const rule: RuleDoc = {
        responses: [
          {
            body: { message: "Matched" },
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request with mixed case
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify result
      expect((result as NormalizedResponse).data).toEqual({ message: "Matched" });
    });

    it("should use fallback response when conditional match fails", async () => {
      // Setup rule with conditional and fallback
      const rule: RuleDoc = {
        responses: [
          {
            when: { "request.name": "Alice" },
            body: { message: "Hello, Alice!" },
            trailers: { "grpc-status": "0" },
          },
          {
            body: { message: "Hello, stranger!" },
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request that doesn't match conditional
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Bob" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify fallback is used
      expect((result as NormalizedResponse).data).toEqual({ message: "Hello, stranger!" });
    });

    it("should select highest priority response", async () => {
      // Setup rule with multiple matching responses
      const rule: RuleDoc = {
        responses: [
          {
            when: { "request.name": "Test" },
            body: { priority: "low" },
            trailers: { "grpc-status": "0" },
            priority: 1,
          },
          {
            when: { "request.name": "Test" },
            body: { priority: "high" },
            trailers: { "grpc-status": "0" },
            priority: 10,
          },
          {
            when: { "request.name": "Test" },
            body: { priority: "medium" },
            trailers: { "grpc-status": "0" },
            priority: 5,
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify highest priority is selected
      expect((result as NormalizedResponse).data).toEqual({ priority: "high" });
    });

    it("should handle metadata matching correctly", async () => {
      // Setup rule that requires specific metadata
      const rule: RuleDoc = {
        match: {
          metadata: { "x-api-key": "secret123" },
        },
        responses: [
          {
            body: { authenticated: true },
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request with matching metadata
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: { "x-api-key": "secret123", "other-header": "value" },
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify match
      expect((result as NormalizedResponse).data).toEqual({ authenticated: true });
    });

    it("should handle complex request matching with nested fields", async () => {
      // Create mock type with nested field
      const nestedType = new protobuf.Type("NestedRequest");
      nestedType.add(new protobuf.Field("name", 1, "string"));
      nestedType.add(new protobuf.Field("age", 2, "int32"));

      // Setup rule with nested field matching
      const rule: RuleDoc = {
        match: {
          request: { "name": "Alice", "age": 30 },
        },
        responses: [
          {
            body: { matched: true },
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request with matching nested data
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Alice", age: 30 },
        requestType: nestedType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify match
      expect((result as NormalizedResponse).data).toEqual({ matched: true });
    });

    it("should handle empty response body", async () => {
      // Setup rule with empty body
      const rule: RuleDoc = {
        responses: [
          {
            body: {},
            trailers: { "grpc-status": "0" },
          },
        ],
      };
      rulesIndex.set("testservice.testmethod", rule);

      // Create request
      const request: NormalizedRequest = {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      // Handle request
      const result = await handleUnaryRequest(request, rulesIndex, logger);

      // Verify empty body
      expect((result as NormalizedResponse).data).toEqual({});
    });
  });
});

describe("handleServerStreamingRequest", () => {
  let mockRequestType: protobuf.Type;
  let mockResponseType: protobuf.Type;
  let rulesIndex: Map<string, RuleDoc>;
  let logger: (...args: any[]) => void;
  let logMessages: string[];

  beforeEach(() => {
    // Create mock protobuf types
    mockRequestType = new protobuf.Type("TestRequest");
    mockRequestType.add(new protobuf.Field("name", 1, "string"));
    
    mockResponseType = new protobuf.Type("TestResponse");
    mockResponseType.add(new protobuf.Field("message", 1, "string"));

    // Initialize rules index
    rulesIndex = new Map();

    // Setup logger
    logMessages = [];
    logger = (...args: any[]) => {
      logMessages.push(args.join(" "));
    };

    // Disable validation by default
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  it("should stream multiple responses from stream_items", async () => {
    const { handleServerStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup rule with stream_items
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [
            { message: "Item 1" },
            { message: "Item 2" },
            { message: "Item 3" },
          ],
          stream_delay_ms: 10,
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create request
    const request: NormalizedRequest = {
      service: "TestService",
      method: "TestMethod",
      metadata: {},
      data: { name: "Test" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: true,
    };

    // Collect streamed responses
    const responses: NormalizedResponse[] = [];
    for await (const response of handleServerStreamingRequest(request, rulesIndex, logger)) {
      responses.push(response as NormalizedResponse);
    }

    // Verify responses
    expect(responses).toHaveLength(3);
    expect(responses[0].data).toEqual({ message: "Item 1" });
    expect(responses[1].data).toEqual({ message: "Item 2" });
    expect(responses[2].data).toEqual({ message: "Item 3" });
    expect(logMessages.some(msg => msg.includes("streaming 3 items"))).toBe(true);
  });

  it("should return error when no rule matches", async () => {
    const { handleServerStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Create request without matching rule
    const request: NormalizedRequest = {
      service: "TestService",
      method: "TestMethod",
      metadata: {},
      data: { name: "Test" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: true,
    };

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleServerStreamingRequest(request, rulesIndex, logger)) {
      responses.push(response);
    }

    // Verify error
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("UNIMPLEMENTED");
  });

  it("should return error response when rule specifies error status", async () => {
    const { handleServerStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup rule with error status
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [{ message: "Should not see this" }],
          trailers: {
            "grpc-status": "5",
            "grpc-message": "Resource not found",
          },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create request
    const request: NormalizedRequest = {
      service: "TestService",
      method: "TestMethod",
      metadata: {},
      data: { name: "Test" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: true,
    };

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleServerStreamingRequest(request, rulesIndex, logger)) {
      responses.push(response);
    }

    // Verify error
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("NOT_FOUND");
    expect((responses[0] as NormalizedError).message).toBe("Resource not found");
  });

  it("should return validation error when validation fails", async () => {
    const { handleServerStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Enable validation
    process.env.VALIDATION_ENABLED = "true";
    validationRuntime.configureFromEnv();

    // Mock a validator that fails
    const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
    (validationRuntime as any).getValidator = (typeName: string) => {
      return (data: any) => ({
        ok: false,
        violations: [{ field: "name", rule: "test", description: "Validation failed" }],
      });
    };

    // Setup rule
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [{ message: "Item 1" }],
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create request
    const request: NormalizedRequest = {
      service: "TestService",
      method: "TestMethod",
      metadata: {},
      data: { name: "Test" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: true,
    };

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleServerStreamingRequest(request, rulesIndex, logger)) {
      responses.push(response);
    }

    // Verify error
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("INVALID_ARGUMENT");

    // Cleanup
    validationRuntime.getValidator = originalGetValidator;
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  it("should handle stream with delay and loop configuration", async () => {
    const { handleServerStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup rule with delay but no loop
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [
            { message: "Item 1" },
            { message: "Item 2" },
          ],
          stream_delay_ms: 5,
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create request
    const request: NormalizedRequest = {
      service: "TestService",
      method: "TestMethod",
      metadata: {},
      data: { name: "Test" },
      requestType: mockRequestType,
      responseType: mockResponseType,
      requestStream: false,
      responseStream: true,
    };

    // Collect responses with timing
    const startTime = Date.now();
    const responses: NormalizedResponse[] = [];
    for await (const response of handleServerStreamingRequest(request, rulesIndex, logger)) {
      responses.push(response as NormalizedResponse);
    }
    const duration = Date.now() - startTime;

    // Verify responses
    expect(responses).toHaveLength(2);
    expect(responses[0].data).toEqual({ message: "Item 1" });
    expect(responses[1].data).toEqual({ message: "Item 2" });
    
    // Verify delay was applied (at least 5ms between items)
    expect(duration).toBeGreaterThanOrEqual(5);
  });
});

describe("handleClientStreamingRequest", () => {
  let mockRequestType: protobuf.Type;
  let mockResponseType: protobuf.Type;
  let rulesIndex: Map<string, RuleDoc>;
  let logger: (...args: any[]) => void;
  let logMessages: string[];

  beforeEach(() => {
    // Create mock protobuf types
    mockRequestType = new protobuf.Type("TestRequest");
    mockRequestType.add(new protobuf.Field("name", 1, "string"));
    
    mockResponseType = new protobuf.Type("TestResponse");
    mockResponseType.add(new protobuf.Field("message", 1, "string"));
    mockResponseType.add(new protobuf.Field("count", 2, "int32"));

    // Initialize rules index
    rulesIndex = new Map();

    // Setup logger
    logMessages = [];
    logger = (...args: any[]) => {
      logMessages.push(args.join(" "));
    };

    // Disable validation by default
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  it("should aggregate multiple requests and return single response", async () => {
    const { handleClientStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup rule that uses aggregated request
    const rule: RuleDoc = {
      responses: [
        {
          body: { message: "Received {{request.count}} items", count: "{{request.count}}" },
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create async iterable of requests
    async function* generateRequests() {
      const requests: NormalizedRequest[] = [
        {
          service: "TestService",
          method: "TestMethod",
          metadata: { auth: "token" },
          data: { name: "Request 1" },
          requestType: mockRequestType,
          responseType: mockResponseType,
          requestStream: true,
          responseStream: false,
        },
        {
          service: "TestService",
          method: "TestMethod",
          metadata: {},
          data: { name: "Request 2" },
          requestType: mockRequestType,
          responseType: mockResponseType,
          requestStream: true,
          responseStream: false,
        },
        {
          service: "TestService",
          method: "TestMethod",
          metadata: {},
          data: { name: "Request 3" },
          requestType: mockRequestType,
          responseType: mockResponseType,
          requestStream: true,
          responseStream: false,
        },
      ];

      for (const req of requests) {
        yield req;
      }
    }

    // Handle client streaming request
    const result = await handleClientStreamingRequest(generateRequests(), rulesIndex, logger);

    // Verify result (template engine may return string or number)
    const count = (result as NormalizedResponse).data.count;
    expect(count === 3 || count === "3").toBe(true);
    expect(logMessages.some(msg => msg.includes("received 3 messages"))).toBe(true);
  });

  it("should return error when no rule matches", async () => {
    const { handleClientStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: false,
      };
    }

    // Handle request without matching rule
    const result = await handleClientStreamingRequest(generateRequests(), rulesIndex, logger);

    // Verify error
    expect((result as NormalizedError).code).toBe("UNIMPLEMENTED");
  });

  it("should return error response when rule specifies error status", async () => {
    const { handleClientStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup rule with error status
    const rule: RuleDoc = {
      responses: [
        {
          body: {},
          trailers: {
            "grpc-status": "3",
            "grpc-message": "Invalid request",
          },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: false,
      };
    }

    // Handle request
    const result = await handleClientStreamingRequest(generateRequests(), rulesIndex, logger);

    // Verify error
    expect((result as NormalizedError).code).toBe("INVALID_ARGUMENT");
    expect((result as NormalizedError).message).toBe("Invalid request");
  });

  it("should validate in per_message mode", async () => {
    const { handleClientStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Enable validation in per_message mode
    process.env.VALIDATION_ENABLED = "true";
    process.env.VALIDATION_MODE = "per_message";
    validationRuntime.configureFromEnv();

    // Mock a validator that fails on second message
    let callCount = 0;
    const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
    (validationRuntime as any).getValidator = (typeName: string) => {
      return (data: any) => {
        callCount++;
        if (callCount === 2) {
          return {
            ok: false,
            violations: [{ field: "name", rule: "test", description: "Second message invalid" }],
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

    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: false,
      };
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 2" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: false,
      };
    }

    // Handle request
    const result = await handleClientStreamingRequest(generateRequests(), rulesIndex, logger);

    // Verify error on second message
    expect((result as NormalizedError).code).toBe("INVALID_ARGUMENT");
    expect(logMessages.some(msg => msg.includes("validation failed on message 2"))).toBe(true);

    // Cleanup
    validationRuntime.getValidator = originalGetValidator;
    process.env.VALIDATION_ENABLED = "false";
    delete process.env.VALIDATION_MODE;
    validationRuntime.configureFromEnv();
  });

  it("should validate in aggregate mode", async () => {
    const { handleClientStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Enable validation in aggregate mode
    process.env.VALIDATION_ENABLED = "true";
    process.env.VALIDATION_MODE = "aggregate";
    validationRuntime.configureFromEnv();

    // Mock a validator that fails on second message
    let callCount = 0;
    const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
    (validationRuntime as any).getValidator = (typeName: string) => {
      return (data: any) => {
        callCount++;
        if (callCount === 2) {
          return {
            ok: false,
            violations: [{ field: "name", rule: "test", description: "Second message invalid" }],
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

    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: false,
      };
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 2" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: false,
      };
    }

    // Handle request
    const result = await handleClientStreamingRequest(generateRequests(), rulesIndex, logger);

    // Verify error on second message in aggregate validation
    expect((result as NormalizedError).code).toBe("INVALID_ARGUMENT");
    expect(logMessages.some(msg => msg.includes("aggregate validation failed on message 2"))).toBe(true);

    // Cleanup
    validationRuntime.getValidator = originalGetValidator;
    process.env.VALIDATION_ENABLED = "false";
    delete process.env.VALIDATION_MODE;
    validationRuntime.configureFromEnv();
  });
});

describe("handleBidiStreamingRequest", () => {
  let mockRequestType: protobuf.Type;
  let mockResponseType: protobuf.Type;
  let rulesIndex: Map<string, RuleDoc>;
  let logger: (...args: any[]) => void;
  let logMessages: string[];

  beforeEach(() => {
    // Create mock protobuf types
    mockRequestType = new protobuf.Type("TestRequest");
    mockRequestType.add(new protobuf.Field("name", 1, "string"));
    
    mockResponseType = new protobuf.Type("TestResponse");
    mockResponseType.add(new protobuf.Field("message", 1, "string"));

    // Initialize rules index
    rulesIndex = new Map();

    // Setup logger
    logMessages = [];
    logger = (...args: any[]) => {
      logMessages.push(args.join(" "));
    };

    // Disable validation by default
    process.env.VALIDATION_ENABLED = "false";
    validationRuntime.configureFromEnv();
  });

  it("should aggregate requests and stream multiple responses", async () => {
    const { handleBidiStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup rule with stream_items
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [
            { message: "Response 1" },
            { message: "Response 2" },
          ],
          stream_delay_ms: 10,
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create async iterable of requests
    async function* generateRequests() {
      const requests: NormalizedRequest[] = [
        {
          service: "TestService",
          method: "TestMethod",
          metadata: {},
          data: { name: "Request 1" },
          requestType: mockRequestType,
          responseType: mockResponseType,
          requestStream: true,
          responseStream: true,
        },
        {
          service: "TestService",
          method: "TestMethod",
          metadata: {},
          data: { name: "Request 2" },
          requestType: mockRequestType,
          responseType: mockResponseType,
          requestStream: true,
          responseStream: true,
        },
      ];

      for (const req of requests) {
        yield req;
      }
    }

    // Collect streamed responses
    const responses: NormalizedResponse[] = [];
    for await (const response of handleBidiStreamingRequest(generateRequests(), rulesIndex, logger)) {
      responses.push(response as NormalizedResponse);
    }

    // Verify responses
    expect(responses).toHaveLength(2);
    expect(responses[0].data).toEqual({ message: "Response 1" });
    expect(responses[1].data).toEqual({ message: "Response 2" });
    expect(logMessages.some(msg => msg.includes("received 2 messages"))).toBe(true);
    expect(logMessages.some(msg => msg.includes("streaming 2 items"))).toBe(true);
  });

  it("should return error when no rule matches", async () => {
    const { handleBidiStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };
    }

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleBidiStreamingRequest(generateRequests(), rulesIndex, logger)) {
      responses.push(response);
    }

    // Verify error
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("UNIMPLEMENTED");
  });

  it("should return error response when rule specifies error status", async () => {
    const { handleBidiStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup rule with error status
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [{ message: "Should not see this" }],
          trailers: {
            "grpc-status": "13",
            "grpc-message": "Internal error",
          },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };
    }

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleBidiStreamingRequest(generateRequests(), rulesIndex, logger)) {
      responses.push(response);
    }

    // Verify error
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("INTERNAL");
    expect((responses[0] as NormalizedError).message).toBe("Internal error");
  });

  it("should validate in per_message mode", async () => {
    const { handleBidiStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Enable validation in per_message mode
    process.env.VALIDATION_ENABLED = "true";
    process.env.VALIDATION_MODE = "per_message";
    validationRuntime.configureFromEnv();

    // Mock a validator that fails on second message
    let callCount = 0;
    const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
    (validationRuntime as any).getValidator = (typeName: string) => {
      return (data: any) => {
        callCount++;
        if (callCount === 2) {
          return {
            ok: false,
            violations: [{ field: "name", rule: "test", description: "Second message invalid" }],
          };
        }
        return { ok: true };
      };
    };

    // Setup rule
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [{ message: "Response 1" }],
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 2" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };
    }

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleBidiStreamingRequest(generateRequests(), rulesIndex, logger)) {
      responses.push(response);
    }

    // Verify error on second message
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("INVALID_ARGUMENT");
    expect(logMessages.some(msg => msg.includes("validation failed on message 2"))).toBe(true);

    // Cleanup
    validationRuntime.getValidator = originalGetValidator;
    process.env.VALIDATION_ENABLED = "false";
    delete process.env.VALIDATION_MODE;
    validationRuntime.configureFromEnv();
  });

  it("should validate in aggregate mode", async () => {
    const { handleBidiStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Enable validation in aggregate mode
    process.env.VALIDATION_ENABLED = "true";
    process.env.VALIDATION_MODE = "aggregate";
    validationRuntime.configureFromEnv();

    // Mock a validator that fails on second message
    let callCount = 0;
    const originalGetValidator = validationRuntime.getValidator.bind(validationRuntime);
    (validationRuntime as any).getValidator = (typeName: string) => {
      return (data: any) => {
        callCount++;
        if (callCount === 2) {
          return {
            ok: false,
            violations: [{ field: "name", rule: "test", description: "Second message invalid" }],
          };
        }
        return { ok: true };
      };
    };

    // Setup rule
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [{ message: "Response 1" }],
          trailers: { "grpc-status": "0" },
        },
      ],
    };
    rulesIndex.set("testservice.testmethod", rule);

    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 2" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };
    }

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleBidiStreamingRequest(generateRequests(), rulesIndex, logger)) {
      responses.push(response);
    }

    // Verify error on second message in aggregate validation
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("INVALID_ARGUMENT");
    expect(logMessages.some(msg => msg.includes("aggregate validation failed on message 2"))).toBe(true);

    // Cleanup
    validationRuntime.getValidator = originalGetValidator;
    process.env.VALIDATION_ENABLED = "false";
    delete process.env.VALIDATION_MODE;
    validationRuntime.configureFromEnv();
  });

  it("should handle internal errors gracefully", async () => {
    const { handleBidiStreamingRequest } = await import("../src/domain/usecases/handleRequest.js");
    
    // Setup a rules index that will throw an error when accessed
    const errorRulesIndex = new Map();
    Object.defineProperty(errorRulesIndex, 'get', {
      value: () => {
        throw new Error("Simulated internal error");
      }
    });

    // Create async iterable of requests
    async function* generateRequests() {
      yield {
        service: "TestService",
        method: "TestMethod",
        metadata: {},
        data: { name: "Request 1" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };
    }

    // Collect responses
    const responses: (NormalizedResponse | NormalizedError)[] = [];
    for await (const response of handleBidiStreamingRequest(generateRequests(), errorRulesIndex as any, logger)) {
      responses.push(response);
    }

    // Verify error
    expect(responses).toHaveLength(1);
    expect((responses[0] as NormalizedError).code).toBe("INTERNAL");
    expect((responses[0] as NormalizedError).message).toContain("Simulated internal error");
  });
});

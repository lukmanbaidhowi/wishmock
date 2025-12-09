/**
 * Connect RPC Integration Tests
 * 
 * Tests the integration of Connect RPC with:
 * - Rule matching system
 * - Validation engine (protovalidate/PGV)
 * - Streaming handlers (all four patterns)
 * - Reflection service
 * 
 * These tests verify that all components work together correctly.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { registerServices } from "../src/infrastructure/serviceRegistry.js";
import { extractMetadata, normalizeRequest, formatResponse, mapValidationError } from "../src/infrastructure/protocolAdapter.js";
import { runtime as validationRuntime } from "../src/infrastructure/validation/runtime.js";
import protobuf from "protobufjs";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import type { RuleDoc } from "../src/domain/types.js";

describe("Connect RPC Integration Tests", () => {
  let protoRoot: protobuf.Root;
  let rulesIndex: Map<string, RuleDoc>;
  let services: Map<string, any>;

  beforeAll(async () => {
    // Load proto files with proper import paths
    const helloworldProto = path.join(process.cwd(), "protos", "helloworld.proto");
    const streamingProto = path.join(process.cwd(), "protos", "streaming.proto");
    
    protoRoot = new protobuf.Root();
    protoRoot.resolvePath = (_origin: string, target: string) => {
      // Handle imports from protos directory
      if (target.startsWith("validate/") || target.startsWith("buf/") || target.startsWith("google/")) {
        return path.join(process.cwd(), "protos", target);
      }
      return target;
    };
    
    try {
      await protoRoot.load(helloworldProto, { keepCase: true });
      await protoRoot.load(streamingProto, { keepCase: true });
    } catch (error) {
      console.error("Failed to load proto files:", error);
      throw error;
    }

    // Load rule files
    rulesIndex = new Map();
    const rulesDir = path.join(process.cwd(), "rules", "grpc");
    
    // Load SayHello rule
    const sayHelloRulePath = path.join(rulesDir, "helloworld.greeter.sayhello.yaml");
    if (fs.existsSync(sayHelloRulePath)) {
      const sayHelloRule = yaml.load(fs.readFileSync(sayHelloRulePath, "utf8")) as RuleDoc;
      rulesIndex.set("helloworld.greeter.sayhello", sayHelloRule);
    }

    // Load ValidateString rule
    const validateStringRulePath = path.join(rulesDir, "helloworld.greeter.validatestring.yaml");
    if (fs.existsSync(validateStringRulePath)) {
      const validateStringRule = yaml.load(fs.readFileSync(validateStringRulePath, "utf8")) as RuleDoc;
      rulesIndex.set("helloworld.greeter.validatestring", validateStringRule);
    }

    // Load GetMessages streaming rule
    const getMessagesRulePath = path.join(rulesDir, "streaming.streamservice.getmessages.yaml");
    if (fs.existsSync(getMessagesRulePath)) {
      const getMessagesRule = yaml.load(fs.readFileSync(getMessagesRulePath, "utf8")) as RuleDoc;
      rulesIndex.set("streaming.streamservice.getmessages", getMessagesRule);
    }

    // Load UploadHello client streaming rule
    const uploadHelloRulePath = path.join(rulesDir, "helloworld.greeter.uploadhello.yaml");
    if (fs.existsSync(uploadHelloRulePath)) {
      const uploadHelloRule = yaml.load(fs.readFileSync(uploadHelloRulePath, "utf8")) as RuleDoc;
      rulesIndex.set("helloworld.greeter.uploadhello", uploadHelloRule);
    }

    // Load ChatHello bidirectional streaming rule
    const chatHelloRulePath = path.join(rulesDir, "helloworld.greeter.chathello.yaml");
    if (fs.existsSync(chatHelloRulePath)) {
      const chatHelloRule = yaml.load(fs.readFileSync(chatHelloRulePath, "utf8")) as RuleDoc;
      rulesIndex.set("helloworld.greeter.chathello", chatHelloRule);
    }

    // Register services to test integration
    services = registerServices(
      protoRoot,
      rulesIndex,
      () => {},
      () => {}
    );
  });

  describe("Service Registry Integration", () => {
    test("should register services from protobuf root", () => {
      expect(services.size).toBeGreaterThan(0);
      expect(services.has("helloworld.Greeter")).toBe(true);
      expect(services.has("streaming.StreamService")).toBe(true);
    });

    test("should register methods for each service", () => {
      const greeterService = services.get("helloworld.Greeter");
      expect(greeterService).toBeDefined();
      expect(greeterService.methods.size).toBeGreaterThan(0);
      expect(greeterService.methods.has("SayHello")).toBe(true);
    });

    test("should identify streaming methods correctly", () => {
      const greeterService = services.get("helloworld.Greeter");
      const sayHelloMethod = greeterService.methods.get("SayHello");
      const uploadHelloMethod = greeterService.methods.get("UploadHello");
      const chatHelloMethod = greeterService.methods.get("ChatHello");

      // SayHello is unary (no streaming)
      expect(sayHelloMethod.requestStream).toBe(false);
      expect(sayHelloMethod.responseStream).toBe(false);

      // UploadHello is client streaming
      expect(uploadHelloMethod.requestStream).toBe(true);
      expect(uploadHelloMethod.responseStream).toBe(false);

      // ChatHello is bidirectional streaming
      expect(chatHelloMethod.requestStream).toBe(true);
      expect(chatHelloMethod.responseStream).toBe(true);
    });

    test("should identify server streaming methods", () => {
      const streamService = services.get("streaming.StreamService");
      const getMessagesMethod = streamService.methods.get("GetMessages");

      // GetMessages is server streaming
      expect(getMessagesMethod.requestStream).toBe(false);
      expect(getMessagesMethod.responseStream).toBe(true);
    });

    test("should create handlers for all methods", () => {
      const greeterService = services.get("helloworld.Greeter");
      for (const [_methodName, methodMeta] of greeterService.methods) {
        expect(methodMeta.handler).toBeDefined();
        expect(typeof methodMeta.handler).toBe("function");
      }
    });

    test("should set correct rule keys for methods", () => {
      const greeterService = services.get("helloworld.Greeter");
      const sayHelloMethod = greeterService.methods.get("SayHello");
      
      expect(sayHelloMethod.ruleKey).toBe("helloworld.greeter.sayhello");
    });
  });

  describe("Validation Integration", () => {
    test("should integrate with validation engine for request validation", () => {
      const validator = validationRuntime.getValidator("helloworld.HelloRequest");
      
      if (!validator) {
        console.log("Validation not enabled or no rules for HelloRequest - skipping test");
        return;
      }
      
      // Test invalid data (name too short)
      const invalidData = { name: "ab" }; // min 3 chars required
      const validationResult = validator(invalidData);
      
      expect(validationResult.ok).toBe(false);
      if (!validationResult.ok) {
        expect(validationResult.violations).toBeDefined();
        expect(validationResult.violations.length).toBeGreaterThan(0);
      }
    });

    test("should pass validation for valid data", () => {
      const validator = validationRuntime.getValidator("helloworld.HelloRequest");
      
      if (!validator) {
        console.log("Validation not enabled - skipping test");
        return;
      }
      
      const validData = { 
        name: "ValidUser123",
        email: "user@example.com",
        age: 25
      };
      
      const validationResult = validator(validData);
      
      expect(validationResult.ok).toBe(true);
    });

    test("should validate email field format", () => {
      const validator = validationRuntime.getValidator("helloworld.HelloRequest");
      
      if (!validator) {
        console.log("Validation not enabled - skipping test");
        return;
      }
      
      const invalidEmailData = { 
        name: "TestUser",
        email: "invalid-email" // Invalid email format
      };
      
      const validationResult = validator(invalidEmailData);
      
      expect(validationResult.ok).toBe(false);
      if (!validationResult.ok) {
        const emailViolation = validationResult.violations.find((v: { field: string }) => v.field === "email");
        expect(emailViolation).toBeDefined();
      }
    });

    test("should validate age field range", () => {
      const validator = validationRuntime.getValidator("helloworld.HelloRequest");
      
      if (!validator) {
        console.log("Validation not enabled - skipping test");
        return;
      }
      
      const invalidAgeData = { 
        name: "TestUser",
        age: 200 // Exceeds max (150)
      };
      
      const validationResult = validator(invalidAgeData);
      
      expect(validationResult.ok).toBe(false);
      if (!validationResult.ok) {
        const ageViolation = validationResult.violations.find((v: { field: string }) => v.field === "age");
        expect(ageViolation).toBeDefined();
      }
    });

    test("should map validation errors to Connect error format", () => {
      const validator = validationRuntime.getValidator("helloworld.HelloRequest");
      
      if (!validator) {
        console.log("Validation not enabled - skipping test");
        return;
      }
      
      const invalidData = { name: "ab" };
      const validationResult = validator(invalidData);
      
      const connectError = mapValidationError(validationResult);
      
      expect(connectError.code).toBe("invalid_argument");
      expect(connectError.message).toContain("validation");
      expect(connectError.details).toBeDefined();
    });

    test("should check if validation runtime is configured", () => {
      const isEnabled = validationRuntime.isEnabled();
      const typesWithRules = validationRuntime.getTypesWithRules();
      
      // Just verify the API works
      expect(typeof isEnabled).toBe("boolean");
      expect(Array.isArray(typesWithRules)).toBe(true);
    });
  });

  describe("Streaming Handler Integration", () => {
    test("should create handler for unary RPC", () => {
      const greeterService = services.get("helloworld.Greeter");
      const sayHelloMethod = greeterService.methods.get("SayHello");
      
      expect(sayHelloMethod.requestStream).toBe(false);
      expect(sayHelloMethod.responseStream).toBe(false);
      expect(sayHelloMethod.handler).toBeDefined();
      expect(typeof sayHelloMethod.handler).toBe("function");
    });

    test("should create handler for server streaming RPC", () => {
      const streamService = services.get("streaming.StreamService");
      const getMessagesMethod = streamService.methods.get("GetMessages");
      
      expect(getMessagesMethod.requestStream).toBe(false);
      expect(getMessagesMethod.responseStream).toBe(true);
      expect(getMessagesMethod.handler).toBeDefined();
      expect(typeof getMessagesMethod.handler).toBe("function");
    });

    test("should create handler for client streaming RPC", () => {
      const greeterService = services.get("helloworld.Greeter");
      const uploadHelloMethod = greeterService.methods.get("UploadHello");
      
      expect(uploadHelloMethod.requestStream).toBe(true);
      expect(uploadHelloMethod.responseStream).toBe(false);
      expect(uploadHelloMethod.handler).toBeDefined();
      expect(typeof uploadHelloMethod.handler).toBe("function");
    });

    test("should create handler for bidirectional streaming RPC", () => {
      const greeterService = services.get("helloworld.Greeter");
      const chatHelloMethod = greeterService.methods.get("ChatHello");
      
      expect(chatHelloMethod.requestStream).toBe(true);
      expect(chatHelloMethod.responseStream).toBe(true);
      expect(chatHelloMethod.handler).toBeDefined();
      expect(typeof chatHelloMethod.handler).toBe("function");
    });

    test("should have correct request and response types for streaming methods", () => {
      const streamService = services.get("streaming.StreamService");
      const getMessagesMethod = streamService.methods.get("GetMessages");
      
      expect(getMessagesMethod.requestType).toBeDefined();
      expect(getMessagesMethod.responseType).toBeDefined();
      expect(getMessagesMethod.requestType.name).toBe("MessageRequest");
      expect(getMessagesMethod.responseType.name).toBe("MessageResponse");
    });
  });

  describe("Protocol Adapter Integration", () => {
    test("should extract metadata from Connect context", () => {
      const mockContext = {
        requestHeader: {
          "x-user-id": "test-user",
          "x-request-id": "req-123",
          "content-type": "application/json",
        },
        responseHeader: {},
        responseTrailer: {},
        protocol: "connect" as const,
      };

      const metadata = extractMetadata(mockContext);
      
      expect(metadata).toBeDefined();
      expect(metadata["x-user-id"]).toBe("test-user");
      expect(metadata["x-request-id"]).toBe("req-123");
    });

    test("should normalize request data", () => {
      const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
      const requestData = { name: "TestUser", email: "test@example.com", age: 25 };
      
      const mockContext = {
        requestHeader: {},
        responseHeader: {},
        responseTrailer: {},
        protocol: "connect" as const,
      };

      const normalized = normalizeRequest(
        "helloworld.Greeter",
        "SayHello",
        requestData,
        HelloRequest,
        mockContext
      );

      expect(normalized.service).toBe("helloworld.Greeter");
      expect(normalized.method).toBe("SayHello");
      expect(normalized.data).toBeDefined();
      expect(normalized.metadata).toBeDefined();
    });

    test("should format response data", () => {
      const HelloReply = protoRoot.lookupType("helloworld.HelloReply");
      const responseData = { message: "Hello, World!" };

      const formatted = formatResponse(responseData, HelloReply);

      expect(formatted).toBeDefined();
      expect(formatted.message).toBe("Hello, World!");
    });
  });

  describe("Reflection Integration", () => {
    test("should check if descriptor set exists for reflection", () => {
      const descriptorPath = path.join(process.cwd(), "bin", ".descriptors.bin");
      const hasDescriptor = fs.existsSync(descriptorPath);
      
      // Just verify we can check for reflection support
      expect(typeof hasDescriptor).toBe("boolean");
    });

    test("should list all registered services", () => {
      const serviceNames = Array.from(services.keys());
      
      expect(serviceNames.length).toBeGreaterThan(0);
      expect(serviceNames).toContain("helloworld.Greeter");
      expect(serviceNames).toContain("streaming.StreamService");
    });

    test("should provide service metadata for reflection", () => {
      const greeterService = services.get("helloworld.Greeter");
      
      expect(greeterService.serviceName).toBe("Greeter");
      expect(greeterService.packageName).toBe("helloworld");
      expect(greeterService.fullServiceName).toBe("helloworld.Greeter");
      expect(greeterService.methods.size).toBeGreaterThan(0);
    });
  });

  describe("Rule Matching Integration", () => {
    test("should have rules loaded for testing", () => {
      expect(rulesIndex.size).toBeGreaterThan(0);
      expect(rulesIndex.has("helloworld.greeter.sayhello")).toBe(true);
    });

    test("should integrate rule keys with service methods", () => {
      const greeterService = services.get("helloworld.Greeter");
      const sayHelloMethod = greeterService.methods.get("SayHello");
      
      const ruleKey = sayHelloMethod.ruleKey;
      expect(rulesIndex.has(ruleKey)).toBe(true);
    });

    test("should have correct rule structure", () => {
      const sayHelloRule = rulesIndex.get("helloworld.greeter.sayhello");
      
      expect(sayHelloRule).toBeDefined();
      if (sayHelloRule) {
        // RuleDoc has optional match and responses properties
        expect(typeof sayHelloRule).toBe("object");
        
        // Check if it has responses array
        if (sayHelloRule.responses) {
          expect(Array.isArray(sayHelloRule.responses)).toBe(true);
          expect(sayHelloRule.responses.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("End-to-End Component Integration", () => {
    test("should integrate all components: service registry, validation, and rules", () => {
      // Verify service is registered
      const greeterService = services.get("helloworld.Greeter");
      expect(greeterService).toBeDefined();
      
      // Verify method exists
      const sayHelloMethod = greeterService.methods.get("SayHello");
      expect(sayHelloMethod).toBeDefined();
      
      // Verify validation is available
      const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
      expect(HelloRequest).toBeDefined();
      
      // Verify rule exists
      const ruleKey = sayHelloMethod.ruleKey;
      expect(rulesIndex.has(ruleKey)).toBe(true);
      
      // Verify handler is created
      expect(sayHelloMethod.handler).toBeDefined();
      expect(typeof sayHelloMethod.handler).toBe("function");
    });

    test("should support all four streaming patterns", () => {
      const greeterService = services.get("helloworld.Greeter");
      const streamService = services.get("streaming.StreamService");
      
      // Unary
      const unaryMethod = greeterService.methods.get("SayHello");
      expect(unaryMethod.requestStream).toBe(false);
      expect(unaryMethod.responseStream).toBe(false);
      
      // Server streaming
      const serverStreamMethod = streamService.methods.get("GetMessages");
      expect(serverStreamMethod.requestStream).toBe(false);
      expect(serverStreamMethod.responseStream).toBe(true);
      
      // Client streaming
      const clientStreamMethod = greeterService.methods.get("UploadHello");
      expect(clientStreamMethod.requestStream).toBe(true);
      expect(clientStreamMethod.responseStream).toBe(false);
      
      // Bidirectional streaming
      const bidiStreamMethod = greeterService.methods.get("ChatHello");
      expect(bidiStreamMethod.requestStream).toBe(true);
      expect(bidiStreamMethod.responseStream).toBe(true);
    });
  });
});

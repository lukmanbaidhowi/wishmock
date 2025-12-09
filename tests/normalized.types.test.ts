import { describe, it, expect } from "bun:test";
import {
  type NormalizedRequest,
  type NormalizedResponse,
  type NormalizedError,
  isNormalizedError,
} from "../src/domain/types/normalized.js";
import protobuf from "protobufjs";

describe("Normalized Types", () => {
  // Create mock protobuf types for testing
  const mockRequestType = new protobuf.Type("TestRequest");
  const mockResponseType = new protobuf.Type("TestResponse");

  describe("NormalizedRequest", () => {
    it("should create a valid unary request", () => {
      const request: NormalizedRequest = {
        service: "test.TestService",
        method: "TestMethod",
        metadata: { "x-test": "value" },
        data: { name: "test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: false,
      };

      expect(request.service).toBe("test.TestService");
      expect(request.method).toBe("TestMethod");
      expect(request.metadata["x-test"]).toBe("value");
      expect(request.requestStream).toBe(false);
      expect(request.responseStream).toBe(false);
    });

    it("should create a valid server streaming request", () => {
      const request: NormalizedRequest = {
        service: "test.TestService",
        method: "StreamMethod",
        metadata: {},
        data: { query: "test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: false,
        responseStream: true,
      };

      expect(request.responseStream).toBe(true);
      expect(request.requestStream).toBe(false);
    });

    it("should create a valid client streaming request", () => {
      const request: NormalizedRequest = {
        service: "test.TestService",
        method: "ClientStreamMethod",
        metadata: {},
        data: { item: "test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: false,
      };

      expect(request.requestStream).toBe(true);
      expect(request.responseStream).toBe(false);
    });

    it("should create a valid bidirectional streaming request", () => {
      const request: NormalizedRequest = {
        service: "test.TestService",
        method: "BidiStreamMethod",
        metadata: {},
        data: { message: "test" },
        requestType: mockRequestType,
        responseType: mockResponseType,
        requestStream: true,
        responseStream: true,
      };

      expect(request.requestStream).toBe(true);
      expect(request.responseStream).toBe(true);
    });
  });

  describe("NormalizedResponse", () => {
    it("should create a valid response without metadata", () => {
      const response: NormalizedResponse = {
        data: { result: "success" },
      };

      expect(response.data.result).toBe("success");
      expect(response.metadata).toBeUndefined();
      expect(response.trailer).toBeUndefined();
    });

    it("should create a valid response with metadata", () => {
      const response: NormalizedResponse = {
        data: { result: "success" },
        metadata: { "x-response-id": "123" },
      };

      expect(response.metadata?.["x-response-id"]).toBe("123");
    });

    it("should create a valid response with trailer", () => {
      const response: NormalizedResponse = {
        data: { result: "success" },
        trailer: { "x-status": "complete" },
      };

      expect(response.trailer?.["x-status"]).toBe("complete");
    });

    it("should create a valid response with both metadata and trailer", () => {
      const response: NormalizedResponse = {
        data: { result: "success" },
        metadata: { "x-request-id": "456" },
        trailer: { "x-status": "complete" },
      };

      expect(response.metadata?.["x-request-id"]).toBe("456");
      expect(response.trailer?.["x-status"]).toBe("complete");
    });
  });

  describe("NormalizedError", () => {
    it("should create a valid error with code and message", () => {
      const error: NormalizedError = {
        code: "INVALID_ARGUMENT",
        message: "Invalid request data",
      };

      expect(error.code).toBe("INVALID_ARGUMENT");
      expect(error.message).toBe("Invalid request data");
      expect(error.details).toBeUndefined();
    });

    it("should create a valid error with details", () => {
      const error: NormalizedError = {
        code: "INVALID_ARGUMENT",
        message: "Validation failed",
        details: [
          { field: "name", constraint: "required" },
          { field: "email", constraint: "format" },
        ],
      };

      expect(error.details).toHaveLength(2);
      expect(error.details?.[0].field).toBe("name");
    });

    it("should support all standard gRPC status codes", () => {
      const codes = [
        "OK",
        "CANCELLED",
        "UNKNOWN",
        "INVALID_ARGUMENT",
        "DEADLINE_EXCEEDED",
        "NOT_FOUND",
        "ALREADY_EXISTS",
        "PERMISSION_DENIED",
        "RESOURCE_EXHAUSTED",
        "FAILED_PRECONDITION",
        "ABORTED",
        "OUT_OF_RANGE",
        "UNIMPLEMENTED",
        "INTERNAL",
        "UNAVAILABLE",
        "DATA_LOSS",
        "UNAUTHENTICATED",
      ];

      codes.forEach((code) => {
        const error: NormalizedError = {
          code,
          message: `Test error for ${code}`,
        };
        expect(error.code).toBe(code);
      });
    });
  });

  describe("isNormalizedError", () => {
    it("should return true for NormalizedError", () => {
      const error: NormalizedError = {
        code: "NOT_FOUND",
        message: "Resource not found",
      };

      expect(isNormalizedError(error)).toBe(true);
    });

    it("should return false for NormalizedResponse", () => {
      const response: NormalizedResponse = {
        data: { result: "success" },
      };

      expect(isNormalizedError(response)).toBe(false);
    });

    it("should correctly distinguish between response and error", () => {
      const response: NormalizedResponse = {
        data: { value: 42 },
      };

      const error: NormalizedError = {
        code: "INTERNAL",
        message: "Internal error",
      };

      expect(isNormalizedError(response)).toBe(false);
      expect(isNormalizedError(error)).toBe(true);
    });
  });
});

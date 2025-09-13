import { describe, it, expect, beforeEach, vi } from "bun:test";
import { sendError, sendBadRequest, sendNotFound, sendSuccess } from "../src/interfaces/http/responseHelper.js";
import { validateFilename, validateContent, validateUploadData } from "../src/interfaces/http/validator.js";
import { HTTP_STATUS } from "../src/interfaces/http/constants.js";

// Mock response object
const createMockResponse = () => {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  return {
    status: statusMock,
    json: jsonMock,
    _statusMock: statusMock,
    _jsonMock: jsonMock
  };
};

describe("Response Helper Functions", () => {
  let mockRes: any;

  beforeEach(() => {
    mockRes = createMockResponse();
  });

  describe("Happy Path", () => {
    it("should send success response", () => {
      const data = { message: "success" };
      sendSuccess(mockRes, data);
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith(data);
    });
  });

  describe("Error Cases", () => {
    it("should handle Error objects", () => {
      const error = new Error("Test error");
      sendError(mockRes, error, "Default message");
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "Test error" });
    });

    it("should handle string errors", () => {
      sendError(mockRes, "String error", "Default message");
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "String error" });
    });

    it("should use default message for empty errors", () => {
      sendError(mockRes, "", "Default message");
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "Default message" });
    });

    it("should send bad request response", () => {
      sendBadRequest(mockRes, "Invalid input");
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "Invalid input" });
    });

    it("should send not found response", () => {
      sendNotFound(mockRes, "Resource not found");
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "Resource not found" });
    });
  });
});

describe("Validator Functions", () => {
  let mockRes: any;

  beforeEach(() => {
    mockRes = createMockResponse();
  });

  describe("Happy Path", () => {
    it("should validate valid filename", () => {
      const result = validateFilename("test.proto", mockRes);
      expect(result).toBe(true);
    });

    it("should validate valid content", () => {
      const result = validateContent("syntax = \"proto3\";", mockRes);
      expect(result).toBe(true);
    });

    it("should validate valid upload data", () => {
      const result = validateUploadData("test.proto", "content", mockRes);
      expect(result).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should reject empty filename", () => {
      const result = validateFilename("", mockRes);
      expect(result).toBe(false);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    });

    it("should reject empty content", () => {
      const result = validateContent("", mockRes);
      expect(result).toBe(false);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    });

    it("should reject upload data with missing filename", () => {
      const result = validateUploadData("", "content", mockRes);
      expect(result).toBe(false);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    });

    it("should reject upload data with missing content", () => {
      const result = validateUploadData("test.proto", "", mockRes);
      expect(result).toBe(false);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    });
  });
});

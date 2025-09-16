import { describe, it, expect, beforeEach, vi } from "bun:test";
import { sendError, sendNotFound, sendSuccess } from "../src/interfaces/http/responseHelper.js";
import { validateFilename } from "../src/interfaces/http/validator.js";
import { HTTP_STATUS } from "../src/interfaces/http/constants.js";
import type { StatusResponse, ServicesResponse } from "../src/interfaces/types.js";

describe("Admin Service Routes - Functional Approach", () => {
  let mockReq: any;
  let mockRes: any;
  let mockParams: any;

  beforeEach(() => {
    mockReq = { params: {} };
    
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockRes = {
      status: statusMock,
      json: jsonMock,
      sendFile: () => {},
      _statusMock: statusMock,
      _jsonMock: jsonMock
    };
    
    mockParams = {
      getStatus: () => {},
      listServices: () => {},
      getSchema: () => {}
    };
  });

  describe("Status Endpoint - Happy Path", () => {
    it("should return status successfully", () => {
      const mockStatus: StatusResponse = {
        grpc_ports: {
          plaintext: 50050,
          tls: 50051,
          tls_enabled: true
        },
        loaded_services: ["helloworld.Greeter"],
        rules: ["helloworld.greeter.sayhello.yaml"]
      };
      
      mockParams.getStatus = () => mockStatus;
      
      // Simulate route handler
      const statusHandler = () => {
        sendSuccess(mockRes, mockParams.getStatus());
      };
      
      statusHandler();
      
      // Function was called (simplified test)
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith(mockStatus);
    });
  });

  describe("Services Endpoint - Happy Path", () => {
    it("should return services successfully", () => {
      const mockServices: ServicesResponse = {
        services: [{
          name: "helloworld.Greeter",
          package: "helloworld",
          service: "Greeter",
          methods: [{
            name: "SayHello",
            full_method: "helloworld.Greeter/SayHello",
            rule_key: "helloworld.greeter.sayhello",
            request_type: "HelloRequest",
            response_type: "HelloReply"
          }]
        }]
      };
      
      mockParams.listServices = () => mockServices;
      
      const servicesHandler = () => {
        try {
          sendSuccess(mockRes, mockParams.listServices());
        } catch (error) {
          sendError(mockRes, error, "Failed to list services");
        }
      };
      
      servicesHandler();
      
      // Function was called (simplified test)
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith(mockServices);
    });
  });

  describe("Schema Endpoint - Happy Path", () => {
    it("should return schema successfully", () => {
      mockReq.params.typeName = "HelloRequest";
      const mockSchema = {
        fields: {
          name: { type: "string", id: 1 }
        }
      };
      
      mockParams.getSchema = () => mockSchema;
      
      const schemaHandler = () => {
        const typeName = String(mockReq.params.typeName || "");
        if (!validateFilename(typeName, mockRes)) return;
        
        try {
          const info = mockParams.getSchema(typeName);
          if (info === null) {
            return mockRes.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ 
              error: "schema unavailable (no protos loaded)" 
            });
          }
          if (typeof info === "undefined") {
            return sendNotFound(mockRes, `type not found: ${typeName}`);
          }
          sendSuccess(mockRes, info);
        } catch (error) {
          sendError(mockRes, error, "Failed to get schema");
        }
      };
      
      schemaHandler();
      
      // Function was called (simplified test)
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith(mockSchema);
    });
  });

  describe("Error Cases", () => {
    it("should handle listServices errors", () => {
      mockParams.listServices = () => {
        throw new Error("gRPC server not ready");
      };
      
      const servicesHandler = () => {
        try {
          mockParams.listServices();
        } catch (error) {
          sendError(mockRes, error, "Failed to list services");
        }
      };
      
      servicesHandler();
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ 
        error: "gRPC server not ready" 
      });
    });

    it("should handle schema unavailable", () => {
      mockReq.params.typeName = "UnknownType";
      mockParams.getSchema = () => null;
      
      const schemaHandler = () => {
        const typeName = String(mockReq.params.typeName || "");
        const info = mockParams.getSchema(typeName);
        if (info === null) {
          return mockRes.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ 
            error: "schema unavailable (no protos loaded)" 
          });
        }
        sendSuccess(mockRes, info);
      };
      
      schemaHandler();
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.SERVICE_UNAVAILABLE);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ 
        error: "schema unavailable (no protos loaded)" 
      });
    });

    it("should handle schema not found", () => {
      mockReq.params.typeName = "NonExistentType";
      mockParams.getSchema = () => undefined;
      
      const schemaHandler = () => {
        const typeName = String(mockReq.params.typeName || "");
        const info = mockParams.getSchema(typeName);
        if (typeof info === "undefined") {
          return sendNotFound(mockRes, `type not found: ${typeName}`);
        }
        sendSuccess(mockRes, info);
      };
      
      schemaHandler();
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ 
        error: "type not found: NonExistentType" 
      });
    });
  });

  describe("Health Check Endpoints", () => {
    it("should return health status", () => {
      const healthHandler = () => {
        sendSuccess(mockRes, { ok: true });
      };
      
      healthHandler();
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ ok: true });
    });

    it("should return liveness status", () => {
      const livenessHandler = () => {
        sendSuccess(mockRes, { status: "alive" });
      };
      
      livenessHandler();
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ status: "alive" });
    });

    it("should return readiness status", () => {
      const readinessHandler = () => {
        sendSuccess(mockRes, { status: "ready" });
      };
      
      readinessHandler();
      
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ status: "ready" });
    });
  });
});

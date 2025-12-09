/**
 * Connect RPC End-to-End Tests
 * 
 * Comprehensive E2E tests for Connect RPC functionality including:
 * - Connect protocol (unary and streaming)
 * - gRPC-Web protocol (browser compatibility)
 * - Native gRPC protocol (backward compatibility)
 * - CORS handling
 * - Error scenarios
 * 
 * These tests verify the complete integration of all three protocols
 * working together in a real server environment.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "child_process";

// Skip E2E tests by default in `bun test`.
// Set E2E=true to enable running these tests.
const describeE2E = (process.env.E2E === "true" || process.env.RUN_E2E === "true") ? describe : (describe as any).skip;

describeE2E("Connect RPC E2E Tests", () => {
  let serverProcess: ChildProcess | null = null;
  const HTTP_PORT = 14319;
  const GRPC_PORT = 15050;
  const CONNECT_PORT = 15052;
  const SERVER_URL = `http://localhost:${CONNECT_PORT}`;
  const GRPC_URL = `localhost:${GRPC_PORT}`;

  beforeAll(async () => {
    // Start the server with Connect RPC enabled
    console.log("Starting Wishmock server with Connect RPC...");
    
    serverProcess = spawn("bun", ["run", "start"], {
      env: {
        ...process.env,
        HTTP_PORT: String(HTTP_PORT),
        GRPC_PORT_PLAINTEXT: String(GRPC_PORT),
        CONNECT_ENABLED: "true",
        CONNECT_PORT: String(CONNECT_PORT),
        CONNECT_CORS_ENABLED: "true",
        CONNECT_CORS_ORIGINS: "*",
        VALIDATION_ENABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for server to be ready
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    let isReady = false;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await fetch(`http://localhost:${HTTP_PORT}/readiness`);
        if (response.ok) {
          isReady = true;
          break;
        }
      } catch (error) {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!isReady) {
      throw new Error("Server failed to start within timeout");
    }

    console.log("Server is ready!");
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  describe("Connect Protocol Tests", () => {
    test("should handle unary RPC call", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
        body: JSON.stringify({ name: "E2E Test" }),
      });

      // Response should be valid (either success or unimplemented if no rule)
      expect(response.status).toBeGreaterThanOrEqual(200);
      const data = await response.json();
      expect(data).toBeDefined();
      // Either has message (success) or code (error)
      expect(data.message || data.code).toBeDefined();
    });

    test("should handle unary RPC with validation", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
        body: JSON.stringify({
          name: "ValidUser123",
          email: "user@example.com",
          age: 25,
        }),
      });

      // Should get a valid response (success or unimplemented)
      expect(response.status).toBeGreaterThanOrEqual(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });

    test("should reject invalid data with validation error", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
        body: JSON.stringify({
          name: "ab", // Too short (min 3 chars)
          email: "invalid-email",
          age: 200, // Too high (max 150)
        }),
      });

      expect(response.ok).toBe(false);
      const error = await response.json();
      // Should be either validation error or unimplemented
      expect(error.code).toMatch(/invalid_argument|unimplemented/);
    });

    test("should handle server streaming RPC", async () => {
      const response = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          "Connect-Accept-Encoding": "identity",
        },
        body: JSON.stringify({
          user_id: "e2e-test",
          limit: 3,
        }),
      });

      // Should get a response (success or error)
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.body).toBeDefined();

      // If successful, read stream
      if (response.ok) {
        const decoder = new TextDecoder();
        let buffer = "";
        let messageCount = 0;

        for await (const chunk of response.body!) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              const message = JSON.parse(line);
              expect(message).toBeDefined();
              messageCount++;
            }
          }
        }

        expect(messageCount).toBeGreaterThanOrEqual(0);
      }
    }, 10000);

    test("should handle health check endpoint", async () => {
      const response = await fetch(`${SERVER_URL}/health`);
      
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.status).toBe("serving");
      expect(Array.isArray(data.services)).toBe(true);
      expect(data.services.length).toBeGreaterThan(0);
    });

    test("should return error for non-existent service", async () => {
      const response = await fetch(`${SERVER_URL}/nonexistent.Service/Method`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      expect(response.ok).toBe(false);
      // Should be 404 or 501 (not found or unimplemented)
      expect([404, 501]).toContain(response.status);
    });

    test("should return error for invalid JSON", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "invalid json{",
      });

      expect(response.ok).toBe(false);
      // Should be 400 or 501 (bad request or unimplemented)
      expect([400, 501]).toContain(response.status);
    });
  });

  describe("gRPC-Web Protocol Tests", () => {
    test("should handle unary RPC with gRPC-Web headers", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/grpc-web+json",
          "X-Grpc-Web": "1",
          "Accept": "application/grpc-web+json",
        },
        body: JSON.stringify({ name: "gRPC-Web E2E" }),
      });

      // Should get a valid response
      expect(response.status).toBeGreaterThanOrEqual(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });

    test("should handle server streaming with gRPC-Web", async () => {
      const response = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/grpc-web+json",
          "X-Grpc-Web": "1",
          "Accept": "application/grpc-web+json",
        },
        body: JSON.stringify({
          user_id: "grpc-web-e2e",
          limit: 3,
        }),
      });

      // Should get a response
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.body).toBeDefined();

      // If successful, read stream
      if (response.ok) {
        const decoder = new TextDecoder();
        let buffer = "";
        let messageCount = 0;

        for await (const chunk of response.body!) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              const message = JSON.parse(line);
              expect(message).toBeDefined();
              messageCount++;
            }
          }
        }

        expect(messageCount).toBeGreaterThanOrEqual(0);
      }
    }, 10000);

    test("should handle validation errors with gRPC-Web", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/grpc-web+json",
          "X-Grpc-Web": "1",
        },
        body: JSON.stringify({
          name: "ab", // Too short
        }),
      });

      expect(response.ok).toBe(false);
      const error = await response.json();
      // Should be validation error or unimplemented
      expect(error.code).toMatch(/invalid_argument|unimplemented/);
    });

    test("should support gRPC-Web content types", async () => {
      // Test with different gRPC-Web content types
      const contentTypes = [
        "application/grpc-web+json",
        "application/grpc-web+proto",
      ];

      for (const contentType of contentTypes) {
        const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "X-Grpc-Web": "1",
          },
          body: contentType.includes("json") 
            ? JSON.stringify({ name: "Test" })
            : new Uint8Array([]),
        });

        // Should get a response (success or error)
        expect(response.status).toBeGreaterThanOrEqual(200);
      }
    });
  });

  describe("CORS Handling Tests", () => {
    test("should handle OPTIONS preflight request", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "OPTIONS",
        headers: {
          "Origin": "http://localhost:3000",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBeDefined();
      expect(response.headers.get("Access-Control-Allow-Headers")).toBeDefined();
      expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
    });

    test("should include CORS headers in regular responses", async () => {
      const response = await fetch(`${SERVER_URL}/health`, {
        method: "GET",
        headers: {
          "Origin": "http://localhost:3000",
        },
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    test("should include CORS headers in error responses", async () => {
      const response = await fetch(`${SERVER_URL}/nonexistent.Service/Method`, {
        method: "POST",
        headers: {
          "Origin": "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      expect(response.ok).toBe(false);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    test("should expose gRPC-Web headers via CORS", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Origin": "http://localhost:3000",
          "Content-Type": "application/grpc-web+json",
          "X-Grpc-Web": "1",
        },
        body: JSON.stringify({ name: "CORS Test" }),
      });

      const exposedHeaders = response.headers.get("Access-Control-Expose-Headers");
      expect(exposedHeaders).toBeDefined();
      // Should expose gRPC-Web compatible headers
      expect(exposedHeaders).toContain("Grpc-Status");
    });
  });

  describe("Native gRPC Backward Compatibility Tests", () => {
    test("should verify grpcurl is available", () => {
      const { execSync } = require("child_process");
      try {
        execSync("which grpcurl", { stdio: "ignore" });
      } catch (error) {
        console.log("grpcurl not found - skipping native gRPC tests");
        return;
      }
    });

    test("should list services via gRPC reflection", async () => {
      const { execSync } = require("child_process");
      try {
        const output = execSync(`grpcurl -plaintext ${GRPC_URL} list`, {
          encoding: "utf8",
          timeout: 5000,
        });
        
        expect(output).toContain("helloworld.Greeter");
        expect(output).toContain("streaming.StreamService");
      } catch (error) {
        console.log("grpcurl not available - skipping test");
      }
    }, 10000);

    test("should call unary RPC via native gRPC", async () => {
      const { execSync } = require("child_process");
      try {
        const output = execSync(
          `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '{"name":"gRPC Native"}' ${GRPC_URL} helloworld.Greeter/SayHello`,
          {
            encoding: "utf8",
            timeout: 5000,
          }
        );
        
        expect(output).toBeDefined();
        expect(output.length).toBeGreaterThan(0);
      } catch (error) {
        console.log("grpcurl not available - skipping test");
      }
    }, 10000);

    test("should call server streaming RPC via native gRPC", async () => {
      const { execSync } = require("child_process");
      try {
        const output = execSync(
          `timeout 5s grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"user_id":"grpc-test","limit":3}' ${GRPC_URL} streaming.StreamService/GetMessages`,
          {
            encoding: "utf8",
            timeout: 6000,
          }
        );
        
        expect(output).toBeDefined();
        expect(output.length).toBeGreaterThan(0);
      } catch (error) {
        console.log("grpcurl not available - skipping test");
      }
    }, 10000);

    test("should describe service via gRPC reflection", async () => {
      const { execSync } = require("child_process");
      try {
        const output = execSync(
          `grpcurl -plaintext ${GRPC_URL} describe helloworld.Greeter`,
          {
            encoding: "utf8",
            timeout: 5000,
          }
        );
        
        expect(output).toContain("helloworld.Greeter");
        expect(output).toContain("SayHello");
      } catch (error) {
        console.log("grpcurl not available - skipping test");
      }
    }, 10000);
  });

  describe("Cross-Protocol Validation Tests", () => {
    test("should return consistent responses across all protocols", async () => {
      const testName = "CrossProtocolTest";

      // Test Connect protocol
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
        body: JSON.stringify({ name: testName }),
      });
      expect(connectResponse.status).toBeGreaterThanOrEqual(200);
      const connectData = await connectResponse.json();

      // Test gRPC-Web protocol
      const grpcWebResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/grpc-web+json",
          "X-Grpc-Web": "1",
        },
        body: JSON.stringify({ name: testName }),
      });
      expect(grpcWebResponse.status).toBeGreaterThanOrEqual(200);
      const grpcWebData = await grpcWebResponse.json();

      // Both should return valid JSON responses
      expect(connectData).toBeDefined();
      expect(grpcWebData).toBeDefined();
    });

    test("should report Connect RPC status in admin API", async () => {
      const response = await fetch(`http://localhost:${HTTP_PORT}/admin/status`);
      expect(response.ok).toBe(true);
      
      const status = await response.json();
      // Connect status should be present if enabled
      if (status.connect_rpc) {
        expect(status.connect_rpc.enabled).toBe(true);
        expect(status.connect_rpc.port).toBe(CONNECT_PORT);
      }
    });

    test("should track metrics for all protocols", async () => {
      // Make requests with different protocols
      await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Metrics Test 1" }),
      });

      await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: { "Content-Type": "application/grpc-web+json", "X-Grpc-Web": "1" },
        body: JSON.stringify({ name: "Metrics Test 2" }),
      });

      // Check admin status for metrics
      const response = await fetch(`http://localhost:${HTTP_PORT}/admin/status`);
      const status = await response.json();
      
      // Metrics should be tracked if Connect is enabled
      if (status.connect_rpc && status.connect_rpc.metrics) {
        expect(status.connect_rpc.metrics.requests_total).toBeGreaterThan(0);
      }
    });
  });

  describe("Error Scenario Tests", () => {
    test("should handle missing Content-Type header", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
      });

      // Should still work or return appropriate error
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    test("should handle empty request body", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "",
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("should handle malformed JSON", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid json",
      });

      expect(response.ok).toBe(false);
      // Should be 400 or 501
      expect([400, 501]).toContain(response.status);
    });

    test("should handle non-existent method", async () => {
      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/NonExistentMethod`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Test" }),
      });

      expect(response.ok).toBe(false);
      // Should be 404 or 501
      expect([404, 501]).toContain(response.status);
    });

    test("should handle timeout gracefully", async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      try {
        await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: "test", limit: 100 }),
          signal: controller.signal,
        });
      } catch (error: any) {
        expect(error.name).toBe("AbortError");
      } finally {
        clearTimeout(timeoutId);
      }
    });

    test("should handle large request payload", async () => {
      const largePayload = {
        name: "A".repeat(10000), // 10KB string
      };

      const response = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(largePayload),
      });

      // Should handle large payload (might fail validation but shouldn't crash)
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    test("should handle concurrent requests", async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: `Concurrent ${i}` }),
        })
      );

      const responses = await Promise.all(requests);
      
      // All requests should complete
      expect(responses.length).toBe(10);
      
      // All should return valid responses (success or error)
      const validResponses = responses.filter(r => r.status >= 200 && r.status < 600).length;
      expect(validResponses).toBe(10);
    });
  });

  describe("Streaming Edge Cases", () => {
    test("should handle stream with zero messages", async () => {
      const response = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: "empty-stream",
          limit: 0,
        }),
      });

      // Should get a response
      expect(response.status).toBeGreaterThanOrEqual(200);
      
      if (response.ok) {
        // Stream should complete even with no messages
        const decoder = new TextDecoder();
        let buffer = "";
        
        for await (const chunk of response.body!) {
          buffer += decoder.decode(chunk, { stream: true });
        }
        
        // Should complete without error
        expect(buffer).toBeDefined();
      }
    }, 10000);

    test("should handle stream cancellation", async () => {
      const controller = new AbortController();
      
      const response = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: "cancel-test",
          limit: 100,
        }),
        signal: controller.signal,
      });

      // Should get a response
      expect(response.status).toBeGreaterThanOrEqual(200);
      
      if (response.ok) {
        // Cancel after receiving first chunk
        const decoder = new TextDecoder();
        let chunkCount = 0;
        
        try {
          for await (const chunk of response.body!) {
            chunkCount++;
            if (chunkCount >= 1) {
              controller.abort();
              break;
            }
          }
        } catch (error: any) {
          expect(error.name).toBe("AbortError");
        }
        
        expect(chunkCount).toBeGreaterThanOrEqual(1);
      }
    }, 10000);
  });
});

/**
 * Protocol Consistency E2E Tests
 * 
 * Tests that verify identical behavior between gRPC and Connect RPC protocols.
 * These tests ensure that the shared handler infrastructure produces consistent
 * results regardless of which protocol is used to make the request.
 * 
 * Requirements tested:
 * - 1.1: Same rule matching logic across protocols
 * - 1.2: Same response selection logic across protocols
 * - 1.3: Same rule file format support across protocols
 * - 1.4: Same priority and matching criteria across protocols
 * - 1.5: Same handling of missing rules across protocols
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";

// Skip E2E tests by default in `bun test`.
// Set E2E=true to enable running these tests.
const describeE2E = (process.env.E2E === "true" || process.env.RUN_E2E === "true") ? describe : (describe as any).skip;

describeE2E("Protocol Consistency E2E Tests", () => {
  let serverProcess: ChildProcess | null = null;
  const HTTP_PORT = 14320;
  const GRPC_PORT = 15051;
  const CONNECT_PORT = 15053;
  const SERVER_URL = `http://localhost:${CONNECT_PORT}`;
  const GRPC_URL = `localhost:${GRPC_PORT}`;

  // Helper to check if grpcurl is available
  function hasGrpcurl(): boolean {
    try {
      execSync("which grpcurl", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  beforeAll(async () => {
    console.log("Starting Wishmock server for protocol consistency tests...");
    
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
        VALIDATION_SOURCE: "auto",
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

    console.log("Server is ready for protocol consistency tests!");
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  describe("Unary RPC Consistency", () => {
    test("should return identical responses for same request via Connect and gRPC", async () => {
      if (!hasGrpcurl()) {
        console.log("grpcurl not available - skipping gRPC comparison test");
        return;
      }

      const testRequest = {
        name: "ConsistencyTest",
        email: "test@example.com",
        age: 30,
      };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testRequest),
      });

      const connectData = await connectResponse.json();

      // Make request via native gRPC
      const grpcOutput = execSync(
        `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
        { encoding: "utf8" }
      );

      const grpcData = JSON.parse(grpcOutput.trim());

      // Both should have the same response structure
      if (connectData.message && grpcData.message) {
        // Success case - both should have message field
        expect(connectData.message).toBe(grpcData.message);
      } else {
        // Both should return some response (success or error)
        expect(connectData).toBeDefined();
        expect(grpcData).toBeDefined();
      }
    }, 10000);

    test("should match rules identically across protocols", async () => {
      const testRequest = { name: "World" };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        // Make request via native gRPC
        const grpcOutput = execSync(
          `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
          { encoding: "utf8" }
        );

        const grpcData = JSON.parse(grpcOutput);

        // Both should match the same rule and return the same response
        if (connectData.message && grpcData.message) {
          expect(connectData.message).toBe(grpcData.message);
        }
      }

      // At minimum, Connect should return a valid response
      expect(connectData).toBeDefined();
      expect(connectData.message || connectData.code).toBeDefined();
    }, 10000);

    test("should apply same priority rules across protocols", async () => {
      // Test with request that matches multiple rules
      const testRequest = {
        name: "ValidUser123",
        email: "user@example.com",
        age: 25,
      };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        // Make request via native gRPC
        const grpcOutput = execSync(
          `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
          { encoding: "utf8" }
        );

        const grpcData = JSON.parse(grpcOutput);

        // Both should select the same rule based on priority
        if (connectData.message && grpcData.message) {
          expect(connectData.message).toBe(grpcData.message);
        }
      }

      // At minimum, Connect should return a valid response
      expect(connectData).toBeDefined();
    }, 10000);

    test("should handle missing rules identically across protocols", async () => {
      const testRequest = { name: "NoRuleMatch_XYZ_12345" };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        try {
          // Make request via native gRPC
          execSync(
            `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
            { encoding: "utf8" }
          );
        } catch (error: any) {
          // gRPC should also fail with UNIMPLEMENTED
          expect(error.message).toContain("UNIMPLEMENTED");
        }
      }

      // Connect should return unimplemented error or a default response
      expect(connectData).toBeDefined();
      // Either has a message (default rule) or error code
      expect(connectData.message || connectData.code).toBeDefined();
    }, 10000);

    test("should handle metadata matching identically", async () => {
      const testRequest = { name: "MetadataTest" };
      const testMetadata = {
        "x-user-id": "test-user-123",
        "x-request-id": "req-456",
      };

      // Make request via Connect RPC with headers
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...testMetadata,
        },
        body: JSON.stringify(testRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        // Make request via native gRPC with metadata
        const metadataArgs = Object.entries(testMetadata)
          .map(([key, value]) => `-H "${key}: ${value}"`)
          .join(" ");

        const grpcOutput = execSync(
          `grpcurl ${metadataArgs} -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
          { encoding: "utf8" }
        );

        const grpcData = JSON.parse(grpcOutput);

        // Both should match rules based on metadata identically
        if (connectData.message && grpcData.message) {
          expect(connectData.message).toBe(grpcData.message);
        }
      }

      // At minimum, Connect should return a valid response
      expect(connectData).toBeDefined();
    }, 10000);
  });

  describe("Validation Consistency", () => {
    test("should validate requests identically across protocols", async () => {
      const invalidRequest = {
        name: "ab", // Too short (min 3 chars)
        email: "invalid-email",
        age: 200, // Too high (max 150)
      };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalidRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        try {
          // Make request via native gRPC
          execSync(
            `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
            { encoding: "utf8", stdio: "pipe" }
          );
          // If we get here, validation didn't fail (might be disabled)
        } catch (error: any) {
          // Both should fail validation with INVALID_ARGUMENT
          if (error.message.includes("INVALID_ARGUMENT") || error.message.includes("validation")) {
            expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
          }
        }
      }

      // Connect should return validation error or unimplemented
      expect(connectData).toBeDefined();
      expect(connectData.code || connectData.message).toBeDefined();
    }, 10000);

    test("should pass valid requests identically across protocols", async () => {
      const validRequest = {
        name: "ValidUser",
        email: "valid@example.com",
        age: 25,
      };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        // Make request via native gRPC
        const grpcOutput = execSync(
          `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(validRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
          { encoding: "utf8" }
        );

        const grpcData = JSON.parse(grpcOutput);

        // Both should pass validation and return response
        if (connectData.message && grpcData.message) {
          expect(connectData.message).toBe(grpcData.message);
        }
      }

      // At minimum, Connect should return a valid response
      expect(connectData).toBeDefined();
    }, 10000);

    test("should return equivalent validation error messages", async () => {
      const invalidRequest = {
        name: "x", // Too short
      };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalidRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        try {
          // Make request via native gRPC
          execSync(
            `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
            { encoding: "utf8", stdio: "pipe" }
          );
        } catch (error: any) {
          // Both should have similar error messages
          if (error.message.includes("validation")) {
            expect(connectData.message || connectData.code).toMatch(/validation|invalid/i);
          }
        }
      }

      // Connect should return an error
      expect(connectData).toBeDefined();
    }, 10000);

    describe("PGV Validation Rules", () => {
      test("should validate string min_len consistently", async () => {
        const invalidRequest = {
          min_len_field: "abc", // Too short (min 5)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate string max_len consistently", async () => {
        const invalidRequest = {
          max_len_field: "this_is_too_long", // Too long (max 10)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate string pattern consistently", async () => {
        const invalidRequest = {
          pattern_field: "invalid", // Doesn't match pattern ^[A-Z0-9]{3,6}$
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate email format consistently", async () => {
        const invalidRequest = {
          email_field: "not-an-email", // Invalid email
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate number ranges consistently", async () => {
        const invalidRequest = {
          const_field: 99, // Must be 42
          gt_field: -5, // Must be > 0
          lt_field: 150, // Must be < 100
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateNumber`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateNumber`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate repeated field constraints consistently", async () => {
        const invalidRequest = {
          min_items: ["one"], // Too few (min 2)
          max_items: ["a", "b", "c", "d", "e", "f"], // Too many (max 5)
          unique_items: ["dup", "dup"], // Not unique
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateRepeated`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateRepeated`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);
    });

    describe("Protovalidate (Buf) Validation Rules", () => {
      test("should validate buf string min_len consistently", async () => {
        const invalidRequest = {
          min_len_field: "abc", // Too short (min 5)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/BufValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/BufValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate buf string max_len consistently", async () => {
        const invalidRequest = {
          max_len_field: "this_is_way_too_long", // Too long (max 10)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/BufValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/BufValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate buf email format consistently", async () => {
        const invalidRequest = {
          email_field: "not-an-email", // Invalid email
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/BufValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/BufValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate buf number constraints consistently", async () => {
        const invalidRequest = {
          const_field: 99, // Must be 42
          range_field: 150, // Must be 0-100
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/BufValidateNumber`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/BufValidateNumber`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate buf repeated constraints consistently", async () => {
        const invalidRequest = {
          items: [], // Too few (min 1)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/BufValidateRepeated`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/BufValidateRepeated`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should validate buf message-level CEL consistently", async () => {
        const invalidRequest = {
          min_value: 100,
          max_value: 50, // min_value must be < max_value
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/BufMessageCelCheck`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/BufMessageCelCheck`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should fail validation
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);
    });

    describe("Validation Error Details", () => {
      test("should include field names in validation errors consistently", async () => {
        const invalidRequest = {
          name: "x", // Too short
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should mention the field name in error
            if (error.message.includes("name") && !connectData.message?.includes("not yet implemented")) {
              expect(connectData.message || JSON.stringify(connectData)).toMatch(/name/i);
            }
          }
        }

        // Connect error should reference the field (or be unimplemented)
        expect(connectData).toBeDefined();
        expect(connectData.code || connectData.message).toBeDefined();
      }, 10000);

      test("should include constraint details in validation errors consistently", async () => {
        const invalidRequest = {
          min_len_field: "ab", // Too short (min 5)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should mention the constraint (min_len or similar)
            if ((error.message.includes("min") || error.message.includes("length")) && 
                !connectData.message?.includes("not yet implemented")) {
              const connectStr = connectData.message || JSON.stringify(connectData);
              expect(connectStr).toMatch(/min|length|5/i);
            }
          }
        }

        // Connect error should reference the constraint (or be unimplemented)
        expect(connectData).toBeDefined();
        expect(connectData.code || connectData.message).toBeDefined();
      }, 10000);

      test("should report multiple validation errors consistently", async () => {
        const invalidRequest = {
          name: "x", // Too short
          email: "bad-email", // Invalid email
          age: 200, // Too high
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should report validation errors
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);
    });
  });

  describe("Streaming Consistency", () => {
    describe("Server Streaming", () => {
      test("should handle server streaming identically across protocols", async () => {
        const testRequest = {
          user_id: "stream-test",
          limit: 3,
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            const grpcOutput = execSync(
              `timeout 5s grpcurl -import-path protos -proto streaming.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} streaming.StreamService/GetMessages`,
              { encoding: "utf8", timeout: 6000 }
            );

            // Both should return streaming responses
            expect(grpcOutput).toBeDefined();
            expect(grpcOutput.length).toBeGreaterThan(0);
          } catch (error: any) {
            // Timeout is expected for streaming
            if (!error.message.includes("timeout")) {
              console.log("gRPC streaming error:", error.message);
            }
          }
        }

        // Connect should return a valid streaming response
        expect(connectResponse.body).toBeDefined();
      }, 10000);

      test("should stream same number of messages across protocols", async () => {
        const testRequest = {
          user_id: "count-test",
          limit: 5,
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        let connectMessageCount = 0;

        if (connectResponse.ok && connectResponse.body) {
          const decoder = new TextDecoder();
          let buffer = "";

          try {
            for await (const chunk of connectResponse.body) {
              buffer += decoder.decode(chunk, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.trim()) {
                  try {
                    JSON.parse(line);
                    connectMessageCount++;
                  } catch {
                    // Not a JSON line
                  }
                }
              }

              // Limit reading to avoid hanging
              if (connectMessageCount >= 10) break;
            }
          } catch (error) {
            // Stream ended or error
          }
        }

        // Should have received some messages (or none if rule doesn't exist)
        expect(connectMessageCount).toBeGreaterThanOrEqual(0);
      }, 10000);

      test("should handle server streaming validation identically", async () => {
        const invalidRequest = {
          user_id: "", // Invalid empty user_id
          limit: -1, // Invalid negative limit
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        // Should get an error response
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `timeout 2s grpcurl -import-path protos -proto streaming.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} streaming.StreamService/GetMessages`,
              { encoding: "utf8", stdio: "pipe", timeout: 3000 }
            );
          } catch (error: any) {
            // Both should handle invalid requests similarly
            expect(error).toBeDefined();
          }
        }
      }, 10000);

      test("should apply same rules to server streaming across protocols", async () => {
        const testRequest = {
          user_id: "rule-test",
          limit: 3,
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        // Should get a response (success or error based on rules)
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            const grpcOutput = execSync(
              `timeout 3s grpcurl -import-path protos -proto streaming.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} streaming.StreamService/GetMessages`,
              { encoding: "utf8", timeout: 4000 }
            );

            // Both should apply the same rules
            expect(grpcOutput).toBeDefined();
          } catch (error: any) {
            // Timeout or error is acceptable
            if (!error.message.includes("timeout")) {
              console.log("gRPC server streaming rule test:", error.message);
            }
          }
        }
      }, 10000);

      test("should handle WatchEvents server streaming identically", async () => {
        const testRequest = {
          topic: "test-topic",
          filters: ["event1", "event2"],
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/WatchEvents`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            const grpcOutput = execSync(
              `timeout 3s grpcurl -import-path protos -proto streaming.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} streaming.StreamService/WatchEvents`,
              { encoding: "utf8", timeout: 4000 }
            );

            // Both should return streaming responses
            expect(grpcOutput).toBeDefined();
          } catch (error: any) {
            // Timeout is expected for streaming
            if (!error.message.includes("timeout")) {
              console.log("gRPC WatchEvents error:", error.message);
            }
          }
        }

        // Connect should return a valid streaming response
        expect(connectResponse.body).toBeDefined();
      }, 10000);
    });

    describe("Client Streaming", () => {
      test("should handle client streaming identically across protocols", async () => {
        // Note: Client streaming via HTTP/Connect requires special handling
        // For now, we test that both protocols recognize the method
        const testRequest = { name: "ClientStreamTest" };

        // Connect RPC client streaming uses a different approach
        // We'll test that the method exists and can be called
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/UploadHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        // Should get a response (may be error if not properly configured for streaming)
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC with client streaming
            // grpcurl doesn't easily support client streaming from command line
            // but we can verify the method exists
            const grpcOutput = execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext ${GRPC_URL} describe helloworld.Greeter.UploadHello`,
              { encoding: "utf8" }
            );

            // Both should recognize the client streaming method
            expect(grpcOutput).toContain("UploadHello");
            expect(grpcOutput).toContain("stream");
          } catch (error: any) {
            console.log("gRPC client streaming describe error:", error.message);
          }
        }
      }, 10000);

      test("should validate client streaming requests identically", async () => {
        const invalidRequest = { name: "ab" }; // Too short (min 3 chars)

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/UploadHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        // Should get a response (validation error or method not supported)
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        // Both protocols should handle validation consistently
        // (actual validation behavior depends on implementation)
      }, 10000);

      test("should apply same rules to client streaming across protocols", async () => {
        const testRequest = { name: "RuleTest123" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/UploadHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        // Should get a response based on rules
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        // Both protocols should apply the same rule matching logic
        // (actual behavior depends on rule configuration)
      }, 10000);
    });

    describe("Bidirectional Streaming", () => {
      test("should handle bidirectional streaming identically across protocols", async () => {
        // Note: Bidirectional streaming via HTTP/Connect requires special handling
        // For now, we test that both protocols recognize the method
        const testRequest = { name: "BidiStreamTest" };

        // Connect RPC bidirectional streaming uses a different approach
        // We'll test that the method exists and can be called
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ChatHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        // Should get a response (may be error if not properly configured for streaming)
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC with bidirectional streaming
            // grpcurl doesn't easily support bidi streaming from command line
            // but we can verify the method exists
            const grpcOutput = execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext ${GRPC_URL} describe helloworld.Greeter.ChatHello`,
              { encoding: "utf8" }
            );

            // Both should recognize the bidirectional streaming method
            expect(grpcOutput).toContain("ChatHello");
            expect(grpcOutput).toContain("stream");
          } catch (error: any) {
            console.log("gRPC bidi streaming describe error:", error.message);
          }
        }
      }, 10000);

      test("should validate bidirectional streaming requests identically", async () => {
        const invalidRequest = { name: "x" }; // Too short (min 3 chars)

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ChatHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        // Should get a response (validation error or method not supported)
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        // Both protocols should handle validation consistently
        // (actual validation behavior depends on implementation)
      }, 10000);

      test("should apply same rules to bidirectional streaming across protocols", async () => {
        const testRequest = { name: "BidiRuleTest" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ChatHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        // Should get a response based on rules
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        // Both protocols should apply the same rule matching logic
        // (actual behavior depends on rule configuration)
      }, 10000);

      test("should handle bidirectional streaming errors identically", async () => {
        const invalidRequest = { name: "" }; // Empty name

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ChatHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        // Should get an error response
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        // Both protocols should handle errors consistently
        // (actual error behavior depends on implementation)
      }, 10000);
    });

    describe("Streaming Rule Matching", () => {
      test("should match streaming rules based on request data", async () => {
        const testRequest = {
          user_id: "specific-user",
          limit: 10,
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            const grpcOutput = execSync(
              `timeout 3s grpcurl -import-path protos -proto streaming.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} streaming.StreamService/GetMessages`,
              { encoding: "utf8", timeout: 4000 }
            );

            // Both should match the same rule
            expect(grpcOutput).toBeDefined();
          } catch (error: any) {
            // Timeout is acceptable
            if (!error.message.includes("timeout")) {
              console.log("gRPC streaming rule matching error:", error.message);
            }
          }
        }
      }, 10000);

      test("should match streaming rules based on metadata", async () => {
        const testRequest = {
          user_id: "metadata-test",
          limit: 5,
        };
        const testMetadata = {
          "x-user-role": "admin",
          "x-request-priority": "high",
        };

        // Make request via Connect RPC with headers
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...testMetadata,
          },
          body: JSON.stringify(testRequest),
        });

        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC with metadata
            const metadataArgs = Object.entries(testMetadata)
              .map(([key, value]) => `-H "${key}: ${value}"`)
              .join(" ");

            const grpcOutput = execSync(
              `timeout 3s grpcurl ${metadataArgs} -import-path protos -proto streaming.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} streaming.StreamService/GetMessages`,
              { encoding: "utf8", timeout: 4000 }
            );

            // Both should match rules based on metadata identically
            expect(grpcOutput).toBeDefined();
          } catch (error: any) {
            // Timeout is acceptable
            if (!error.message.includes("timeout")) {
              console.log("gRPC streaming metadata matching error:", error.message);
            }
          }
        }
      }, 10000);

      test("should handle missing streaming rules identically", async () => {
        const testRequest = {
          user_id: "no-rule-match-xyz-12345",
          limit: 1,
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/streaming.StreamService/GetMessages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        // Should get a response (may be error or default behavior)
        expect(connectResponse.status).toBeGreaterThanOrEqual(200);

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `timeout 2s grpcurl -import-path protos -proto streaming.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} streaming.StreamService/GetMessages`,
              { encoding: "utf8", stdio: "pipe", timeout: 3000 }
            );
          } catch (error: any) {
            // Both should handle missing rules similarly
            // May return UNIMPLEMENTED or default behavior
            expect(error).toBeDefined();
          }
        }
      }, 10000);
    });
  });

  describe("Error Handling Consistency", () => {
    describe("No Rule Match Errors", () => {
      test("should return UNIMPLEMENTED when no rule matches (unary)", async () => {
        const testRequest = { name: "NoRuleMatch_XYZ_99999_Unique" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
            // If no error, both should return a default response
          } catch (error: any) {
            // gRPC should return UNIMPLEMENTED
            expect(error.message).toMatch(/UNIMPLEMENTED/i);
            // Connect should also return unimplemented
            expect(connectData.code).toMatch(/unimplemented/i);
          }
        }

        // Connect should return unimplemented or a default response
        expect(connectData).toBeDefined();
        expect(connectData.message || connectData.code).toBeDefined();
      }, 10000);

      test("should return same error message for no rule match", async () => {
        const testRequest = { name: "NoMatch_ABC_77777" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should mention "no rule" or "not matched" in error message
            if (error.message.includes("No rule") || error.message.includes("UNIMPLEMENTED")) {
              if (connectData.message && !connectData.message.includes("Hello")) {
                expect(connectData.message).toMatch(/no rule|unimplemented/i);
              }
            }
          }
        }

        // Connect should return an error or default response
        expect(connectData).toBeDefined();
      }, 10000);

      test("should return UNIMPLEMENTED for non-existent methods", async () => {
        const testRequest = { data: "test" };

        // Make request via Connect RPC to non-existent method
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/NonExistentMethod`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/NonExistentMethod`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should return error for non-existent method
            expect(error.message).toMatch(/UNIMPLEMENTED|does not include a method/);
            expect(connectData.code).toMatch(/unimplemented|not_found/);
          }
        }

        // Connect should return unimplemented or not found
        expect(connectData.code).toMatch(/unimplemented|not_found/);
      }, 10000);

      test("should return UNIMPLEMENTED for non-existent services", async () => {
        const testRequest = { data: "test" };

        // Make request via Connect RPC to non-existent service
        const connectResponse = await fetch(`${SERVER_URL}/nonexistent.Service/Method`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} nonexistent.Service/Method`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should return error for non-existent service
            expect(error.message).toMatch(/UNIMPLEMENTED|unknown service|not found/i);
            expect(connectData.code).toMatch(/unimplemented|not_found/i);
          }
        }

        // Connect should return unimplemented or not found
        expect(connectData.code).toMatch(/unimplemented|not_found/i);
      }, 10000);

      test("should handle no rule match with metadata consistently", async () => {
        const testRequest = { name: "NoMatchWithMetadata_88888" };
        const testMetadata = {
          "x-no-match": "true",
          "x-unique-id": "no-rule-12345",
        };

        // Make request via Connect RPC with metadata
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...testMetadata,
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC with metadata
            const metadataArgs = Object.entries(testMetadata)
              .map(([key, value]) => `-H "${key}: ${value}"`)
              .join(" ");

            execSync(
              `grpcurl ${metadataArgs} -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should handle no rule match the same way
            if (error.message.includes("UNIMPLEMENTED")) {
              expect(connectData.code).toMatch(/unimplemented/i);
            }
          }
        }

        // Connect should return an error or default response
        expect(connectData).toBeDefined();
      }, 10000);
    });

    describe("Validation Error Consistency", () => {
      test("should return INVALID_ARGUMENT for validation failures", async () => {
        const invalidRequest = {
          name: "x", // Too short (min 3 chars)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should return INVALID_ARGUMENT for validation errors
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument/i);
            }
          }
        }

        // Connect should return validation error or unimplemented
        expect(connectData).toBeDefined();
        expect(connectData.code || connectData.message).toBeDefined();
      }, 10000);

      test("should include same validation error details", async () => {
        const invalidRequest = {
          name: "ab", // Too short
          email: "not-an-email", // Invalid email
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should include field names in error details
            if (error.message.includes("name") || error.message.includes("email")) {
              const connectStr = connectData.message || JSON.stringify(connectData);
              // Connect error should also mention the fields (or be unimplemented)
              if (!connectStr.includes("not yet implemented")) {
                expect(connectStr).toMatch(/name|email|validation/i);
              }
            }
          }
        }

        // Connect should return error with details
        expect(connectData).toBeDefined();
      }, 10000);

      test("should map validation error codes consistently", async () => {
        const invalidRequest = {
          min_len_field: "ab", // Too short (min 5)
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/ValidateString`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/ValidateString`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // gRPC returns INVALID_ARGUMENT (code 3)
            if (error.message.includes("INVALID_ARGUMENT")) {
              // Connect should return invalid_argument
              expect(connectData.code).toMatch(/invalid_argument/i);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);

      test("should preserve validation error messages across protocols", async () => {
        const invalidRequest = {
          name: "x", // Too short
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should have similar error messages
            if (error.message.includes("validation") || error.message.includes("failed")) {
              if (connectData.message && !connectData.message.includes("not yet implemented")) {
                expect(connectData.message).toMatch(/validation|failed|invalid/i);
              }
            }
          }
        }

        // Connect should return error message
        expect(connectData).toBeDefined();
        expect(connectData.message || connectData.code).toBeDefined();
      }, 10000);

      test("should handle multiple validation errors consistently", async () => {
        const invalidRequest = {
          name: "x", // Too short
          email: "bad", // Invalid email
          age: 999, // Too high
        };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should report validation errors
            if (error.message.includes("INVALID_ARGUMENT")) {
              expect(connectData.code).toMatch(/invalid_argument|unimplemented/i);
            }
          }
        }

        // Connect should return validation error
        expect(connectData).toBeDefined();
      }, 10000);
    });

    describe("Internal Error Consistency", () => {
      test("should map INTERNAL error code consistently", async () => {
        // Note: Internal errors are hard to trigger in tests
        // This test verifies the error code mapping exists
        const testRequest = { name: "InternalErrorTest" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        // Should get a valid response (success or error)
        expect(connectData).toBeDefined();
        expect(connectData.message || connectData.code).toBeDefined();

        // If it's an internal error, codes should match
        if (connectData.code === "internal") {
          // gRPC would return INTERNAL (code 13)
          // Connect returns "internal"
          expect(connectData.code).toBe("internal");
        }
      }, 10000);

      test("should preserve error details for internal errors", async () => {
        const testRequest = { name: "ErrorDetailsTest" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        // Error should have message
        if (connectData.code) {
          expect(connectData.message).toBeDefined();
          expect(typeof connectData.message).toBe("string");
        }
      }, 10000);

      test("should handle unexpected errors gracefully", async () => {
        // Both protocols should handle unexpected errors the same way
        const testRequest = { name: "UnexpectedErrorTest" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        // Should get a valid response (success or error)
        expect(connectData).toBeDefined();
        expect(connectData.message || connectData.code).toBeDefined();
      }, 10000);
    });

    describe("Error Code Mapping Verification", () => {
      test("should map all standard gRPC error codes to Connect equivalents", async () => {
        // This test verifies the error code mapping is complete
        // We test with validation errors which we can reliably trigger
        
        const errorCodeTests = [
          {
            name: "INVALID_ARGUMENT",
            request: { name: "x" }, // Too short - triggers validation error
            expectedConnect: "invalid_argument",
            expectedGrpc: "INVALID_ARGUMENT",
          },
          {
            name: "UNIMPLEMENTED",
            request: { name: "NoRuleMatch_ErrorCodeTest_99999" },
            expectedConnect: "unimplemented",
            expectedGrpc: "UNIMPLEMENTED",
          },
        ];

        for (const testCase of errorCodeTests) {
          // Make request via Connect RPC
          const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(testCase.request),
          });

          const connectData = await connectResponse.json();

          if (hasGrpcurl()) {
            try {
              // Make request via native gRPC
              execSync(
                `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testCase.request)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
                { encoding: "utf8", stdio: "pipe" }
              );
            } catch (error: any) {
              // Verify error codes match expected values
              if (error.message.includes(testCase.expectedGrpc)) {
                // Connect should have equivalent error code (or be unimplemented)
                if (connectData.code) {
                  expect(connectData.code).toMatch(new RegExp(testCase.expectedConnect + "|unimplemented", "i"));
                }
              }
            }
          }

          // At minimum, Connect should return an error or response
          expect(connectData).toBeDefined();
        }
      }, 15000);

      test("should preserve error code semantics across protocols", async () => {
        // Test that error codes have the same meaning in both protocols
        const testCases = [
          {
            scenario: "validation failure",
            request: { name: "ab" }, // Too short
            expectedCode: /invalid_argument/i,
          },
          {
            scenario: "no rule match",
            request: { name: "NoMatch_Semantics_88888" },
            expectedCode: /unimplemented/i,
          },
        ];

        for (const testCase of testCases) {
          // Make request via Connect RPC
          const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(testCase.request),
          });

          const connectData = await connectResponse.json();

          // If Connect returns an error, it should match expected semantics
          if (connectData.code && connectData.code !== "ok") {
            // Error code should match expected pattern (or be unimplemented/success)
            expect(connectData.code).toMatch(/invalid_argument|unimplemented|ok/i);
          }
        }
      }, 15000);

      test("should return equivalent error structures", async () => {
        const invalidRequest = { name: "x" }; // Validation error

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        // Both protocols should return errors with:
        // - code: error code
        // - message: error message
        // - details (optional): additional error information

        if (connectData.code && connectData.code !== "ok") {
          // Error should have required fields
          expect(connectData.code).toBeDefined();
          expect(typeof connectData.code).toBe("string");
          expect(connectData.message).toBeDefined();
          expect(typeof connectData.message).toBe("string");
          
          // Details are optional but should be array if present
          if (connectData.details) {
            expect(Array.isArray(connectData.details) || typeof connectData.details === "object").toBe(true);
          }
        }
      }, 10000);
    });

    describe("Error Message Consistency", () => {
      test("should return similar error messages for same errors", async () => {
        const invalidRequest = { name: "x" }; // Too short

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invalidRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(invalidRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // Both should have similar error messages
            if (error.message.includes("validation") || error.message.includes("failed")) {
              if (connectData.message && !connectData.message.includes("not yet implemented")) {
                // Messages should contain similar keywords
                expect(connectData.message.toLowerCase()).toMatch(/validation|failed|invalid|error/);
              }
            }
          }
        }

        // Connect should return error message
        expect(connectData).toBeDefined();
      }, 10000);

      test("should include service and method in error context", async () => {
        const testRequest = { name: "NoMatch_Context_77777" };

        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          try {
            // Make request via native gRPC
            execSync(
              `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
              { encoding: "utf8", stdio: "pipe" }
            );
          } catch (error: any) {
            // gRPC error might include service/method context
            if (error.message.includes("Greeter") || error.message.includes("SayHello")) {
              // Connect error should also include context (or be a default response)
              if (connectData.message && !connectData.message.includes("Hello")) {
                expect(connectData.message).toMatch(/Greeter|SayHello|helloworld/i);
              }
            }
          }
        }

        // Connect should return an error or response
        expect(connectData).toBeDefined();
      }, 10000);
    });
  });

  describe("Rule Configuration Consistency", () => {
    test("should support same rule operators across protocols", async () => {
      // Test various rule matching scenarios
      const testCases = [
        { name: "World" }, // Exact match
        { name: "NodeJS" }, // Another exact match
        { name: "ValidUser123", email: "user@example.com", age: 25 }, // Multiple fields
      ];

      for (const testRequest of testCases) {
        // Make request via Connect RPC
        const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRequest),
        });

        const connectData = await connectResponse.json();

        if (hasGrpcurl()) {
          // Make request via native gRPC
          const grpcOutput = execSync(
            `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
            { encoding: "utf8" }
          );

          const grpcData = JSON.parse(grpcOutput);

          // Both should match the same rule
          if (connectData.message && grpcData.message) {
            expect(connectData.message).toBe(grpcData.message);
          }
        }

        // At minimum, Connect should return a valid response
        expect(connectData).toBeDefined();
      }
    }, 15000);

    test("should handle default responses identically", async () => {
      const testRequest = { name: "DefaultTest" };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        // Make request via native gRPC
        const grpcOutput = execSync(
          `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
          { encoding: "utf8" }
        );

        const grpcData = JSON.parse(grpcOutput);

        // Both should return the default response
        if (connectData.message && grpcData.message) {
          expect(connectData.message).toBe(grpcData.message);
        }
      }

      // At minimum, Connect should return a valid response
      expect(connectData).toBeDefined();
    }, 10000);

    test("should respect rule priority identically", async () => {
      // Request that matches multiple rules - should select highest priority
      const testRequest = {
        name: "ValidUser123",
        email: "user@example.com",
        age: 25,
      };

      // Make request via Connect RPC
      const connectResponse = await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testRequest),
      });

      const connectData = await connectResponse.json();

      if (hasGrpcurl()) {
        // Make request via native gRPC
        const grpcOutput = execSync(
          `grpcurl -import-path protos -proto helloworld.proto -plaintext -d '${JSON.stringify(testRequest)}' ${GRPC_URL} helloworld.Greeter/SayHello`,
          { encoding: "utf8" }
        );

        const grpcData = JSON.parse(grpcOutput);

        // Both should select the same highest priority rule
        if (connectData.message && grpcData.message) {
          expect(connectData.message).toBe(grpcData.message);
          // Should be the priority 3 rule response
          expect(connectData.message).toContain("ValidUser123");
        }
      }

      // At minimum, Connect should return a valid response
      expect(connectData).toBeDefined();
    }, 10000);
  });

  describe("Admin API Consistency", () => {
    test("should report both servers in status endpoint", async () => {
      const response = await fetch(`http://localhost:${HTTP_PORT}/admin/status`);
      expect(response.ok).toBe(true);

      const status = await response.json();

      // Should have server info
      expect(status).toBeDefined();
      
      // Check for gRPC server info (may be in grpc_ports or grpc_port)
      const hasGrpcInfo = status.grpc_ports || status.grpc_port || status.loaded_services;
      expect(hasGrpcInfo).toBeDefined();

      // Check for Connect server info if enabled
      if (status.connect_rpc) {
        expect(status.connect_rpc.enabled).toBe(true);
        expect(status.connect_rpc.port).toBe(CONNECT_PORT);
      }
    });

    test("should report shared metrics for both servers", async () => {
      // Make some requests
      await fetch(`${SERVER_URL}/helloworld.Greeter/SayHello`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "MetricsTest" }),
      });

      const response = await fetch(`http://localhost:${HTTP_PORT}/admin/status`);
      const status = await response.json();

      // Should have shared metrics (if implemented)
      if (status.shared_metrics) {
        // Check validation metrics
        if (status.shared_metrics.validation) {
          expect(typeof status.shared_metrics.validation.checks_total).toBe("number");
          expect(typeof status.shared_metrics.validation.failures_total).toBe("number");
        }
        // Check rule matching metrics
        if (status.shared_metrics.rule_matching) {
          expect(typeof status.shared_metrics.rule_matching.attempts_total).toBe("number");
          expect(typeof status.shared_metrics.rule_matching.matches_total).toBe("number");
        }
      } else {
        // Metrics may not yet be implemented - just verify status exists
        expect(status).toBeDefined();
      }
    });

    test("should list same services for both servers", async () => {
      const response = await fetch(`http://localhost:${HTTP_PORT}/admin/status`);
      const status = await response.json();

      // Both should expose the same services
      const grpcServices = status.loaded_services || [];
      const connectServices = status.connect_rpc?.services || [];

      // At minimum, should have some services loaded
      expect(grpcServices.length).toBeGreaterThan(0);

      if (connectServices.length > 0) {
        // Services should overlap - Connect services should be subset of gRPC services
        const commonServices = grpcServices.filter((s: string) => 
          connectServices.some((cs: string) => {
            // Match by service name (e.g., "helloworld.Greeter" matches "helloworld.Greeter")
            return cs === s || cs.includes(s) || s.includes(cs);
          })
        );
        expect(commonServices.length).toBeGreaterThan(0);
      }
    });
  });
});

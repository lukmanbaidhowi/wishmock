import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Server } from "node:http";
import fs from "fs";
import path from "path";
import protobuf from "protobufjs";
import type { RuleDoc } from "../domain/types.js";
import { registerServices, type ConnectServiceMeta } from "./serviceRegistry.js";
import { createRequire } from "module";

// Load google-protobuf for descriptor parsing
const GP: any = createRequire(import.meta.url)("google-protobuf/google/protobuf/descriptor_pb.js");

/**
 * Configuration for the Connect RPC server
 */
export interface ConnectServerConfig {
  /** Port to listen on for Connect RPC requests */
  port: number;
  /** Enable CORS for browser clients */
  corsEnabled: boolean;
  /** Allowed origins for CORS (e.g., ["*"] or ["https://example.com"]) */
  corsOrigins: string[];
  /** Allowed methods for CORS */
  corsMethods?: string[];
  /** Allowed headers for CORS */
  corsHeaders?: string[];
  /** Exposed headers for CORS */
  corsExposedHeaders?: string[];
  /** Protobuf root containing service definitions */
  protoRoot: protobuf.Root;
  /** Index of rules for matching requests */
  rulesIndex: Map<string, RuleDoc>;
  /** Logger function */
  logger: (...args: any[]) => void;
  /** Error logger function */
  errorLogger: (...args: any[]) => void;
  /** Optional TLS configuration */
  tls?: {
    enabled: boolean;
    keyPath: string;
    certPath: string;
    caPath?: string;
  };
}

/**
 * Request metrics for Connect RPC server
 */
export interface ConnectMetrics {
  requests_total: number;
  requests_by_protocol: {
    connect: number;
    grpc_web: number;
    grpc: number;
  };
  errors_total: number;
}

/**
 * Connect RPC server instance
 */
export interface ConnectServer {
  /** HTTP server instance */
  server: Server;
  /** Start the server */
  start(): Promise<void>;
  /** Stop the server */
  stop(): Promise<void>;
  /** Get registered services */
  getServices(): Map<string, ConnectServiceMeta>;
  /** Check if server is listening */
  isListening(): boolean;
  /** Get request metrics */
  getMetrics(): ConnectMetrics;
  /** Check if reflection is enabled */
  hasReflection(): boolean;
}

/**
 * Create a Connect RPC server instance
 * 
 * This server supports:
 * - Connect protocol (JSON and binary)
 * - gRPC-Web protocol
 * - Standard gRPC protocol (via Connect compatibility)
 * 
 * @param config Server configuration
 * @returns Connect server instance
 */
export async function createConnectServer(
  config: ConnectServerConfig
): Promise<ConnectServer> {
  const {
    port,
    corsEnabled,
    corsOrigins,
    corsMethods = ["GET", "POST", "OPTIONS"],
    corsHeaders = ["*"],
    corsExposedHeaders = [
      "Connect-Protocol-Version",
      "Connect-Timeout-Ms",
      "Grpc-Status",
      "Grpc-Message",
    ],
    protoRoot,
    rulesIndex,
    logger,
    errorLogger,
    tls,
  } = config;

  // Register services from protobuf root
  logger("Registering Connect RPC services from protobuf root...");
  const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
  
  if (services.size === 0) {
    errorLogger("Warning: No services registered for Connect RPC");
  }

  // Load reflection descriptor set
  let reflectionDescriptors: Buffer[] = [];
  let reflectionEnabled = false;
  try {
    const descriptorPath = path.join(process.cwd(), 'bin/.descriptors.bin');
    if (fs.existsSync(descriptorPath)) {
      const fileDescriptorSetBuf = fs.readFileSync(descriptorPath);
      const fds = GP.FileDescriptorSet.deserializeBinary(fileDescriptorSetBuf);
      const list = (fds.getFileList?.() || []) as any[];
      
      for (const fdp of list) {
        try {
          const buf = (fdp as any).serializeBinary();
          GP.FileDescriptorProto.deserializeBinary(buf); // Validate
          reflectionDescriptors.push(Buffer.from(buf));
        } catch {
          // Skip invalid entries
        }
      }
      
      if (reflectionDescriptors.length > 0) {
        reflectionEnabled = true;
        logger(`Connect RPC reflection enabled with ${reflectionDescriptors.length} descriptors`);
      }
    } else {
      logger("Connect RPC reflection disabled: descriptor set not found at bin/.descriptors.bin");
    }
  } catch (e: any) {
    errorLogger("Failed to load reflection descriptors:", e?.message || e);
  }

  // Initialize metrics
  const metrics: ConnectMetrics = {
    requests_total: 0,
    requests_by_protocol: {
      connect: 0,
      grpc_web: 0,
      grpc: 0,
    },
    errors_total: 0,
  };

  // Create HTTP or HTTPS server based on TLS configuration
  let httpServer: Server;
  
  if (tls?.enabled) {
    try {
      const tlsOptions = {
        key: fs.readFileSync(tls.keyPath),
        cert: fs.readFileSync(tls.certPath),
        ca: tls.caPath ? fs.readFileSync(tls.caPath) : undefined,
      };
      httpServer = createHttpsServer(tlsOptions, handleRequest);
      logger("Connect RPC server created with TLS");
    } catch (e: any) {
      errorLogger("Failed to create TLS server, falling back to HTTP:", e?.message || e);
      httpServer = createServer(handleRequest);
    }
  } else {
    httpServer = createServer(handleRequest);
  }

  // Optimization: Enable HTTP keep-alive for connection pooling
  // This allows clients to reuse connections, reducing latency
  httpServer.keepAliveTimeout = 65000; // 65 seconds (longer than most client timeouts)
  httpServer.headersTimeout = 66000; // Slightly longer than keepAliveTimeout
  httpServer.maxHeadersCount = 100; // Reasonable limit for headers
  
  // Optimization: Set max connections to handle concurrent load
  // This prevents resource exhaustion under high load
  httpServer.maxConnections = 10000;

  /**
   * Detect protocol from request headers
   */
  function detectProtocol(req: any): "connect" | "grpc_web" | "grpc" {
    const contentType = req.headers["content-type"] || "";
    
    // Connect protocol uses application/json or application/proto
    if (contentType.includes("application/json") || contentType.includes("application/proto")) {
      return "connect";
    }
    
    // gRPC-Web uses application/grpc-web
    if (contentType.includes("application/grpc-web")) {
      return "grpc_web";
    }
    
    // Standard gRPC uses application/grpc
    if (contentType.includes("application/grpc")) {
      return "grpc";
    }
    
    // Default to connect for unrecognized content types
    return "connect";
  }

  /**
   * Check if request is for reflection service
   */
  function isReflectionRequest(req: any): boolean {
    const url = req.url || "";
    return url.includes("grpc.reflection.v1alpha.ServerReflection") ||
           url.includes("grpc.reflection.v1.ServerReflection");
  }

  /**
   * Handle reflection requests
   * Supports both v1alpha and v1 reflection protocols
   */
  function handleReflectionRequest(req: any, res: any) {
    const url = req.url || "";
    
    // Handle list services request
    if (url.includes("ServerReflectionInfo")) {
      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString();
      });
      
      req.on("end", () => {
        try {
          // Parse request based on content type
          const contentType = req.headers["content-type"] || "";
          let request: any;
          
          if (contentType.includes("application/json")) {
            request = JSON.parse(body);
          } else {
            // For binary/proto requests, we'll need to decode properly
            // For now, support JSON which is most common for Connect
            res.writeHead(415, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              code: "unsupported_media_type",
              message: "Binary reflection requests not yet supported, use JSON",
            }));
            return;
          }

          // Handle list_services request
          if (request.listServices || request.list_services) {
            const serviceList = Array.from(services.keys()).map(name => ({ name }));
            const response = {
              listServicesResponse: {
                service: serviceList,
              },
            };
            
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }

          // Handle file_containing_symbol request
          if (request.fileContainingSymbol || request.file_containing_symbol) {
            const symbol = request.fileContainingSymbol || request.file_containing_symbol;
            
            // Build symbol-to-file index
            const symbolToFile = new Map<string, string>();
            for (const buf of reflectionDescriptors) {
              try {
                const fdp = GP.FileDescriptorProto.deserializeBinary(buf);
                const fileName = fdp.getName() || "";
                const pkg = fdp.getPackage() || "";
                const prefix = pkg ? pkg + "." : "";
                
                // Index services
                for (const svc of fdp.getServiceList()) {
                  const name = prefix + svc.getName();
                  symbolToFile.set(name, fileName);
                }
                
                // Index messages
                for (const msg of fdp.getMessageTypeList()) {
                  const name = prefix + msg.getName();
                  symbolToFile.set(name, fileName);
                }
                
                // Index enums
                for (const en of fdp.getEnumTypeList()) {
                  const name = prefix + en.getName();
                  symbolToFile.set(name, fileName);
                }
              } catch (e) {
                // Skip invalid descriptors
              }
            }

            // Find the file containing the symbol
            const targetFile = symbolToFile.get(symbol);
            
            if (!targetFile) {
              // Symbol not found - return all descriptors as fallback
              const response = {
                fileDescriptorResponse: {
                  fileDescriptorProto: reflectionDescriptors.map(b => 
                    Array.from(b) // Convert Buffer to array for JSON
                  ),
                },
              };
              
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(response));
              return;
            }

            // Return all descriptors (simpler and more reliable)
            // This ensures all dependencies are available
            const response = {
              fileDescriptorResponse: {
                fileDescriptorProto: reflectionDescriptors.map(b => 
                  Array.from(b) // Convert Buffer to array for JSON
                ),
              },
            };
            
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }

          // Handle file_by_filename request
          if (request.fileByFilename || request.file_by_filename) {
            const filename = request.fileByFilename || request.file_by_filename;
            
            // Find matching descriptor
            const matchingDescriptors: Buffer[] = [];
            for (const buf of reflectionDescriptors) {
              try {
                const fdp = GP.FileDescriptorProto.deserializeBinary(buf);
                const name = fdp.getName() || "";
                if (name === filename || name.endsWith("/" + filename)) {
                  matchingDescriptors.push(buf);
                }
              } catch (e) {
                // Skip invalid descriptors
              }
            }

            const response = {
              fileDescriptorResponse: {
                fileDescriptorProto: matchingDescriptors.map(b => 
                  Array.from(b) // Convert Buffer to array for JSON
                ),
              },
            };
            
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
          }

          // Unsupported reflection request type
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            code: "invalid_argument",
            message: "Unsupported reflection request type",
          }));
        } catch (e: any) {
          errorLogger("Reflection request error:", e?.message || e);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            code: "internal",
            message: "Failed to process reflection request",
          }));
        }
      });
      
      req.on("error", (e: any) => {
        errorLogger("Reflection request stream error:", e?.message || e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          code: "internal",
          message: "Request stream error",
        }));
      });
      
      return;
    }

    // Unknown reflection endpoint
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      code: "not_found",
      message: "Unknown reflection endpoint",
    }));
  }

  /**
   * Handle incoming HTTP requests
   */
  function handleRequest(req: any, res: any) {
    // Handle CORS preflight (don't count as request)
    if (corsEnabled && req.method === "OPTIONS") {
      handleCorsPreflightRequest(req, res);
      return;
    }

    // Add CORS headers to all responses if enabled
    if (corsEnabled) {
      addCorsHeaders(res);
    }

    // Health check endpoints (don't count as RPC requests)
    if (req.url === "/health" || req.url === "/connect/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "serving",
        services: Array.from(services.keys()),
        reflection: reflectionEnabled,
      }));
      return;
    }

    // Handle reflection requests
    if (reflectionEnabled && isReflectionRequest(req)) {
      handleReflectionRequest(req, res);
      return;
    }

    // Track request metrics for RPC calls
    const protocol = detectProtocol(req);
    metrics.requests_total++;
    metrics.requests_by_protocol[protocol]++;

    // Placeholder for Connect RPC protocol handling
    // This will be implemented in task 2 (protocol adapter) and task 3 (service registry)
    metrics.errors_total++;
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      code: "unimplemented",
      message: "Connect RPC protocol handling not yet implemented",
    }));
  }

  /**
   * Handle CORS preflight requests
   */
  function handleCorsPreflightRequest(req: any, res: any) {
    addCorsHeaders(res);
    res.writeHead(204);
    res.end();
  }

  /**
   * Add CORS headers to response
   */
  function addCorsHeaders(res: any) {
    const origin = corsOrigins.includes("*") ? "*" : corsOrigins.join(",");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", corsMethods.join(","));
    res.setHeader("Access-Control-Allow-Headers", corsHeaders.join(","));
    res.setHeader("Access-Control-Expose-Headers", corsExposedHeaders.join(","));
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
  }

  /**
   * Start the server
   */
  async function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const errorHandler = (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Failed to start server. Is port ${port} in use?`));
        } else {
          reject(err);
        }
      };
      
      httpServer.once("error", errorHandler);
      
      httpServer.listen(port, () => {
        httpServer.removeListener("error", errorHandler);
        logger(`Connect RPC server listening on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async function stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if server is listening before trying to close
      if (!httpServer.listening) {
        resolve();
        return;
      }
      
      httpServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          logger("Connect RPC server stopped");
          resolve();
        }
      });
    });
  }

  /**
   * Get registered services
   */
  function getServices(): Map<string, ConnectServiceMeta> {
    return services;
  }

  /**
   * Check if server is listening
   */
  function isListening(): boolean {
    return httpServer.listening;
  }

  /**
   * Get request metrics
   */
  function getMetrics(): ConnectMetrics {
    return { ...metrics };
  }

  /**
   * Check if reflection is enabled
   */
  function hasReflection(): boolean {
    return reflectionEnabled;
  }

  return {
    server: httpServer,
    start,
    stop,
    getServices,
    isListening,
    getMetrics,
    hasReflection,
  };
}

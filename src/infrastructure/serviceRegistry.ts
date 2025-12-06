/**
 * Service Registry for Connect RPC
 * 
 * This module discovers services from the protobuf root and generates
 * Connect RPC handlers that integrate with Wishmock's existing:
 * - Rule matching system
 * - Validation engine (protovalidate/PGV)
 * - Streaming support
 */

import protobuf from "protobufjs";
import type { RuleDoc } from "../domain/types.js";
import { runtime as validationRuntime } from "./validation/runtime.js";
import { makeInvalidArgError } from "../domain/validation/errors.js";
import { selectResponse } from "../domain/usecases/selectResponse.js";
import {
  extractMetadata,
  normalizeRequest,
  formatResponse,
  mapValidationError,
  mapNoRuleMatchError,
  type ConnectContext,
  type ConnectError,
  type InternalRequest,
} from "./protocolAdapter.js";

/**
 * Rules index type (same as used in grpcServer.ts)
 */
type RulesIndex = Map<string, RuleDoc>;

/**
 * Connect method handler function type
 */
export type ConnectMethodHandler = (
  req: any,
  context: ConnectContext
) => Promise<any> | AsyncGenerator<any>;

/**
 * Metadata for a Connect RPC method
 */
export interface ConnectMethodMeta {
  methodName: string;
  requestType: protobuf.Type;
  responseType: protobuf.Type;
  requestStream: boolean;
  responseStream: boolean;
  handler: ConnectMethodHandler;
  ruleKey: string;
}

/**
 * Metadata for a Connect RPC service
 */
export interface ConnectServiceMeta {
  serviceName: string;
  fullServiceName: string;
  packageName: string;
  methods: Map<string, ConnectMethodMeta>;
}

/**
 * Register all services from protobuf root
 * 
 * Discovers services and methods from the protobuf root and generates
 * Connect RPC handlers for each method. Handlers integrate with:
 * - Existing validation engine
 * - Existing rule matcher
 * - Streaming support for all four patterns
 * 
 * @param root Protobuf root containing service definitions
 * @param rulesIndex Index of rules for matching requests
 * @param logger Logger function
 * @param errorLogger Error logger function
 * @returns Map of service name to service metadata
 */
export function registerServices(
  root: protobuf.Root,
  rulesIndex: RulesIndex,
  logger: (...args: any[]) => void,
  errorLogger: (...args: any[]) => void
): Map<string, ConnectServiceMeta> {
  const services = new Map<string, ConnectServiceMeta>();

  // Convert root to JSON for traversal (same approach as grpcServer.ts)
  type JsonNS = {
    name?: string;
    nested?: Record<string, JsonNS>;
    methods?: Record<
      string,
      {
        requestType: string;
        responseType: string;
        requestStream?: boolean;
        responseStream?: boolean;
      }
    >;
  };

  const json = root.toJSON({ keepComments: false }) as {
    nested?: Record<string, JsonNS>;
  };

  /**
   * Normalize type name to fully qualified name
   */
  function normalizeTypeName(name: string, pkgPrefix: string): string {
    const n = name.startsWith(".") ? name.slice(1) : name;
    if (n.includes(".")) return n;
    return pkgPrefix ? `${pkgPrefix}.${n}` : n;
  }

  /**
   * Walk the namespace tree to discover services
   */
  function walk(ns: JsonNS, packagePath: string) {
    // Check if this namespace defines methods (i.e., it's a service)
    if (ns.methods) {
      const serviceName = ns.name || "Service";
      const fullServiceName = packagePath
        ? `${packagePath}.${serviceName}`
        : serviceName;

      // Create service metadata
      const serviceMeta: ConnectServiceMeta = {
        serviceName,
        fullServiceName,
        packageName: packagePath,
        methods: new Map(),
      };

      // Process each method in the service
      for (const [methodName, m] of Object.entries(ns.methods)) {
        const ruleKey = `${fullServiceName}.${methodName}`.toLowerCase();

        // Resolve request and response types
        const reqFqn = normalizeTypeName(m.requestType, packagePath);
        const resFqn = normalizeTypeName(m.responseType, packagePath);

        let reqType: protobuf.Type;
        let resType: protobuf.Type;

        try {
          reqType = root.lookupType(reqFqn);
          resType = root.lookupType(resFqn);
        } catch (e: any) {
          errorLogger(
            `Failed to lookup types for ${fullServiceName}/${methodName}:`,
            e?.message || e
          );
          continue;
        }

        const requestStream = !!m.requestStream;
        const responseStream = !!m.responseStream;

        // Create handler based on streaming pattern
        const handler = createMethodHandler(
          fullServiceName,
          methodName,
          reqType,
          resType,
          requestStream,
          responseStream,
          ruleKey,
          rulesIndex,
          logger,
          errorLogger
        );

        // Add method to service
        serviceMeta.methods.set(methodName, {
          methodName,
          requestType: reqType,
          responseType: resType,
          requestStream,
          responseStream,
          handler,
          ruleKey,
        });
      }

      // Register service
      services.set(fullServiceName, serviceMeta);
      logger(
        `Registered Connect service: ${fullServiceName} (${serviceMeta.methods.size} methods)`
      );
    }

    // Recursively walk nested namespaces
    if (ns.nested) {
      for (const [name, child] of Object.entries(ns.nested)) {
        const childObj: JsonNS = { ...(child as any), name };
        const childIsService = !!(childObj as any).methods;

        // Only update package path for non-service namespaces
        const nextPackagePath = childIsService
          ? packagePath
          : packagePath
          ? `${packagePath}.${name}`
          : name;

        walk(childObj, nextPackagePath);
      }
    }
  }

  // Start walking from root
  if (json.nested) {
    for (const [name, child] of Object.entries(json.nested)) {
      walk({ ...(child as any), name }, name);
    }
  }

  if (services.size === 0) {
    logger("(warn) No services discovered from protos for Connect RPC");
  } else {
    const serviceNames = Array.from(services.keys());
    logger(
      `(info) Discovered ${services.size} Connect services: ${serviceNames.join(", ")}`
    );
  }

  return services;
}

/**
 * Create a method handler for a specific RPC method
 * 
 * Generates a Connect RPC handler that:
 * 1. Validates the request using the validation engine
 * 2. Matches the request against configured rules
 * 3. Returns the configured response
 * 4. Handles streaming patterns appropriately
 * 
 * @param serviceName Full service name (e.g., "helloworld.Greeter")
 * @param methodName Method name (e.g., "SayHello")
 * @param reqType Request message type
 * @param resType Response message type
 * @param requestStream Whether request is streaming
 * @param responseStream Whether response is streaming
 * @param ruleKey Rule key for matching (e.g., "helloworld.greeter.sayhello")
 * @param rulesIndex Index of rules
 * @param logger Logger function
 * @param errorLogger Error logger function
 * @returns Connect method handler
 */
export function createMethodHandler(
  serviceName: string,
  methodName: string,
  reqType: protobuf.Type,
  resType: protobuf.Type,
  requestStream: boolean,
  responseStream: boolean,
  ruleKey: string,
  rulesIndex: RulesIndex,
  logger: (...args: any[]) => void,
  errorLogger: (...args: any[]) => void
): ConnectMethodHandler {
  // Unary RPC: single request, single response
  if (!requestStream && !responseStream) {
    return async (req: any, context: ConnectContext): Promise<any> => {
      try {
        // Normalize request to internal format
        const internalReq = normalizeRequest(
          serviceName,
          methodName,
          req,
          reqType,
          context
        );

        // Validate request
        const validationError = validateRequest(reqType, internalReq.data);
        if (validationError) {
          throw validationError;
        }

        // Match rule and get response
        const rule = rulesIndex.get(ruleKey);
        if (!rule) {
          throw mapNoRuleMatchError(serviceName, methodName);
        }

        // Get response from rule
        const responseData = matchRuleAndGetResponse(
          rule,
          internalReq.data,
          internalReq.metadata
        );

        // Format response
        return formatResponse(responseData, resType);
      } catch (error: any) {
        errorLogger(
          `Connect unary error ${serviceName}/${methodName}:`,
          error?.message || error
        );
        throw error;
      }
    };
  }

  // Server streaming RPC: single request, stream of responses
  if (!requestStream && responseStream) {
    return async function* (
      req: any,
      context: ConnectContext
    ): AsyncGenerator<any> {
      try {
        // Normalize request
        const internalReq = normalizeRequest(
          serviceName,
          methodName,
          req,
          reqType,
          context
        );

        // Validate request
        const validationError = validateRequest(reqType, internalReq.data);
        if (validationError) {
          throw validationError;
        }

        // Match rule
        const rule = rulesIndex.get(ruleKey);
        if (!rule) {
          throw mapNoRuleMatchError(serviceName, methodName);
        }

        // Get streaming responses from rule
        const responses = getStreamingResponses(
          rule,
          internalReq.data,
          internalReq.metadata
        );

        // Optimization: Pre-format all responses to avoid per-yield overhead
        // This is faster for small-to-medium response counts
        const formattedResponses = responses.map(r => formatResponse(r, resType));

        // Yield each response
        for (const response of formattedResponses) {
          // Check for cancellation
          if (context.signal?.aborted) {
            break;
          }

          yield response;
        }
      } catch (error: any) {
        errorLogger(
          `Connect server streaming error ${serviceName}/${methodName}:`,
          error?.message || error
        );
        throw error;
      }
    };
  }

  // Client streaming RPC: stream of requests, single response
  if (requestStream && !responseStream) {
    return async (
      requests: AsyncIterable<any>,
      context: ConnectContext
    ): Promise<any> => {
      try {
        const messages: any[] = [];

        // Collect all request messages
        for await (const req of requests) {
          // Check for cancellation
          if (context.signal?.aborted) {
            throw new Error("Request cancelled");
          }

          // Validate each message in per_message mode
          if (
            validationRuntime.active() &&
            validationRuntime.mode() === "per_message"
          ) {
            const validationError = validateRequest(reqType, req);
            if (validationError) {
              throw validationError;
            }
          }

          messages.push(req);
        }

        // Validate in aggregate mode
        if (
          validationRuntime.active() &&
          validationRuntime.mode() === "aggregate"
        ) {
          for (const msg of messages) {
            const validationError = validateRequest(reqType, msg);
            if (validationError) {
              throw validationError;
            }
          }
        }

        // Build aggregate request object
        const aggregateReq = buildStreamRequest(messages);

        // Normalize to internal format
        const internalReq = normalizeRequest(
          serviceName,
          methodName,
          aggregateReq,
          reqType,
          context
        );

        // Match rule
        const rule = rulesIndex.get(ruleKey);
        if (!rule) {
          throw mapNoRuleMatchError(serviceName, methodName);
        }

        // Get response
        const responseData = matchRuleAndGetResponse(
          rule,
          internalReq.data,
          internalReq.metadata
        );

        return formatResponse(responseData, resType);
      } catch (error: any) {
        errorLogger(
          `Connect client streaming error ${serviceName}/${methodName}:`,
          error?.message || error
        );
        throw error;
      }
    };
  }

  // Bidirectional streaming RPC: stream of requests and responses
  return async function* (
    requests: AsyncIterable<any>,
    context: ConnectContext
  ): AsyncGenerator<any> {
    try {
      // Optimization: Pre-allocate array with estimated size
      const messages: any[] = [];

      // Collect all request messages
      for await (const req of requests) {
        // Check for cancellation
        if (context.signal?.aborted) {
          break;
        }

        // Validate each message in per_message mode
        if (
          validationRuntime.active() &&
          validationRuntime.mode() === "per_message"
        ) {
          const validationError = validateRequest(reqType, req);
          if (validationError) {
            throw validationError;
          }
        }

        messages.push(req);
      }

      // Validate in aggregate mode
      if (
        validationRuntime.active() &&
        validationRuntime.mode() === "aggregate"
      ) {
        for (const msg of messages) {
          const validationError = validateRequest(reqType, msg);
          if (validationError) {
            throw validationError;
          }
        }
      }

      // Build aggregate request
      const aggregateReq = buildStreamRequest(messages);

      // Normalize to internal format
      const internalReq = normalizeRequest(
        serviceName,
        methodName,
        aggregateReq,
        reqType,
        context
      );

      // Match rule
      const rule = rulesIndex.get(ruleKey);
      if (!rule) {
        throw mapNoRuleMatchError(serviceName, methodName);
      }

      // Get streaming responses
      const responses = getStreamingResponses(
        rule,
        internalReq.data,
        internalReq.metadata
      );

      // Optimization: Pre-format all responses to avoid per-yield overhead
      const formattedResponses = responses.map(r => formatResponse(r, resType));

      // Yield each response
      for (const response of formattedResponses) {
        // Check for cancellation
        if (context.signal?.aborted) {
          break;
        }

        yield response;
      }
    } catch (error: any) {
      errorLogger(
        `Connect bidi streaming error ${serviceName}/${methodName}:`,
        error?.message || error
      );
      throw error;
    }
  };
}

/**
 * Validate request using the validation engine
 * 
 * Integrates with Wishmock's existing validation runtime to validate
 * requests against protovalidate or PGV rules.
 * 
 * @param type Message type
 * @param message Message data
 * @returns Connect error if validation fails, null otherwise
 */
function validateRequest(
  type: protobuf.Type,
  message: unknown
): ConnectError | null {
  // Skip if validation is not active
  if (!validationRuntime.active()) {
    return null;
  }

  // Get validator for this type
  const typeName = type.fullName || type.name;
  const validator = validationRuntime.getValidator(typeName);

  if (!validator) {
    // No validator for this type
    return null;
  }

  try {
    // Run validation
    const result = validator(message);

    if (!result.ok) {
      // Emit validation failure events (same as grpcServer.ts)
      try {
        const violations = (result as any)?.violations || [];
        if (Array.isArray(violations) && violations.length > 0) {
          for (const v of violations) {
            validationRuntime.emitValidationEvent({
              typeName,
              result: "failure",
              details: {
                constraint_id: v?.rule,
                grpc_status: "InvalidArgument",
                error_message: v?.description,
              },
            });
          }
        } else {
          // Fallback: emit a single failure event
          validationRuntime.emitValidationEvent({
            typeName,
            result: "failure",
            details: { grpc_status: "InvalidArgument" },
          });
        }
      } catch {}

      // Return validation error
      return mapValidationError(result);
    }

    // Emit validation success event
    try {
      validationRuntime.emitValidationEvent({
        typeName,
        result: "success",
        details: {},
      });
    } catch {}

    return null;
  } catch (ve: any) {
    // Validation engine threw an error
    return {
      code: "internal" as any,
      message: ve?.message || "validation error",
    };
  }
}

// Simple LRU cache for rule responses to reduce repeated matching overhead
// This is particularly effective for high-frequency identical requests
class ResponseCache {
  private cache = new Map<string, { response: any; timestamp: number }>();
  private maxSize = 1000;
  private ttlMs = 5000; // 5 seconds TTL

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  set(key: string, response: any): void {
    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Global response cache (shared across all handlers)
const responseCache = new ResponseCache();

/**
 * Match rule and get response
 * 
 * Matches the request against the rule configuration and returns
 * the appropriate response. Uses the same selectResponse logic as
 * the existing gRPC server.
 * 
 * Optimization: Caches responses for identical requests to reduce
 * repeated rule matching overhead.
 * 
 * @param rule Rule document
 * @param requestData Request data
 * @param metadata Request metadata
 * @returns Response data
 */
function matchRuleAndGetResponse(
  rule: RuleDoc,
  requestData: any,
  metadata: Record<string, unknown>
): any {
  // Create cache key from request data and metadata
  // Only cache if request is small enough (avoid memory issues)
  const requestStr = JSON.stringify(requestData);
  const metadataStr = JSON.stringify(metadata);
  
  if (requestStr.length < 1000 && metadataStr.length < 1000) {
    const cacheKey = `${requestStr}:${metadataStr}`;
    
    // Check cache first
    const cached = responseCache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }
    
    // Use the existing selectResponse function from domain layer
    const selected = selectResponse(rule, requestData, metadata);
    const response = selected?.body ?? {};
    
    // Cache the response
    responseCache.set(cacheKey, response);
    
    return response;
  }
  
  // For large requests, skip caching
  const selected = selectResponse(rule, requestData, metadata);
  return selected?.body ?? {};
}

/**
 * Get streaming responses from rule
 * 
 * Extracts streaming responses from rule configuration.
 * Handles both single responses (repeated) and explicit stream arrays.
 * 
 * @param rule Rule document
 * @param requestData Request data
 * @param metadata Request metadata
 * @returns Array of response data
 */
function getStreamingResponses(
  rule: RuleDoc,
  requestData: any,
  metadata: Record<string, unknown>
): any[] {
  // Use selectResponse to get the matched response option
  const selected = selectResponse(rule, requestData, metadata);

  // Check if response has stream_items array
  if (selected?.stream_items && Array.isArray(selected.stream_items)) {
    return selected.stream_items;
  }

  // Single response body - return as array
  return [selected?.body ?? {}];
}

/**
 * Build aggregate request from stream of messages
 * 
 * Combines multiple request messages into a single aggregate request.
 * This is used for client streaming and bidirectional streaming.
 * 
 * @param messages Array of request messages
 * @returns Aggregate request object
 */
function buildStreamRequest(messages: any[]): any {
  if (messages.length === 0) {
    return {};
  }

  if (messages.length === 1) {
    return messages[0];
  }

  // Combine messages into an aggregate object
  // This follows the same logic as grpcHandlerUtils.ts
  return {
    messages,
    count: messages.length,
  };
}



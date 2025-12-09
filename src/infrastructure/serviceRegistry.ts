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
import type { NormalizedRequest, NormalizedResponse, NormalizedError } from "../domain/types/normalized.js";
import {
  handleUnaryRequest,
  handleServerStreamingRequest,
  handleClientStreamingRequest,
  handleBidiStreamingRequest,
} from "../domain/usecases/handleRequest.js";
import {
  normalizeConnectUnaryRequest,
  normalizeConnectServerStreamingRequest,
  sendConnectResponse,
  sendConnectError,
  type ConnectContext,
} from "./protocolAdapter.js";
import { normalizeTypeName } from "./utils/protoUtils.js";

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
 * This is the core function that generates Connect RPC handlers. It creates a thin
 * protocol adapter that:
 * 1. Converts Connect request to normalized format (protocol-agnostic)
 * 2. Calls shared handler (validation, rule matching, response selection)
 * 3. Converts normalized response back to Connect format (protocol-specific)
 * 4. Handles all four streaming patterns (unary, server, client, bidi)
 * 
 * The handler acts as a bridge between Connect RPC's protocol-specific format
 * and Wishmock's protocol-agnostic shared handler. This ensures that the same
 * validation, rule matching, and response selection logic is used for both
 * gRPC and Connect RPC.
 * 
 * Streaming patterns:
 * - Unary: Single request → Single response (async function)
 * - Server streaming: Single request → Multiple responses (async generator)
 * - Client streaming: Multiple requests → Single response (async function with iterable)
 * - Bidirectional: Multiple requests → Multiple responses (async generator with iterable)
 * 
 * @param serviceName Full service name (e.g., "helloworld.Greeter")
 * @param methodName Method name (e.g., "SayHello")
 * @param reqType Request message type from protobuf
 * @param resType Response message type from protobuf
 * @param requestStream Whether request is streaming (client/bidi)
 * @param responseStream Whether response is streaming (server/bidi)
 * @param ruleKey Rule key for matching (e.g., "helloworld.greeter.sayhello")
 * @param rulesIndex Index of rules (shared with gRPC server)
 * @param logger Logger function for info messages
 * @param errorLogger Error logger function for error messages
 * @returns Connect method handler (function or async generator)
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
        // Step 1: Convert Connect request to normalized format
        const normalizedReq = normalizeConnectUnaryRequest(
          req,
          reqType,
          resType,
          context,
          serviceName,
          methodName
        );

        // Step 2: Call shared handler (validation, rule matching, response selection)
        const result = await handleUnaryRequest(normalizedReq, rulesIndex, logger);

        // Step 3: Convert normalized response back to Connect format
        if ('code' in result) {
          // This is an error
          throw sendConnectError(result as NormalizedError);
        }
        
        return sendConnectResponse(result as NormalizedResponse, resType, context);
      } catch (error: any) {
        errorLogger(
          `[connect] ${serviceName}/${methodName} - error:`,
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
        // Step 1: Convert Connect request to normalized format
        const normalizedReq = normalizeConnectServerStreamingRequest(
          req,
          reqType,
          resType,
          context,
          serviceName,
          methodName
        );

        // Step 2: Call shared handler (validation, rule matching, streaming)
        for await (const result of handleServerStreamingRequest(normalizedReq, rulesIndex, logger)) {
          // Check for cancellation
          if (context.signal?.aborted) {
            break;
          }

          // Step 3: Convert normalized response back to Connect format
          if ('code' in result) {
            // This is an error
            throw sendConnectError(result as NormalizedError);
          }
          
          yield sendConnectResponse(result as NormalizedResponse, resType, context);
        }
      } catch (error: any) {
        errorLogger(
          `[connect] ${serviceName}/${methodName} - error:`,
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
        // Step 1: Convert Connect request stream to normalized request stream
        async function* normalizeRequests(): AsyncGenerator<NormalizedRequest> {
          for await (const req of requests) {
            // Check for cancellation
            if (context.signal?.aborted) {
              break;
            }

            // Normalize each individual request message
            yield normalizeConnectUnaryRequest(
              req,
              reqType,
              resType,
              context,
              serviceName,
              methodName
            );
          }
        }

        // Step 2: Call shared handler (validation, aggregation, rule matching)
        const result = await handleClientStreamingRequest(
          normalizeRequests(),
          rulesIndex,
          logger
        );

        // Step 3: Convert normalized response back to Connect format
        if ('code' in result) {
          // This is an error
          throw sendConnectError(result as NormalizedError);
        }
        
        return sendConnectResponse(result as NormalizedResponse, resType, context);
      } catch (error: any) {
        errorLogger(
          `[connect] ${serviceName}/${methodName} - error:`,
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
      // Step 1: Convert Connect request stream to normalized request stream
      async function* normalizeRequests(): AsyncGenerator<NormalizedRequest> {
        for await (const req of requests) {
          // Check for cancellation
          if (context.signal?.aborted) {
            break;
          }

          // Normalize each individual request message
          yield normalizeConnectUnaryRequest(
            req,
            reqType,
            resType,
            context,
            serviceName,
            methodName
          );
        }
      }

      // Step 2: Call shared handler (validation, aggregation, rule matching, streaming)
      for await (const result of handleBidiStreamingRequest(
        normalizeRequests(),
        rulesIndex,
        logger
      )) {
        // Check for cancellation
        if (context.signal?.aborted) {
          break;
        }

        // Step 3: Convert normalized response back to Connect format
        if ('code' in result) {
          // This is an error
          throw sendConnectError(result as NormalizedError);
        }
        
        yield sendConnectResponse(result as NormalizedResponse, resType, context);
      }
    } catch (error: any) {
      errorLogger(
        `[connect] ${serviceName}/${methodName} - error:`,
        error?.message || error
      );
      throw error;
    }
  };
}


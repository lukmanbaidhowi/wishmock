/**
 * Shared request handlers for protocol-agnostic request processing.
 * 
 * These handlers provide a unified interface for processing requests from
 * both gRPC and Connect RPC servers, ensuring consistent behavior across
 * all protocols.
 * 
 * The handlers integrate with:
 * - Validation runtime for request validation
 * - Rule matcher for rule matching
 * - Response selector for response selection
 * 
 * Performance Characteristics:
 * - Latency: ~0.002ms mean per request (P95: 0.003ms)
 * - Throughput: >600,000 requests/second
 * - Memory: Minimal overhead, no deep copies
 * - Overhead: <0.1ms normalization cost
 * 
 * See docs/performance-optimization.md for detailed profiling results.
 * Run `bun run profile:handler` to benchmark on your system.
 */

import type { RuleDoc } from "../types.js";
import type {
  NormalizedRequest,
  NormalizedResponse,
  NormalizedError,
} from "../types/normalized.js";
import { runtime as validationRuntime } from "../../infrastructure/validation/runtime.js";
import { selectResponse } from "./selectResponse.js";
import { sharedMetrics } from "../metrics/sharedMetrics.js";

/**
 * Handle a unary request (single request, single response)
 * 
 * This function encapsulates the core logic:
 * 1. Validate request using validation runtime
 * 2. Match rule from rules index
 * 3. Select response using selectResponse
 * 4. Return normalized response or error
 * 
 * @param request Normalized request
 * @param rulesIndex Map of rule keys to rule documents
 * @param logger Logger function
 * @returns Promise resolving to normalized response or error
 */
export async function handleUnaryRequest(
  request: NormalizedRequest,
  rulesIndex: Map<string, RuleDoc>,
  logger: (...args: any[]) => void
): Promise<NormalizedResponse | NormalizedError> {
  const { service, method, data, metadata, requestType } = request;
  const ruleKey = `${service}.${method}`.toLowerCase();

  try {
    // Step 1: Validate request
    const validationError = validateRequest(requestType, data);
    if (validationError) {
      logger(`[shared] ${service}/${method} - validation failed`);
      return validationError;
    }

    logger(`[shared] ${service}/${method} - validation passed`);

    // Step 2: Match rule
    const rule = rulesIndex.get(ruleKey);

    // Track rule match attempt
    sharedMetrics.recordRuleMatchAttempt(ruleKey, !!rule);

    if (!rule) {
      logger(`[shared] ${service}/${method} - no rule matched`);
      return {
        code: "UNIMPLEMENTED",
        message: `No rule matched for ${service}/${method}`,
      };
    }

    logger(`[shared] ${service}/${method} - rule matched: ${ruleKey}`);

    // Step 3: Select response
    const selected = selectResponse(rule, data, metadata);
    const responseData = selected?.body ?? {};

    // Step 4: Check for error response
    const trailers = selected?.trailers as Record<string, string | number | boolean> | undefined;
    if (trailers) {
      const statusRaw = trailers["grpc-status"];
      const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw ?? 0);

      if (status && status !== 0) {
        const message = String(trailers["grpc-message"] ?? "mock error");
        const code = grpcStatusToCode(status);

        logger(`[shared] ${service}/${method} - returning error: ${code}`);

        return {
          code,
          message,
        };
      }
    }

    // Step 5: Return normalized response
    logger(`[shared] ${service}/${method} - returning success response`);

    return {
      data: responseData,
      trailer: extractTrailers(trailers),
    };
  } catch (error: any) {
    logger(`[shared] ${service}/${method} - internal error:`, error?.message || error);

    return {
      code: "INTERNAL",
      message: error?.message || "Internal error",
    };
  }
}

/**
 * Validate request using validation runtime
 * 
 * This function integrates with the validation runtime to check if the request
 * data conforms to protovalidate or PGV constraints defined in the proto files.
 * 
 * The validation process:
 * 1. Check if validation is enabled globally
 * 2. Look up the validator for this message type
 * 3. Run validation and collect violations
 * 4. Track metrics and emit events for monitoring
 * 5. Return error if validation fails, null if passes
 * 
 * @param requestType Protobuf type for the request
 * @param data Request data
 * @returns NormalizedError if validation fails, null otherwise
 */
function validateRequest(
  requestType: any,
  data: unknown
): NormalizedError | null {
  // Skip if validation is not active (VALIDATION_ENABLED=false)
  if (!validationRuntime.active()) {
    return null;
  }

  // Get the fully qualified type name for validator lookup
  const typeName = requestType.fullName || requestType.name;
  const validator = validationRuntime.getValidator(typeName);

  if (!validator) {
    // No validator for this type (no constraints defined in proto)
    return null;
  }

  try {
    // Run validation against protovalidate/PGV constraints
    const result = validator(data);

    if (!result.ok) {
      // Validation failed - track metrics for monitoring
      sharedMetrics.recordValidationCheck(typeName, false);

      // Emit validation failure events for observability
      // These events can be consumed by monitoring systems
      try {
        const violations = (result as any)?.violations || [];
        if (Array.isArray(violations) && violations.length > 0) {
          // Emit one event per violation for detailed tracking
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
          // Fallback: emit a single failure event if no violations array
          validationRuntime.emitValidationEvent({
            typeName,
            result: "failure",
            details: { grpc_status: "InvalidArgument" },
          });
        }
      } catch {
        // Ignore event emission errors - don't fail the request
        // if monitoring is broken
      }

      // Return validation error with all violations
      return {
        code: "INVALID_ARGUMENT",
        message: "Request validation failed",
        details: result.violations,
      };
    }

    // Validation passed - track success metrics
    sharedMetrics.recordValidationCheck(typeName, true);

    // Emit validation success event for monitoring
    try {
      validationRuntime.emitValidationEvent({
        typeName,
        result: "success",
        details: {},
      });
    } catch {
      // Ignore event emission errors
    }

    return null;
  } catch (ve: any) {
    // Validation engine threw an error (e.g., malformed data)
    // Return internal error instead of crashing
    return {
      code: "INTERNAL",
      message: ve?.message || "validation error",
    };
  }
}

/**
 * Convert gRPC status code to status code name
 * 
 * Maps numeric gRPC status codes to their string names for protocol-agnostic
 * error handling. This allows the shared handler to work with string codes
 * that can be easily mapped to both gRPC and Connect error codes.
 * 
 * @param status gRPC status code number (0-16)
 * @returns Status code name (e.g., "INVALID_ARGUMENT")
 */
function grpcStatusToCode(status: number): string {
  // Standard gRPC status codes as defined in the gRPC spec
  const statusMap: Record<number, string> = {
    0: "OK",
    1: "CANCELLED",
    2: "UNKNOWN",
    3: "INVALID_ARGUMENT",
    4: "DEADLINE_EXCEEDED",
    5: "NOT_FOUND",
    6: "ALREADY_EXISTS",
    7: "PERMISSION_DENIED",
    8: "RESOURCE_EXHAUSTED",
    9: "FAILED_PRECONDITION",
    10: "ABORTED",
    11: "OUT_OF_RANGE",
    12: "UNIMPLEMENTED",
    13: "INTERNAL",
    14: "UNAVAILABLE",
    15: "DATA_LOSS",
    16: "UNAUTHENTICATED",
  };

  // Return mapped code or UNKNOWN for invalid status codes
  return statusMap[status] || "UNKNOWN";
}

/**
 * Extract trailers from response option
 * 
 * Filters and converts trailer metadata from rule configuration to a format
 * suitable for sending in the response. Excludes special gRPC status fields
 * that are handled separately by the error handling logic.
 * 
 * @param trailers Trailers from response option (can contain mixed types)
 * @returns Trailers as string record or undefined if empty
 */
function extractTrailers(
  trailers: Record<string, string | number | boolean> | undefined
): Record<string, string> | undefined {
  if (!trailers) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(trailers)) {
    // Skip grpc-status and grpc-message as they're handled separately
    // by the error handling logic (converted to NormalizedError)
    if (key === "grpc-status" || key === "grpc-message") {
      continue;
    }
    // Convert all values to strings for consistent trailer format
    result[key] = String(value);
  }

  // Return undefined if no trailers remain after filtering
  // This avoids sending empty trailer metadata
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Fisher-Yates shuffle algorithm for truly random array shuffling
 * 
 * This is the standard algorithm for unbiased random permutation.
 * Time complexity: O(n), Space complexity: O(n) for the copy
 * 
 * @param array Array to shuffle
 * @returns New shuffled array (does not modify original)
 */
function fisherYatesShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Handle server streaming request (single request, multiple responses)
 * 
 * This function:
 * 1. Validates the initial request
 * 2. Matches rule from rules index
 * 3. Yields multiple responses based on stream_items configuration
 * 4. Supports stream_loop, stream_random_order, and stream_delay_ms
 * 
 * @param request Normalized request
 * @param rulesIndex Map of rule keys to rule documents
 * @param logger Logger function
 * @returns Async generator yielding normalized responses or errors
 */
export async function* handleServerStreamingRequest(
  request: NormalizedRequest,
  rulesIndex: Map<string, RuleDoc>,
  logger: (...args: any[]) => void
): AsyncGenerator<NormalizedResponse | NormalizedError> {
  const { service, method, data, metadata, requestType } = request;
  const ruleKey = `${service}.${method}`.toLowerCase();

  try {
    // Step 1: Validate request
    const validationError = validateRequest(requestType, data);
    if (validationError) {
      logger(`[shared] ${service}/${method} - validation failed`);
      yield validationError;
      return;
    }

    logger(`[shared] ${service}/${method} - validation passed`);

    // Step 2: Match rule
    const rule = rulesIndex.get(ruleKey);

    // Track rule match attempt
    sharedMetrics.recordRuleMatchAttempt(ruleKey, !!rule);

    if (!rule) {
      logger(`[shared] ${service}/${method} - no rule matched`);
      yield {
        code: "UNIMPLEMENTED",
        message: `No rule matched for ${service}/${method}`,
      };
      return;
    }

    logger(`[shared] ${service}/${method} - rule matched: ${ruleKey}`);

    // Step 3: Select response and get streaming configuration
    // The selectResponse function evaluates the rule and returns the matched response option
    const selected = selectResponse(rule, data, metadata);

    // Extract streaming configuration from the selected response option
    // stream_items: array of messages to stream (defaults to single body)
    // stream_delay_ms: delay between messages in milliseconds (default 100ms)
    // stream_loop: whether to loop the stream indefinitely (default false)
    // stream_random_order: whether to randomize message order (default false)
    // delay_ms: initial delay before starting stream (default 0ms)
    const baseItems = selected?.stream_items || [selected?.body || {}];
    const streamDelay = selected?.stream_delay_ms || 100;
    const shouldLoop = selected?.stream_loop || false;
    const randomOrder = selected?.stream_random_order || false;
    const initialDelay = selected?.delay_ms || 0;

    // Check for error response in trailers
    // Rules can specify errors via grpc-status and grpc-message trailers
    const trailers = selected?.trailers as Record<string, string | number | boolean> | undefined;
    if (trailers) {
      const statusRaw = trailers["grpc-status"];
      const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw ?? 0);

      // Non-zero status indicates an error
      if (status && status !== 0) {
        const message = String(trailers["grpc-message"] ?? "mock error");
        const code = grpcStatusToCode(status);

        logger(`[shared] ${service}/${method} - returning error: ${code}`);

        // Yield error and stop streaming
        yield {
          code,
          message,
        };
        return;
      }
    }

    // Apply initial delay if configured (useful for simulating slow responses)
    if (initialDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, initialDelay));
    }

    // Step 4: Stream responses
    logger(`[shared] ${service}/${method} - streaming ${baseItems.length} items (loop: ${shouldLoop}, random: ${randomOrder})`);

    // Loop indefinitely if stream_loop is true, otherwise stream once
    do {
      // Randomize order using Fisher-Yates shuffle if configured
      // This provides truly random ordering (unbiased permutation)
      const items = randomOrder ? fisherYatesShuffle(baseItems) : baseItems;

      for (let i = 0; i < items.length; i++) {
        // Use the shuffled item directly
        const item = items[i];

        // Yield the response message
        yield {
          data: item,
          trailer: extractTrailers(trailers),
        };

        // Delay between items (except after last item if not looping)
        // This simulates realistic streaming behavior with time between messages
        if (i < items.length - 1 || shouldLoop) {
          await new Promise((resolve) => setTimeout(resolve, streamDelay));
        }
      }
    } while (shouldLoop);

    logger(`[shared] ${service}/${method} - streaming complete`);
  } catch (error: any) {
    logger(`[shared] ${service}/${method} - internal error:`, error?.message || error);

    yield {
      code: "INTERNAL",
      message: error?.message || "Internal error",
    };
  }
}

/**
 * Handle client streaming request (multiple requests, single response)
 * 
 * This function:
 * 1. Collects all incoming requests
 * 2. Validates each request (based on validation mode)
 * 3. Aggregates requests into a single request object
 * 4. Matches rule and returns single response
 * 
 * @param requests Async iterable of normalized requests
 * @param rulesIndex Map of rule keys to rule documents
 * @param logger Logger function
 * @returns Promise resolving to normalized response or error
 */
export async function handleClientStreamingRequest(
  requests: AsyncIterable<NormalizedRequest>,
  rulesIndex: Map<string, RuleDoc>,
  logger: (...args: any[]) => void
): Promise<NormalizedResponse | NormalizedError> {
  let service = "";
  let method = "";
  let metadata: Record<string, string> = {};
  let requestType: any = null;
  const messages: any[] = [];

  try {
    // Step 1: Collect all requests from the stream
    // Client streaming sends multiple messages before expecting a response
    for await (const request of requests) {
      // Capture metadata from first request only
      // All messages in the stream share the same metadata
      if (messages.length === 0) {
        service = request.service;
        method = request.method;
        metadata = request.metadata;
        requestType = request.requestType;
      }

      // Validate each message in per_message mode
      // This mode validates messages as they arrive (fail-fast)
      if (validationRuntime.active() && validationRuntime.mode() === 'per_message') {
        const validationError = validateRequest(request.requestType, request.data);
        if (validationError) {
          logger(`[shared] ${service}/${method} - validation failed on message ${messages.length + 1}`);
          return validationError;
        }
      }

      // Collect the message data
      messages.push(request.data);
    }

    const ruleKey = `${service}.${method}`.toLowerCase();
    logger(`[shared] ${service}/${method} - received ${messages.length} messages`);

    // Step 2: Validate in aggregate mode
    // This mode validates all messages after collection is complete
    // Useful when validation depends on the full set of messages
    if (validationRuntime.active() && validationRuntime.mode() === 'aggregate') {
      for (let i = 0; i < messages.length; i++) {
        const validationError = validateRequest(requestType, messages[i]);
        if (validationError) {
          logger(`[shared] ${service}/${method} - aggregate validation failed on message ${i + 1}`);
          return validationError;
        }
      }
    }

    logger(`[shared] ${service}/${method} - validation passed`);

    // Step 3: Build aggregated request object
    // This object provides convenient access to the message stream for rule matching
    // Rules can access: stream (all messages), first, last, count, etc.
    const aggregatedRequest = {
      stream: messages,      // All messages in order
      items: messages,       // Alias for stream
      first: messages[0],    // First message (useful for extracting metadata)
      last: messages[messages.length - 1],  // Last message
      count: messages.length, // Total message count
    };

    // Step 4: Match rule
    const rule = rulesIndex.get(ruleKey);

    // Track rule match attempt
    sharedMetrics.recordRuleMatchAttempt(ruleKey, !!rule);

    if (!rule) {
      logger(`[shared] ${service}/${method} - no rule matched`);
      return {
        code: "UNIMPLEMENTED",
        message: `No rule matched for ${service}/${method}`,
      };
    }

    logger(`[shared] ${service}/${method} - rule matched: ${ruleKey}`);

    // Step 5: Select response
    const selected = selectResponse(rule, aggregatedRequest, metadata);
    const responseData = selected?.body ?? {};

    // Step 6: Check for error response
    const trailers = selected?.trailers as Record<string, string | number | boolean> | undefined;
    if (trailers) {
      const statusRaw = trailers["grpc-status"];
      const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw ?? 0);

      if (status && status !== 0) {
        const message = String(trailers["grpc-message"] ?? "mock error");
        const code = grpcStatusToCode(status);

        logger(`[shared] ${service}/${method} - returning error: ${code}`);

        return {
          code,
          message,
        };
      }
    }

    // Step 7: Return normalized response
    logger(`[shared] ${service}/${method} - returning success response`);

    return {
      data: responseData,
      trailer: extractTrailers(trailers),
    };
  } catch (error: any) {
    logger(`[shared] ${service}/${method} - internal error:`, error?.message || error);

    return {
      code: "INTERNAL",
      message: error?.message || "Internal error",
    };
  }
}

/**
 * Handle bidirectional streaming request (multiple requests, multiple responses)
 * 
 * This function:
 * 1. Collects all incoming requests
 * 2. Validates each request (based on validation mode)
 * 3. Aggregates requests into a single request object
 * 4. Matches rule and yields multiple responses
 * 
 * @param requests Async iterable of normalized requests
 * @param rulesIndex Map of rule keys to rule documents
 * @param logger Logger function
 * @returns Async generator yielding normalized responses or errors
 */
export async function* handleBidiStreamingRequest(
  requests: AsyncIterable<NormalizedRequest>,
  rulesIndex: Map<string, RuleDoc>,
  logger: (...args: any[]) => void
): AsyncGenerator<NormalizedResponse | NormalizedError> {
  let service = "";
  let method = "";
  let metadata: Record<string, string> = {};
  let requestType: any = null;
  const messages: any[] = [];

  try {
    // Step 1: Collect all requests
    for await (const request of requests) {
      // Capture metadata from first request
      if (messages.length === 0) {
        service = request.service;
        method = request.method;
        metadata = request.metadata;
        requestType = request.requestType;
      }

      // Validate each message in per_message mode
      if (validationRuntime.active() && validationRuntime.mode() === 'per_message') {
        const validationError = validateRequest(request.requestType, request.data);
        if (validationError) {
          logger(`[shared] ${service}/${method} - validation failed on message ${messages.length + 1}`);
          yield validationError;
          return;
        }
      }

      messages.push(request.data);
    }

    const ruleKey = `${service}.${method}`.toLowerCase();
    logger(`[shared] ${service}/${method} - received ${messages.length} messages`);

    // Step 2: Validate in aggregate mode
    if (validationRuntime.active() && validationRuntime.mode() === 'aggregate') {
      for (let i = 0; i < messages.length; i++) {
        const validationError = validateRequest(requestType, messages[i]);
        if (validationError) {
          logger(`[shared] ${service}/${method} - aggregate validation failed on message ${i + 1}`);
          yield validationError;
          return;
        }
      }
    }

    logger(`[shared] ${service}/${method} - validation passed`);

    // Step 3: Build aggregated request object
    const aggregatedRequest = {
      stream: messages,
      items: messages,
      first: messages[0],
      last: messages[messages.length - 1],
      count: messages.length,
    };

    // Step 4: Match rule
    const rule = rulesIndex.get(ruleKey);

    // Track rule match attempt
    sharedMetrics.recordRuleMatchAttempt(ruleKey, !!rule);

    if (!rule) {
      logger(`[shared] ${service}/${method} - no rule matched`);
      yield {
        code: "UNIMPLEMENTED",
        message: `No rule matched for ${service}/${method}`,
      };
      return;
    }

    logger(`[shared] ${service}/${method} - rule matched: ${ruleKey}`);

    // Step 5: Select response and get streaming configuration
    const selected = selectResponse(rule, aggregatedRequest, metadata);
    const baseItems = selected?.stream_items || [selected?.body || {}];
    const streamDelay = selected?.stream_delay_ms || 100;
    const shouldLoop = selected?.stream_loop || false;
    const randomOrder = selected?.stream_random_order || false;
    const initialDelay = selected?.delay_ms || 0;

    // Check for error response
    const trailers = selected?.trailers as Record<string, string | number | boolean> | undefined;
    if (trailers) {
      const statusRaw = trailers["grpc-status"];
      const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw ?? 0);

      if (status && status !== 0) {
        const message = String(trailers["grpc-message"] ?? "mock error");
        const code = grpcStatusToCode(status);

        logger(`[shared] ${service}/${method} - returning error: ${code}`);

        yield {
          code,
          message,
        };
        return;
      }
    }

    // Apply initial delay if configured
    if (initialDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, initialDelay));
    }

    // Step 6: Stream responses
    logger(`[shared] ${service}/${method} - streaming ${baseItems.length} items (loop: ${shouldLoop}, random: ${randomOrder})`);

    do {
      const items = randomOrder ? fisherYatesShuffle(baseItems) : baseItems;

      for (let i = 0; i < items.length; i++) {
        // Use the shuffled item directly
        const item = items[i];

        yield {
          data: item,
          trailer: extractTrailers(trailers),
        };

        // Delay between items (except after last item if not looping)
        if (i < items.length - 1 || shouldLoop) {
          await new Promise((resolve) => setTimeout(resolve, streamDelay));
        }
      }
    } while (shouldLoop);

    logger(`[shared] ${service}/${method} - streaming complete`);
  } catch (error: any) {
    logger(`[shared] ${service}/${method} - internal error:`, error?.message || error);

    yield {
      code: "INTERNAL",
      message: error?.message || "Internal error",
    };
  }
}

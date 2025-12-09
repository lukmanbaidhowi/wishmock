/**
 * Protocol Adapter for Connect RPC and gRPC
 * 
 * This module provides utilities to convert between protocol-specific formats
 * and Wishmock's normalized request/response format. It handles:
 * - Metadata extraction from Connect context and gRPC metadata
 * - Request normalization to internal format
 * - Response formatting to protocol-specific format
 * - Error mapping between validation/rule errors and protocol error codes
 */

import protobuf from "protobufjs";
import type { IncomingHttpHeaders } from "node:http";
import * as grpc from "@grpc/grpc-js";
import type { NormalizedRequest, NormalizedResponse, NormalizedError } from "../domain/types/normalized.js";

/**
 * Connect RPC context containing request metadata and protocol information
 */
export interface ConnectContext {
  /** Request headers (metadata) */
  requestHeader: IncomingHttpHeaders;
  
  /** Response headers to send back */
  responseHeader: Record<string, string>;
  
  /** Response trailer metadata */
  responseTrailer: Record<string, string>;
  
  /** Protocol being used (connect, grpc-web, or grpc) */
  protocol: 'connect' | 'grpc-web' | 'grpc';
  
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Internal request format used by Wishmock
 */
export interface InternalRequest {
  /** Service name (e.g., "helloworld.Greeter") */
  service: string;
  
  /** Method name (e.g., "SayHello") */
  method: string;
  
  /** Request metadata for rule matching */
  metadata: Record<string, unknown>;
  
  /** Parsed request data */
  data: any;
  
  /** Original Connect context */
  context: ConnectContext;
}

/**
 * Internal response format used by Wishmock
 */
export interface InternalResponse {
  /** Response data */
  data: any;
  
  /** Optional metadata to send back */
  metadata?: Record<string, string>;
  
  /** Optional trailer metadata */
  trailer?: Record<string, string>;
  
  /** Optional delay before sending response */
  delayMs?: number;
}

/**
 * Connect error codes that map to gRPC status codes
 */
export enum ConnectErrorCode {
  Canceled = 'canceled',
  Unknown = 'unknown',
  InvalidArgument = 'invalid_argument',
  DeadlineExceeded = 'deadline_exceeded',
  NotFound = 'not_found',
  AlreadyExists = 'already_exists',
  PermissionDenied = 'permission_denied',
  ResourceExhausted = 'resource_exhausted',
  FailedPrecondition = 'failed_precondition',
  Aborted = 'aborted',
  OutOfRange = 'out_of_range',
  Unimplemented = 'unimplemented',
  Internal = 'internal',
  Unavailable = 'unavailable',
  DataLoss = 'data_loss',
  Unauthenticated = 'unauthenticated',
}

/**
 * Connect error structure
 */
export interface ConnectError {
  code: ConnectErrorCode;
  message: string;
  details?: any[];
}

/**
 * Extract metadata from Connect context headers
 * 
 * Converts HTTP headers from a Connect RPC request to a normalized metadata record
 * suitable for rule matching. This function bridges the gap between HTTP headers
 * and gRPC-style metadata.
 * 
 * The function handles:
 * - Standard HTTP headers (content-type, authorization, etc.)
 * - Connect-specific headers (connect-protocol-version, connect-timeout-ms)
 * - Custom application headers
 * - Multi-value headers (joined with comma separator)
 * 
 * Optimizations:
 * - Pre-allocate object with Object.create(null) for faster property access
 * - Skip pseudo-headers (starting with ':') using fast character code check
 * - Avoid unnecessary string conversions for single-value arrays
 * - Fast path for common cases
 * 
 * @param context Connect RPC context containing request headers
 * @returns Metadata record with lowercase keys and string values
 */
export function extractMetadata(context: ConnectContext): Record<string, string> {
  const headers = context.requestHeader;
  
  if (!headers) {
    return {};
  }
  
  // Pre-allocate with Object.create(null) for better performance
  // This creates an object without prototype, making property access faster
  const metadata: Record<string, string> = Object.create(null);
  
  // Extract all headers as metadata
  for (const key in headers) {
    // Skip pseudo-headers (HTTP/2 headers starting with ':')
    // These are protocol-level headers like :method, :path, :authority
    // Fast check using character code (58 = ':')
    if (key.charCodeAt(0) === 58) {
      continue;
    }
    
    const value = headers[key];
    
    // Skip undefined values (shouldn't happen but defensive check)
    if (value === undefined) {
      continue;
    }
    
    // Convert header name to lowercase for consistency
    // gRPC metadata is case-insensitive, so we normalize to lowercase
    const normalizedKey = key.toLowerCase();
    
    // Handle array values (multiple headers with same name)
    // Example: multiple "cookie" headers should be joined
    if (Array.isArray(value)) {
      // Optimization: avoid join for single-element arrays
      metadata[normalizedKey] = value.length === 1 ? String(value[0]) : value.join(', ');
    } else {
      metadata[normalizedKey] = String(value);
    }
  }
  
  // Extract Connect-specific metadata (only if present)
  // These are added as synthetic metadata for rule matching
  if (context.protocol) {
    metadata['x-connect-protocol'] = context.protocol;
  }
  
  if (context.timeoutMs) {
    metadata['connect-timeout-ms'] = String(context.timeoutMs);
  }
  
  return metadata;
}

// Cache for protobuf conversion options to avoid recreating on every request
const PROTOBUF_TO_OBJECT_OPTIONS = {
  longs: String,
  enums: String,
  bytes: String,
  defaults: false,
  arrays: true,
  objects: true,
  oneofs: true,
} as const;

/**
 * Check if an object needs protobuf normalization
 * 
 * Determines whether a plain JavaScript object needs to be converted through
 * protobuf's fromObject/toObject cycle to ensure proper field defaults.
 * 
 * This is an optimization to avoid unnecessary conversions. We only normalize when:
 * - The object has repeated fields that are missing (should default to [])
 * - The object might have other protobuf-specific requirements
 * 
 * For simple objects with all fields present, we can skip normalization and use
 * the object directly, which is much faster.
 * 
 * @param obj Plain JavaScript object to check
 * @param type Protobuf message type definition
 * @returns true if normalization is needed, false if object can be used as-is
 */
function needsNormalization(obj: any, type: protobuf.Type): boolean {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  // Check if any repeated fields are missing (they should default to [])
  // Protobuf repeated fields must always be arrays, never undefined
  for (const field of type.fieldsArray) {
    if (field.repeated && !(field.name in obj)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize Connect request to internal format (legacy)
 * 
 * @deprecated Use normalizeConnectRequest instead
 * 
 * Converts a Connect RPC request to Wishmock's internal request format
 * for rule matching and validation.
 * 
 * Optimizations:
 * - Cached conversion options
 * - Skip unnecessary conversions for simple objects
 * - Fast path for binary data
 * - Smart detection of when normalization is needed
 * 
 * @param service Service name (e.g., "helloworld.Greeter")
 * @param method Method name (e.g., "SayHello")
 * @param req Connect request data
 * @param requestType Protobuf message type for the request
 * @param context Connect RPC context
 * @returns Internal request format
 */
export function normalizeRequest(
  service: string,
  method: string,
  req: any,
  requestType: protobuf.Type,
  context: ConnectContext
): InternalRequest {
  // Extract metadata from context (lazy evaluation)
  const metadata = extractMetadata(context);
  
  // Parse request data - Connect may send plain objects or buffers
  let data: any;
  
  if (Buffer.isBuffer(req)) {
    // Binary format - decode using protobuf (fast path)
    data = requestType.decode(req);
  } else if (req && typeof req === 'object') {
    // JSON format or already parsed
    // Check if normalization is needed (for repeated fields, etc.)
    if (needsNormalization(req, requestType)) {
      // Need to normalize to ensure repeated fields default to []
      try {
        const message = requestType.fromObject(req);
        data = requestType.toObject(message, PROTOBUF_TO_OBJECT_OPTIONS);
      } catch (e) {
        // If conversion fails, use the raw object
        data = req;
      }
    } else {
      // Optimization: Skip conversion for simple objects
      data = req;
    }
  } else {
    // Fallback for other types
    data = req;
  }
  
  return {
    service,
    method,
    metadata,
    data,
    context,
  };
}

/**
 * Normalize Connect unary request to NormalizedRequest format
 * 
 * Converts a Connect RPC unary request to the protocol-agnostic normalized format.
 * 
 * @param req Connect request data
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param context Connect RPC context
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request
 */
export function normalizeConnectUnaryRequest(
  req: any,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  context: ConnectContext,
  service: string,
  method: string
): NormalizedRequest {
  // Extract metadata from context
  const metadata = extractMetadata(context);
  
  // Parse request data - Connect may send plain objects or buffers
  let data: any;
  
  if (Buffer.isBuffer(req)) {
    // Binary format - decode using protobuf (fast path)
    data = requestType.decode(req);
  } else if (req && typeof req === 'object') {
    // JSON format or already parsed
    // Check if normalization is needed (for repeated fields, etc.)
    if (needsNormalization(req, requestType)) {
      // Need to normalize to ensure repeated fields default to []
      try {
        const message = requestType.fromObject(req);
        data = requestType.toObject(message, PROTOBUF_TO_OBJECT_OPTIONS);
      } catch (e) {
        // If conversion fails, use the raw object
        data = req;
      }
    } else {
      // Optimization: Skip conversion for simple objects
      data = req;
    }
  } else {
    // Fallback for other types
    data = req;
  }
  
  return {
    service,
    method,
    metadata,
    data,
    requestType,
    responseType,
    requestStream: false,
    responseStream: false,
  };
}

/**
 * Normalize Connect server streaming request to NormalizedRequest format
 * 
 * Converts a Connect RPC server streaming request to the protocol-agnostic normalized format.
 * 
 * @param req Connect request data
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param context Connect RPC context
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request
 */
export function normalizeConnectServerStreamingRequest(
  req: any,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  context: ConnectContext,
  service: string,
  method: string
): NormalizedRequest {
  // Extract metadata from context
  const metadata = extractMetadata(context);
  
  // Parse request data
  let data: any;
  
  if (Buffer.isBuffer(req)) {
    data = requestType.decode(req);
  } else if (req && typeof req === 'object') {
    if (needsNormalization(req, requestType)) {
      try {
        const message = requestType.fromObject(req);
        data = requestType.toObject(message, PROTOBUF_TO_OBJECT_OPTIONS);
      } catch (e) {
        data = req;
      }
    } else {
      data = req;
    }
  } else {
    data = req;
  }
  
  return {
    service,
    method,
    metadata,
    data,
    requestType,
    responseType,
    requestStream: false,
    responseStream: true,
  };
}

/**
 * Normalize Connect client streaming request to NormalizedRequest format
 * 
 * Converts a Connect RPC client streaming request to the protocol-agnostic normalized format.
 * Note: The data field will be populated as messages arrive on the stream.
 * 
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param context Connect RPC context
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request (data will be stream of messages)
 */
export function normalizeConnectClientStreamingRequest(
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  context: ConnectContext,
  service: string,
  method: string
): NormalizedRequest {
  // Extract metadata from context
  const metadata = extractMetadata(context);
  
  return {
    service,
    method,
    metadata,
    data: null, // Will be populated by stream handler
    requestType,
    responseType,
    requestStream: true,
    responseStream: false,
  };
}

/**
 * Normalize Connect bidirectional streaming request to NormalizedRequest format
 * 
 * Converts a Connect RPC bidirectional streaming request to the protocol-agnostic normalized format.
 * Note: The data field will be populated as messages arrive on the stream.
 * 
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param context Connect RPC context
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request (data will be stream of messages)
 */
export function normalizeConnectBidiStreamingRequest(
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  context: ConnectContext,
  service: string,
  method: string
): NormalizedRequest {
  // Extract metadata from context
  const metadata = extractMetadata(context);
  
  return {
    service,
    method,
    metadata,
    data: null, // Will be populated by stream handler
    requestType,
    responseType,
    requestStream: true,
    responseStream: true,
  };
}

/**
 * Generic function to normalize any Connect request to NormalizedRequest format
 * 
 * Automatically detects the streaming pattern and calls the appropriate
 * normalization function.
 * 
 * @param req Connect request data (null for client/bidi streaming)
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param context Connect RPC context
 * @param service Fully qualified service name
 * @param method Method name
 * @param requestStream Whether this is a client streaming request
 * @param responseStream Whether this is a server streaming response
 * @returns Normalized request
 */
export function normalizeConnectRequest(
  req: any,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  context: ConnectContext,
  service: string,
  method: string,
  requestStream: boolean,
  responseStream: boolean
): NormalizedRequest {
  // Unary (no streaming)
  if (!requestStream && !responseStream) {
    return normalizeConnectUnaryRequest(
      req,
      requestType,
      responseType,
      context,
      service,
      method
    );
  }
  
  // Server streaming
  if (!requestStream && responseStream) {
    return normalizeConnectServerStreamingRequest(
      req,
      requestType,
      responseType,
      context,
      service,
      method
    );
  }
  
  // Client streaming
  if (requestStream && !responseStream) {
    return normalizeConnectClientStreamingRequest(
      requestType,
      responseType,
      context,
      service,
      method
    );
  }
  
  // Bidirectional streaming
  return normalizeConnectBidiStreamingRequest(
    requestType,
    responseType,
    context,
    service,
    method
  );
}

/**
 * Format internal response to Connect protocol
 * 
 * Converts Wishmock's internal response format to a format suitable
 * for sending via Connect RPC.
 * 
 * Optimizations:
 * - Skip unnecessary conversions for simple objects
 * - Fast path for buffers
 * - Smart detection of when normalization is needed
 * 
 * @param response Internal response data
 * @param responseType Protobuf message type for the response
 * @returns Formatted response ready to send
 */
export function formatResponse(
  response: any,
  responseType: protobuf.Type
): any {
  if (!response) {
    // Return empty message if no response
    return responseType.create({});
  }
  
  // If response is already a protobuf message, return as-is
  if (response instanceof responseType.ctor) {
    return response;
  }
  
  // If response is a buffer, decode it (fast path)
  if (Buffer.isBuffer(response)) {
    return responseType.decode(response);
  }
  
  // For plain objects, check if normalization is needed
  if (response && typeof response === 'object') {
    // Check if normalization is needed (for repeated fields, etc.)
    if (needsNormalization(response, responseType)) {
      // Need to normalize to ensure repeated fields default to []
      try {
        const message = responseType.fromObject(response);
        return responseType.toObject(message, PROTOBUF_TO_OBJECT_OPTIONS);
      } catch (e) {
        // If conversion fails, return the raw response
        return response;
      }
    } else {
      // Optimization: Return as-is for simple objects
      return response;
    }
  }
  
  // Fallback: create empty message
  return responseType.create({});
}

// ============================================================================
// Connect Response Conversion Functions
// ============================================================================

/**
 * Map normalized error code to Connect error code
 * 
 * Converts protocol-agnostic error code names to Connect error code strings.
 * 
 * @param code Normalized error code (e.g., "INVALID_ARGUMENT")
 * @returns Connect error code string
 */
export function mapNormalizedErrorCodeToConnect(code: string): ConnectErrorCode {
  const codeMap: Record<string, ConnectErrorCode> = {
    "OK": ConnectErrorCode.Canceled, // OK is not an error, map to canceled as fallback
    "CANCELLED": ConnectErrorCode.Canceled,
    "UNKNOWN": ConnectErrorCode.Unknown,
    "INVALID_ARGUMENT": ConnectErrorCode.InvalidArgument,
    "DEADLINE_EXCEEDED": ConnectErrorCode.DeadlineExceeded,
    "NOT_FOUND": ConnectErrorCode.NotFound,
    "ALREADY_EXISTS": ConnectErrorCode.AlreadyExists,
    "PERMISSION_DENIED": ConnectErrorCode.PermissionDenied,
    "RESOURCE_EXHAUSTED": ConnectErrorCode.ResourceExhausted,
    "FAILED_PRECONDITION": ConnectErrorCode.FailedPrecondition,
    "ABORTED": ConnectErrorCode.Aborted,
    "OUT_OF_RANGE": ConnectErrorCode.OutOfRange,
    "UNIMPLEMENTED": ConnectErrorCode.Unimplemented,
    "INTERNAL": ConnectErrorCode.Internal,
    "UNAVAILABLE": ConnectErrorCode.Unavailable,
    "DATA_LOSS": ConnectErrorCode.DataLoss,
    "UNAUTHENTICATED": ConnectErrorCode.Unauthenticated,
  };
  
  return codeMap[code] ?? ConnectErrorCode.Unknown;
}

/**
 * Send normalized response via Connect RPC
 * 
 * Converts a NormalizedResponse to Connect format and returns it.
 * Handles metadata and formats the response data properly.
 * 
 * @param response Normalized response to send
 * @param responseType Protobuf message type for the response
 * @param context Connect RPC context (for setting response headers)
 * @returns Formatted response ready to send via Connect
 */
export function sendConnectResponse(
  response: NormalizedResponse,
  responseType: protobuf.Type,
  context?: ConnectContext
): any {
  // Set response metadata if provided
  if (response.metadata && context) {
    for (const [key, value] of Object.entries(response.metadata)) {
      context.responseHeader[key] = value;
    }
  }
  
  // Set response trailer if provided
  if (response.trailer && context) {
    for (const [key, value] of Object.entries(response.trailer)) {
      context.responseTrailer[key] = value;
    }
  }
  
  // Format the response data
  return formatResponse(response.data, responseType);
}

/**
 * Send normalized error via Connect RPC
 * 
 * Converts a NormalizedError to Connect error format.
 * Maps error codes and preserves error details.
 * 
 * @param error Normalized error to send
 * @returns Connect error ready to throw
 */
export function sendConnectError(error: NormalizedError): ConnectError {
  return {
    code: mapNormalizedErrorCodeToConnect(error.code),
    message: error.message,
    details: error.details,
  };
}

// ============================================================================
// Legacy Error Mapping Functions (for backward compatibility)
// ============================================================================

/**
 * Map validation error to Connect error
 * 
 * Converts validation errors (from protovalidate or PGV) to Connect error format.
 * Handles both structured validation results and raw violation arrays.
 * 
 * @param validationResult Validation result or array of violations
 * @returns Connect error with detailed violation information
 */
export function mapValidationError(validationResult: any): ConnectError {
  // Handle validation result object with violations array
  let violations: any[] = [];
  
  if (validationResult && typeof validationResult === 'object') {
    if (Array.isArray(validationResult)) {
      // Direct array of violations
      violations = validationResult;
    } else if (validationResult.violations && Array.isArray(validationResult.violations)) {
      // ValidationResult object with violations property
      violations = validationResult.violations;
    } else if (validationResult.field_violations && Array.isArray(validationResult.field_violations)) {
      // gRPC error format with field_violations
      violations = validationResult.field_violations;
    }
  }
  
  // Build error message from violations
  const messages = violations
    .map((v) => {
      const field = v?.field || v?.fieldPath || 'unknown';
      const desc = v?.description || v?.message || 'validation failed';
      return `${field}: ${desc}`;
    })
    .filter(Boolean);
  
  const message = messages.length > 0
    ? `Request validation failed: ${messages.join('; ')}`
    : 'Request validation failed';
  
  // Map violations to Connect error details format
  const details = violations.map((v) => ({
    '@type': 'buf.validate.FieldViolation',
    field: v?.field || v?.fieldPath || '',
    constraint_id: v?.rule || v?.constraintId || '',
    message: v?.description || v?.message || '',
    ...(v?.value !== undefined && { value: v.value }),
  }));
  
  return {
    code: ConnectErrorCode.InvalidArgument,
    message,
    details: details.length > 0 ? details : undefined,
  };
}

/**
 * Map rule matching error to Connect error
 * 
 * Converts rule matching errors to Connect error format.
 * Returns UNIMPLEMENTED status to indicate no mock rule is configured.
 * 
 * @param service Service name (e.g., "helloworld.Greeter")
 * @param method Method name (e.g., "SayHello")
 * @returns Connect error indicating no rule match
 */
export function mapNoRuleMatchError(service: string, method: string): ConnectError {
  return {
    code: ConnectErrorCode.Unimplemented,
    message: `No rule matched for ${service}/${method}. Configure a rule file to mock this RPC.`,
    details: [{
      '@type': 'wishmock.RuleMatchError',
      service,
      method,
      rule_key: `${service}.${method}`.toLowerCase(),
    }],
  };
}

/**
 * Map streaming error to Connect error
 * 
 * Handles errors that occur during streaming operations.
 * Distinguishes between client cancellation and server errors.
 * 
 * @param error Error that occurred during streaming
 * @param streamType Type of stream (server, client, or bidi)
 * @returns Connect error appropriate for streaming context
 */
export function mapStreamingError(error: any, streamType: 'server' | 'client' | 'bidi'): ConnectError {
  // Check if this is a cancellation error
  if (error?.code === 1 || error?.message?.includes('cancel')) {
    return {
      code: ConnectErrorCode.Canceled,
      message: `${streamType} streaming cancelled by client`,
    };
  }
  
  // Check if this is a deadline exceeded error
  if (error?.code === 4 || error?.message?.includes('deadline') || error?.message?.includes('timeout')) {
    return {
      code: ConnectErrorCode.DeadlineExceeded,
      message: `${streamType} streaming deadline exceeded`,
    };
  }
  
  // Check if this is an abort signal
  if (error?.name === 'AbortError') {
    return {
      code: ConnectErrorCode.Canceled,
      message: `${streamType} streaming aborted`,
    };
  }
  
  // For other errors, map using generic error handler
  const genericError = mapGenericError(error);
  
  return {
    ...genericError,
    message: `${streamType} streaming error: ${genericError.message}`,
  };
}

/**
 * Map generic error to Connect error
 * 
 * Converts generic errors to Connect error format.
 * Handles gRPC status codes, standard errors, and unknown error types.
 * 
 * @param error Error object (can be gRPC error, standard Error, or any value)
 * @returns Connect error with appropriate code and message
 */
export function mapGenericError(error: any): ConnectError {
  // Handle null/undefined
  if (!error) {
    return {
      code: ConnectErrorCode.Unknown,
      message: 'An unknown error occurred',
    };
  }
  
  // Check if error already has a gRPC status code
  if (typeof error.code === 'number') {
    // Map gRPC status codes to Connect error codes
    const grpcToConnect: Record<number, ConnectErrorCode> = {
      1: ConnectErrorCode.Canceled,
      2: ConnectErrorCode.Unknown,
      3: ConnectErrorCode.InvalidArgument,
      4: ConnectErrorCode.DeadlineExceeded,
      5: ConnectErrorCode.NotFound,
      6: ConnectErrorCode.AlreadyExists,
      7: ConnectErrorCode.PermissionDenied,
      8: ConnectErrorCode.ResourceExhausted,
      9: ConnectErrorCode.FailedPrecondition,
      10: ConnectErrorCode.Aborted,
      11: ConnectErrorCode.OutOfRange,
      12: ConnectErrorCode.Unimplemented,
      13: ConnectErrorCode.Internal,
      14: ConnectErrorCode.Unavailable,
      15: ConnectErrorCode.DataLoss,
      16: ConnectErrorCode.Unauthenticated,
    };
    
    const code = grpcToConnect[error.code] || ConnectErrorCode.Unknown;
    
    // Try to parse validation errors from message
    let details = error.details;
    if (!details && error.message) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.field_violations) {
          details = parsed.field_violations;
        }
      } catch {
        // Not JSON, use as-is
      }
    }
    
    return {
      code,
      message: error.message || error.details || 'An error occurred',
      details,
    };
  }
  
  // Check if error has a Connect error code string
  if (typeof error.code === 'string' && Object.values(ConnectErrorCode).includes(error.code as ConnectErrorCode)) {
    return {
      code: error.code as ConnectErrorCode,
      message: error.message || 'An error occurred',
      details: error.details,
    };
  }
  
  // Handle standard Error objects
  if (error instanceof Error) {
    return {
      code: ConnectErrorCode.Internal,
      message: error.message || 'Internal server error',
      details: error.stack ? [{ stack: error.stack }] : undefined,
    };
  }
  
  // Handle string errors
  if (typeof error === 'string') {
    return {
      code: ConnectErrorCode.Unknown,
      message: error,
    };
  }
  
  // Default fallback for unknown error types
  // Try to extract useful information from the object
  let message = 'Internal server error';
  try {
    if (typeof error === 'object' && error !== null) {
      // Try to stringify the object for debugging
      message = JSON.stringify(error);
    } else {
      message = String(error);
    }
  } catch {
    // If JSON.stringify fails, use default message
    message = 'Internal server error';
  }
  
  return {
    code: ConnectErrorCode.Internal,
    message,
  };
}

/**
 * Check if an error is a validation error
 * 
 * Determines if an error originated from validation failure.
 * 
 * @param error Error to check
 * @returns True if error is a validation error
 */
export function isValidationError(error: any): boolean {
  if (!error) return false;
  
  // Check for gRPC INVALID_ARGUMENT status
  if (error.code === 3) return true;
  
  // Check for Connect InvalidArgument code
  if (error.code === ConnectErrorCode.InvalidArgument) return true;
  
  // Check for validation-specific properties
  if (error.violations || error.field_violations) return true;
  
  // Check message for validation keywords
  if (error.message && typeof error.message === 'string') {
    const msg = error.message.toLowerCase();
    if (msg.includes('validation') || msg.includes('constraint') || msg.includes('invalid')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if an error is a rule matching error
 * 
 * Determines if an error originated from no rule match.
 * 
 * @param error Error to check
 * @returns True if error is a rule matching error
 */
export function isRuleMatchError(error: any): boolean {
  if (!error) return false;
  
  // Check for gRPC UNIMPLEMENTED status
  if (error.code === 12) return true;
  
  // Check for Connect Unimplemented code
  if (error.code === ConnectErrorCode.Unimplemented) return true;
  
  // Check message for rule matching keywords
  if (error.message && typeof error.message === 'string') {
    const msg = error.message.toLowerCase();
    if (msg.includes('no rule') || msg.includes('rule matched')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect protocol from request headers
 * 
 * Determines which protocol (Connect, gRPC-Web, or gRPC) is being used
 * based on request headers.
 * 
 * @param headers Request headers
 * @returns Detected protocol
 */
export function detectProtocol(headers: IncomingHttpHeaders): 'connect' | 'grpc-web' | 'grpc' {
  const contentType = headers['content-type'] || '';
  
  // Check for Connect protocol
  if (contentType.includes('application/connect+')) {
    return 'connect';
  }
  
  // Check for gRPC-Web protocol
  if (contentType.includes('application/grpc-web')) {
    return 'grpc-web';
  }
  
  // Check for standard gRPC protocol
  if (contentType.includes('application/grpc')) {
    return 'grpc';
  }
  
  // Default to Connect for JSON
  if (contentType.includes('application/json')) {
    return 'connect';
  }
  
  // Default to Connect
  return 'connect';
}

/**
 * Create a Connect context from HTTP request
 * 
 * @param headers Request headers
 * @param signal Optional abort signal
 * @returns Connect context
 */
export function createConnectContext(
  headers: IncomingHttpHeaders,
  signal?: AbortSignal
): ConnectContext {
  const protocol = detectProtocol(headers);
  
  // Extract timeout from headers
  let timeoutMs: number | undefined;
  const timeoutHeader = headers['connect-timeout-ms'] || headers['grpc-timeout'];
  if (timeoutHeader) {
    const parsed = parseInt(String(timeoutHeader), 10);
    if (!isNaN(parsed)) {
      timeoutMs = parsed;
    }
  }
  
  return {
    requestHeader: headers,
    responseHeader: {},
    responseTrailer: {},
    protocol,
    timeoutMs,
    signal,
  };
}

// ============================================================================
// gRPC Protocol Adapter Functions
// ============================================================================

/**
 * Extract metadata from gRPC call metadata
 * 
 * Converts gRPC Metadata object to a simple key-value record suitable for
 * rule matching and normalized request format.
 * 
 * @param metadata gRPC Metadata object
 * @returns Metadata record with string values
 */
export function extractGrpcMetadata(metadata: grpc.Metadata | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  
  if (!metadata) {
    return record;
  }
  
  try {
    // Use getMap() method if available (preferred method)
    const getMap = (metadata as any).getMap;
    if (typeof getMap === "function") {
      const map = getMap.call(metadata) as Record<string, unknown>;
      
      // Convert all values to strings for consistency
      for (const [key, value] of Object.entries(map)) {
        if (value !== undefined && value !== null) {
          // Handle array values (multiple headers with same name)
          if (Array.isArray(value)) {
            record[key] = value.length === 1 ? String(value[0]) : value.map(String).join(',');
          } else {
            record[key] = String(value);
          }
        }
      }
    }
  } catch (e) {
    // Ignore metadata conversion errors and return empty record
  }
  
  return record;
}

/**
 * Normalize gRPC unary request to NormalizedRequest format
 * 
 * Converts a gRPC unary call to the protocol-agnostic normalized format.
 * 
 * @param call gRPC unary call
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request
 */
export function normalizeGrpcUnaryRequest(
  call: grpc.ServerUnaryCall<any, any>,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  service: string,
  method: string
): NormalizedRequest {
  return {
    service,
    method,
    metadata: extractGrpcMetadata(call.metadata),
    data: call.request,
    requestType,
    responseType,
    requestStream: false,
    responseStream: false,
  };
}

/**
 * Normalize gRPC server streaming request to NormalizedRequest format
 * 
 * Converts a gRPC server streaming call to the protocol-agnostic normalized format.
 * 
 * @param call gRPC server writable stream
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request
 */
export function normalizeGrpcServerStreamingRequest(
  call: grpc.ServerWritableStream<any, any>,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  service: string,
  method: string
): NormalizedRequest {
  return {
    service,
    method,
    metadata: extractGrpcMetadata(call.metadata),
    data: call.request,
    requestType,
    responseType,
    requestStream: false,
    responseStream: true,
  };
}

/**
 * Normalize gRPC client streaming request to NormalizedRequest format
 * 
 * Converts a gRPC client streaming call to the protocol-agnostic normalized format.
 * Note: The data field will be populated as messages arrive on the stream.
 * 
 * @param call gRPC server readable stream
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request (data will be stream of messages)
 */
export function normalizeGrpcClientStreamingRequest(
  call: grpc.ServerReadableStream<any, any>,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  service: string,
  method: string
): NormalizedRequest {
  return {
    service,
    method,
    metadata: extractGrpcMetadata(call.metadata),
    data: null, // Will be populated by stream handler
    requestType,
    responseType,
    requestStream: true,
    responseStream: false,
  };
}

/**
 * Normalize gRPC bidirectional streaming request to NormalizedRequest format
 * 
 * Converts a gRPC bidirectional streaming call to the protocol-agnostic normalized format.
 * Note: The data field will be populated as messages arrive on the stream.
 * 
 * @param call gRPC server duplex stream
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param service Fully qualified service name
 * @param method Method name
 * @returns Normalized request (data will be stream of messages)
 */
export function normalizeGrpcBidiStreamingRequest(
  call: grpc.ServerDuplexStream<any, any>,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  service: string,
  method: string
): NormalizedRequest {
  return {
    service,
    method,
    metadata: extractGrpcMetadata(call.metadata),
    data: null, // Will be populated by stream handler
    requestType,
    responseType,
    requestStream: true,
    responseStream: true,
  };
}

/**
 * Generic function to normalize any gRPC request to NormalizedRequest format
 * 
 * Automatically detects the streaming pattern and calls the appropriate
 * normalization function.
 * 
 * @param call gRPC call (any streaming pattern)
 * @param requestType Protobuf type for request message
 * @param responseType Protobuf type for response message
 * @param service Fully qualified service name
 * @param method Method name
 * @param requestStream Whether this is a client streaming request
 * @param responseStream Whether this is a server streaming response
 * @returns Normalized request
 */
export function normalizeGrpcRequest(
  call: grpc.ServerUnaryCall<any, any> | 
        grpc.ServerWritableStream<any, any> | 
        grpc.ServerReadableStream<any, any> | 
        grpc.ServerDuplexStream<any, any>,
  requestType: protobuf.Type,
  responseType: protobuf.Type,
  service: string,
  method: string,
  requestStream: boolean,
  responseStream: boolean
): NormalizedRequest {
  // Unary (no streaming)
  if (!requestStream && !responseStream) {
    return normalizeGrpcUnaryRequest(
      call as grpc.ServerUnaryCall<any, any>,
      requestType,
      responseType,
      service,
      method
    );
  }
  
  // Server streaming
  if (!requestStream && responseStream) {
    return normalizeGrpcServerStreamingRequest(
      call as grpc.ServerWritableStream<any, any>,
      requestType,
      responseType,
      service,
      method
    );
  }
  
  // Client streaming
  if (requestStream && !responseStream) {
    return normalizeGrpcClientStreamingRequest(
      call as grpc.ServerReadableStream<any, any>,
      requestType,
      responseType,
      service,
      method
    );
  }
  
  // Bidirectional streaming
  return normalizeGrpcBidiStreamingRequest(
    call as grpc.ServerDuplexStream<any, any>,
    requestType,
    responseType,
    service,
    method
  );
}

// ============================================================================
// gRPC Response Conversion Functions
// ============================================================================

/**
 * Map normalized error code to gRPC status code
 * 
 * Converts protocol-agnostic error code names to gRPC numeric status codes.
 * 
 * @param code Normalized error code (e.g., "INVALID_ARGUMENT")
 * @returns gRPC status code number
 */
export function mapNormalizedErrorCodeToGrpc(code: string): number {
  const codeMap: Record<string, number> = {
    "OK": grpc.status.OK,
    "CANCELLED": grpc.status.CANCELLED,
    "UNKNOWN": grpc.status.UNKNOWN,
    "INVALID_ARGUMENT": grpc.status.INVALID_ARGUMENT,
    "DEADLINE_EXCEEDED": grpc.status.DEADLINE_EXCEEDED,
    "NOT_FOUND": grpc.status.NOT_FOUND,
    "ALREADY_EXISTS": grpc.status.ALREADY_EXISTS,
    "PERMISSION_DENIED": grpc.status.PERMISSION_DENIED,
    "RESOURCE_EXHAUSTED": grpc.status.RESOURCE_EXHAUSTED,
    "FAILED_PRECONDITION": grpc.status.FAILED_PRECONDITION,
    "ABORTED": grpc.status.ABORTED,
    "OUT_OF_RANGE": grpc.status.OUT_OF_RANGE,
    "UNIMPLEMENTED": grpc.status.UNIMPLEMENTED,
    "INTERNAL": grpc.status.INTERNAL,
    "UNAVAILABLE": grpc.status.UNAVAILABLE,
    "DATA_LOSS": grpc.status.DATA_LOSS,
    "UNAUTHENTICATED": grpc.status.UNAUTHENTICATED,
  };
  
  return codeMap[code] ?? grpc.status.UNKNOWN;
}

/**
 * Send normalized response via gRPC unary call
 * 
 * Converts a NormalizedResponse to gRPC format and sends it via the callback.
 * Handles metadata and trailer properly.
 * 
 * @param call gRPC unary call
 * @param callback gRPC callback to send response
 * @param response Normalized response to send
 */
export function sendGrpcUnaryResponse(
  call: grpc.ServerUnaryCall<any, any>,
  callback: grpc.sendUnaryData<any>,
  response: NormalizedResponse
): void {
  // Send initial metadata if provided
  if (response.metadata) {
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(response.metadata)) {
      metadata.add(key, value);
    }
    call.sendMetadata(metadata);
  }
  
  // Send trailing metadata if provided
  if (response.trailer) {
    const trailer = new grpc.Metadata();
    for (const [key, value] of Object.entries(response.trailer)) {
      trailer.add(key, value);
    }
    // Set trailing metadata on the call
    try {
      (call as any).setTrailer?.(trailer);
    } catch {
      // Ignore if setTrailer is not available
    }
  }
  
  // Send response via callback
  callback(null, response.data);
}

/**
 * Send normalized error via gRPC unary call
 * 
 * Converts a NormalizedError to gRPC error format and sends it via the callback.
 * Maps error codes and preserves error details.
 * 
 * @param callback gRPC callback to send error
 * @param error Normalized error to send
 */
export function sendGrpcUnaryError(
  callback: grpc.sendUnaryData<any>,
  error: NormalizedError
): void {
  const grpcError: grpc.ServiceError = {
    name: error.code,
    message: error.message,
    code: mapNormalizedErrorCodeToGrpc(error.code),
    details: error.details ? JSON.stringify(error.details) : '',
    metadata: new grpc.Metadata(),
  };
  
  callback(grpcError);
}

/**
 * Send normalized response via gRPC server streaming call
 * 
 * Writes a single response message to the stream.
 * This should be called for each message in a server streaming response.
 * 
 * @param call gRPC server writable stream
 * @param response Normalized response to send
 */
export function sendGrpcServerStreamingResponse(
  call: grpc.ServerWritableStream<any, any>,
  response: NormalizedResponse
): void {
  // Send initial metadata if provided (only on first message)
  if (response.metadata) {
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(response.metadata)) {
      metadata.add(key, value);
    }
    call.sendMetadata(metadata);
  }
  
  // Write the response data to the stream
  call.write(response.data);
}

/**
 * End gRPC server streaming call
 * 
 * Ends the server streaming call with optional trailing metadata.
 * 
 * @param call gRPC server writable stream
 * @param trailer Optional trailing metadata
 */
export function endGrpcServerStreaming(
  call: grpc.ServerWritableStream<any, any>,
  trailer?: Record<string, string>
): void {
  if (trailer) {
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(trailer)) {
      metadata.add(key, value);
    }
    call.end(metadata);
  } else {
    call.end();
  }
}

/**
 * Send normalized error via gRPC server streaming call
 * 
 * Sends an error and ends the stream.
 * 
 * @param call gRPC server writable stream
 * @param error Normalized error to send
 */
export function sendGrpcServerStreamingError(
  call: grpc.ServerWritableStream<any, any>,
  error: NormalizedError
): void {
  const grpcError: grpc.ServiceError = {
    name: error.code,
    message: error.message,
    code: mapNormalizedErrorCodeToGrpc(error.code),
    details: error.details ? JSON.stringify(error.details) : '',
    metadata: new grpc.Metadata(),
  };
  
  call.destroy(grpcError);
}

/**
 * Send normalized response via gRPC client streaming call
 * 
 * Sends the final response for a client streaming call.
 * 
 * @param call gRPC server readable stream
 * @param callback gRPC callback to send response
 * @param response Normalized response to send
 */
export function sendGrpcClientStreamingResponse(
  call: grpc.ServerReadableStream<any, any>,
  callback: grpc.sendUnaryData<any>,
  response: NormalizedResponse
): void {
  // Send initial metadata if provided
  if (response.metadata) {
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(response.metadata)) {
      metadata.add(key, value);
    }
    call.sendMetadata(metadata);
  }
  
  // Send trailing metadata if provided
  if (response.trailer) {
    const trailer = new grpc.Metadata();
    for (const [key, value] of Object.entries(response.trailer)) {
      trailer.add(key, value);
    }
    // Set trailing metadata on the call
    try {
      (call as any).setTrailer?.(trailer);
    } catch {
      // Ignore if setTrailer is not available
    }
  }
  
  // Send response via callback
  callback(null, response.data);
}

/**
 * Send normalized error via gRPC client streaming call
 * 
 * Sends an error for a client streaming call.
 * 
 * @param callback gRPC callback to send error
 * @param error Normalized error to send
 */
export function sendGrpcClientStreamingError(
  callback: grpc.sendUnaryData<any>,
  error: NormalizedError
): void {
  const grpcError: grpc.ServiceError = {
    name: error.code,
    message: error.message,
    code: mapNormalizedErrorCodeToGrpc(error.code),
    details: error.details ? JSON.stringify(error.details) : '',
    metadata: new grpc.Metadata(),
  };
  
  callback(grpcError);
}

/**
 * Send normalized response via gRPC bidirectional streaming call
 * 
 * Writes a single response message to the stream.
 * This should be called for each message in a bidirectional streaming response.
 * 
 * @param call gRPC server duplex stream
 * @param response Normalized response to send
 */
export function sendGrpcBidiStreamingResponse(
  call: grpc.ServerDuplexStream<any, any>,
  response: NormalizedResponse
): void {
  // Send initial metadata if provided (only on first message)
  if (response.metadata) {
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(response.metadata)) {
      metadata.add(key, value);
    }
    call.sendMetadata(metadata);
  }
  
  // Write the response data to the stream
  call.write(response.data);
}

/**
 * End gRPC bidirectional streaming call
 * 
 * Ends the bidirectional streaming call with optional trailing metadata.
 * 
 * @param call gRPC server duplex stream
 * @param trailer Optional trailing metadata
 */
export function endGrpcBidiStreaming(
  call: grpc.ServerDuplexStream<any, any>,
  trailer?: Record<string, string>
): void {
  if (trailer) {
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(trailer)) {
      metadata.add(key, value);
    }
    call.end(metadata);
  } else {
    call.end();
  }
}

/**
 * Send normalized error via gRPC bidirectional streaming call
 * 
 * Sends an error and ends the stream.
 * 
 * @param call gRPC server duplex stream
 * @param error Normalized error to send
 */
export function sendGrpcBidiStreamingError(
  call: grpc.ServerDuplexStream<any, any>,
  error: NormalizedError
): void {
  const grpcError: grpc.ServiceError = {
    name: error.code,
    message: error.message,
    code: mapNormalizedErrorCodeToGrpc(error.code),
    details: error.details ? JSON.stringify(error.details) : '',
    metadata: new grpc.Metadata(),
  };
  
  call.destroy(grpcError);
}

/**
 * Generic function to send normalized response via gRPC
 * 
 * Automatically detects the streaming pattern and calls the appropriate
 * send function. For unary and client streaming, a callback must be provided.
 * 
 * @param call gRPC call (any streaming pattern)
 * @param response Normalized response to send
 * @param requestStream Whether this is a client streaming request
 * @param responseStream Whether this is a server streaming response
 * @param callback Optional callback for unary and client streaming
 */
export function sendGrpcResponse(
  call: grpc.ServerUnaryCall<any, any> | 
        grpc.ServerWritableStream<any, any> | 
        grpc.ServerReadableStream<any, any> | 
        grpc.ServerDuplexStream<any, any>,
  response: NormalizedResponse,
  requestStream: boolean,
  responseStream: boolean,
  callback?: grpc.sendUnaryData<any>
): void {
  // Unary (no streaming)
  if (!requestStream && !responseStream) {
    if (!callback) {
      throw new Error('Callback required for unary response');
    }
    sendGrpcUnaryResponse(call as grpc.ServerUnaryCall<any, any>, callback, response);
    return;
  }
  
  // Server streaming
  if (!requestStream && responseStream) {
    sendGrpcServerStreamingResponse(call as grpc.ServerWritableStream<any, any>, response);
    return;
  }
  
  // Client streaming
  if (requestStream && !responseStream) {
    if (!callback) {
      throw new Error('Callback required for client streaming response');
    }
    sendGrpcClientStreamingResponse(call as grpc.ServerReadableStream<any, any>, callback, response);
    return;
  }
  
  // Bidirectional streaming
  sendGrpcBidiStreamingResponse(call as grpc.ServerDuplexStream<any, any>, response);
}

/**
 * Generic function to send normalized error via gRPC
 * 
 * Automatically detects the streaming pattern and calls the appropriate
 * error send function. For unary and client streaming, a callback must be provided.
 * 
 * @param call gRPC call (any streaming pattern)
 * @param error Normalized error to send
 * @param requestStream Whether this is a client streaming request
 * @param responseStream Whether this is a server streaming response
 * @param callback Optional callback for unary and client streaming
 */
export function sendGrpcError(
  call: grpc.ServerUnaryCall<any, any> | 
        grpc.ServerWritableStream<any, any> | 
        grpc.ServerReadableStream<any, any> | 
        grpc.ServerDuplexStream<any, any>,
  error: NormalizedError,
  requestStream: boolean,
  responseStream: boolean,
  callback?: grpc.sendUnaryData<any>
): void {
  // Unary (no streaming)
  if (!requestStream && !responseStream) {
    if (!callback) {
      throw new Error('Callback required for unary error');
    }
    sendGrpcUnaryError(callback, error);
    return;
  }
  
  // Server streaming
  if (!requestStream && responseStream) {
    sendGrpcServerStreamingError(call as grpc.ServerWritableStream<any, any>, error);
    return;
  }
  
  // Client streaming
  if (requestStream && !responseStream) {
    if (!callback) {
      throw new Error('Callback required for client streaming error');
    }
    sendGrpcClientStreamingError(callback, error);
    return;
  }
  
  // Bidirectional streaming
  sendGrpcBidiStreamingError(call as grpc.ServerDuplexStream<any, any>, error);
}

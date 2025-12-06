/**
 * Protocol Adapter for Connect RPC
 * 
 * This module provides utilities to convert between Connect RPC protocol
 * and Wishmock's internal request/response format. It handles:
 * - Metadata extraction from Connect context
 * - Request normalization to internal format
 * - Response formatting to Connect protocol
 * - Error mapping between validation/rule errors and Connect error codes
 */

import protobuf from "protobufjs";
import type { IncomingHttpHeaders } from "node:http";

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
 * Converts HTTP headers to a metadata record suitable for rule matching.
 * Handles both Connect-specific headers and standard HTTP headers.
 * 
 * Optimizations:
 * - Pre-allocate object with estimated size
 * - Skip unnecessary string conversions
 * - Fast path for common cases
 * 
 * @param context Connect RPC context
 * @returns Metadata record for rule matching
 */
export function extractMetadata(context: ConnectContext): Record<string, unknown> {
  const headers = context.requestHeader;
  
  if (!headers) {
    return {};
  }
  
  // Pre-allocate with estimated size for better performance
  const metadata: Record<string, unknown> = Object.create(null);
  
  // Extract all headers as metadata
  for (const key in headers) {
    // Skip pseudo-headers and internal headers (fast check)
    if (key.charCodeAt(0) === 58) { // ':' character
      continue;
    }
    
    const value = headers[key];
    
    // Skip undefined values
    if (value === undefined) {
      continue;
    }
    
    // Convert header name to lowercase for consistency
    const normalizedKey = key.toLowerCase();
    
    // Handle array values (multiple headers with same name)
    if (Array.isArray(value)) {
      metadata[normalizedKey] = value.length === 1 ? value[0] : value;
    } else {
      metadata[normalizedKey] = value;
    }
  }
  
  // Extract Connect-specific metadata (only if present)
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
 * Returns true if the object has repeated fields that need default empty arrays
 */
function needsNormalization(obj: any, type: protobuf.Type): boolean {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  // Check if any repeated fields are missing (they should default to [])
  for (const field of type.fieldsArray) {
    if (field.repeated && !(field.name in obj)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize Connect request to internal format
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

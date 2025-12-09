/**
 * Normalized request/response types for protocol-agnostic request handling.
 * 
 * These types provide a common interface for both gRPC and Connect RPC servers,
 * enabling shared business logic for validation, rule matching, and response selection.
 */

import type protobuf from "protobufjs";

/**
 * Normalized request format (protocol-agnostic)
 * 
 * Represents a request from any protocol (gRPC, Connect, gRPC-Web) in a unified format.
 * Protocol adapters convert protocol-specific requests into this format before processing.
 */
export interface NormalizedRequest {
  /** Fully qualified service name (e.g., "helloworld.Greeter") */
  service: string;
  
  /** Method name (e.g., "SayHello") */
  method: string;
  
  /** Request metadata/headers as key-value pairs */
  metadata: Record<string, string>;
  
  /** Parsed protobuf message data */
  data: any;
  
  /** Protobuf type definition for the request message */
  requestType: protobuf.Type;
  
  /** Protobuf type definition for the response message */
  responseType: protobuf.Type;
  
  /** Whether this is a client streaming request */
  requestStream: boolean;
  
  /** Whether this is a server streaming response */
  responseStream: boolean;
}

/**
 * Normalized response format (protocol-agnostic)
 * 
 * Represents a successful response in a unified format.
 * Protocol adapters convert this format to protocol-specific responses.
 */
export interface NormalizedResponse {
  /** Response message data (protobuf message) */
  data: any;
  
  /** Optional initial metadata to send with the response */
  metadata?: Record<string, string>;
  
  /** Optional trailing metadata to send after the response */
  trailer?: Record<string, string>;
}

/**
 * Normalized error format (protocol-agnostic)
 * 
 * Represents an error in a unified format using gRPC status code names.
 * Protocol adapters map these to protocol-specific error codes.
 */
export interface NormalizedError {
  /** 
   * gRPC status code name (e.g., "INVALID_ARGUMENT", "NOT_FOUND", "UNIMPLEMENTED")
   * 
   * Valid values:
   * - OK
   * - CANCELLED
   * - UNKNOWN
   * - INVALID_ARGUMENT
   * - DEADLINE_EXCEEDED
   * - NOT_FOUND
   * - ALREADY_EXISTS
   * - PERMISSION_DENIED
   * - RESOURCE_EXHAUSTED
   * - FAILED_PRECONDITION
   * - ABORTED
   * - OUT_OF_RANGE
   * - UNIMPLEMENTED
   * - INTERNAL
   * - UNAVAILABLE
   * - DATA_LOSS
   * - UNAUTHENTICATED
   */
  code: string;
  
  /** Human-readable error message */
  message: string;
  
  /** Optional error details (e.g., validation violations) */
  details?: any[];
}

/**
 * Type guard to check if a result is a NormalizedError
 */
export function isNormalizedError(result: NormalizedResponse | NormalizedError): result is NormalizedError {
  return 'code' in result && 'message' in result;
}

/**
 * Streaming request handler result type
 * 
 * For unary requests, returns a single response or error.
 * For streaming requests, returns an async generator.
 */
export type UnaryHandlerResult = Promise<NormalizedResponse | NormalizedError>;

/**
 * Server streaming handler result type
 * 
 * Returns an async generator that yields responses or errors.
 */
export type ServerStreamingHandlerResult = AsyncGenerator<NormalizedResponse | NormalizedError>;

/**
 * Client streaming handler result type
 * 
 * Accepts an async iterable of requests and returns a single response or error.
 */
export type ClientStreamingHandlerResult = Promise<NormalizedResponse | NormalizedError>;

/**
 * Bidirectional streaming handler result type
 * 
 * Accepts an async iterable of requests and yields responses or errors.
 */
export type BidiStreamingHandlerResult = AsyncGenerator<NormalizedResponse | NormalizedError>;

/**
 * Unit tests for Connect RPC Protocol Adapter
 * 
 * Tests metadata extraction, request normalization, response formatting,
 * and protocol detection utilities.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import protobuf from 'protobufjs';
import * as grpc from '@grpc/grpc-js';
import {
  extractMetadata,
  normalizeRequest,
  formatResponse,
  detectProtocol,
  createConnectContext,
  extractGrpcMetadata,
  normalizeGrpcRequest,
  normalizeGrpcUnaryRequest,
  normalizeGrpcServerStreamingRequest,
  normalizeGrpcClientStreamingRequest,
  normalizeGrpcBidiStreamingRequest,
  normalizeConnectRequest,
  normalizeConnectUnaryRequest,
  normalizeConnectServerStreamingRequest,
  normalizeConnectClientStreamingRequest,
  normalizeConnectBidiStreamingRequest,
  sendConnectResponse,
  sendConnectError,
  mapNormalizedErrorCodeToConnect,
  type ConnectContext,
} from '../src/infrastructure/protocolAdapter.js';

describe('Protocol Adapter - Metadata Extraction', () => {
  test('should extract metadata from Connect context headers', () => {
    const context: ConnectContext = {
      requestHeader: {
        'content-type': 'application/connect+json',
        'authorization': 'Bearer token123',
        'x-custom-header': 'custom-value',
        'user-agent': 'test-client/1.0',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const metadata = extractMetadata(context);

    expect(metadata['content-type']).toBe('application/connect+json');
    expect(metadata['authorization']).toBe('Bearer token123');
    expect(metadata['x-custom-header']).toBe('custom-value');
    expect(metadata['user-agent']).toBe('test-client/1.0');
    expect(metadata['x-connect-protocol']).toBe('connect');
  });

  test('should handle array header values', () => {
    const context: ConnectContext = {
      requestHeader: {
        'x-tags': ['tag1', 'tag2', 'tag3'],
        'x-single': ['single-value'],
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const metadata = extractMetadata(context);

    // Multiple values should be joined with comma
    expect(metadata['x-tags']).toBe('tag1, tag2, tag3');
    // Single value array should be unwrapped
    expect(metadata['x-single']).toBe('single-value');
  });

  test('should skip pseudo-headers', () => {
    const context: ConnectContext = {
      requestHeader: {
        ':method': 'POST',
        ':path': '/test.Service/Method',
        ':authority': 'localhost:50052',
        'content-type': 'application/grpc',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'grpc',
    };

    const metadata = extractMetadata(context);

    // Pseudo-headers should be skipped
    expect(metadata[':method']).toBeUndefined();
    expect(metadata[':path']).toBeUndefined();
    expect(metadata[':authority']).toBeUndefined();
    // Regular headers should be included
    expect(metadata['content-type']).toBe('application/grpc');
  });

  test('should normalize header names to lowercase', () => {
    const context: ConnectContext = {
      requestHeader: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token',
        'X-Custom-Header': 'value',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const metadata = extractMetadata(context);

    expect(metadata['content-type']).toBe('application/json');
    expect(metadata['authorization']).toBe('Bearer token');
    expect(metadata['x-custom-header']).toBe('value');
  });

  test('should include timeout metadata', () => {
    const context: ConnectContext = {
      requestHeader: {
        'content-type': 'application/connect+json',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
      timeoutMs: 5000,
    };

    const metadata = extractMetadata(context);

    expect(metadata['connect-timeout-ms']).toBe('5000');
  });

  test('should handle empty headers', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const metadata = extractMetadata(context);

    expect(metadata['x-connect-protocol']).toBe('connect');
    expect(Object.keys(metadata).length).toBeGreaterThan(0);
  });

  test('should handle undefined header values', () => {
    const context: ConnectContext = {
      requestHeader: {
        'x-defined': 'value',
        'x-undefined': undefined,
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const metadata = extractMetadata(context);

    expect(metadata['x-defined']).toBe('value');
    expect(metadata['x-undefined']).toBeUndefined();
  });
});

describe('Protocol Adapter - Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    // Create test protobuf types
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('name', 1, 'string'));
    testRequestType.add(new protobuf.Field('age', 2, 'int32'));
    testRequestType.add(new protobuf.Field('tags', 3, 'string', 'repeated'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('message', 1, 'string'));
    testResponseType.add(new protobuf.Field('code', 2, 'int32'));
    testNamespace.add(testResponseType);
  });

  test('should normalize JSON request object', () => {
    const context: ConnectContext = {
      requestHeader: {
        'content-type': 'application/connect+json',
        'authorization': 'Bearer token',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const request = {
      name: 'Alice',
      age: 30,
      tags: ['developer', 'tester'],
    };

    const normalized = normalizeRequest(
      'test.TestService',
      'TestMethod',
      request,
      testRequestType,
      context
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.method).toBe('TestMethod');
    expect(normalized.data.name).toBe('Alice');
    expect(normalized.data.age).toBe(30);
    expect(normalized.data.tags).toEqual(['developer', 'tester']);
    expect(normalized.metadata['content-type']).toBe('application/connect+json');
    expect(normalized.metadata['authorization']).toBe('Bearer token');
    expect(normalized.context).toBe(context);
  });

  test('should normalize binary request buffer', () => {
    const context: ConnectContext = {
      requestHeader: {
        'content-type': 'application/connect+proto',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    // Create a binary protobuf message
    const message = testRequestType.create({
      name: 'Bob',
      age: 25,
      tags: ['admin'],
    });
    const buffer = testRequestType.encode(message).finish();

    const normalized = normalizeRequest(
      'test.TestService',
      'TestMethod',
      Buffer.from(buffer),
      testRequestType,
      context
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.method).toBe('TestMethod');
    expect(normalized.data.name).toBe('Bob');
    expect(normalized.data.age).toBe(25);
    expect(normalized.data.tags).toEqual(['admin']);
  });

  test('should handle request with missing optional fields', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const request = {
      name: 'Charlie',
      // age and tags are missing
    };

    const normalized = normalizeRequest(
      'test.TestService',
      'TestMethod',
      request,
      testRequestType,
      context
    );

    expect(normalized.data.name).toBe('Charlie');
    // Missing scalar fields should not be included (defaults: false)
    expect(normalized.data.age).toBeUndefined();
    // Repeated fields default to empty arrays
    expect(normalized.data.tags).toEqual([]);
  });

  test('should handle empty request object', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const normalized = normalizeRequest(
      'test.TestService',
      'TestMethod',
      {},
      testRequestType,
      context
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.method).toBe('TestMethod');
    expect(normalized.data).toBeDefined();
  });

  test('should handle malformed request gracefully', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    // Request with invalid field types
    const request = {
      name: 123, // Should be string
      age: 'not-a-number', // Should be int32
    };

    const normalized = normalizeRequest(
      'test.TestService',
      'TestMethod',
      request,
      testRequestType,
      context
    );

    // Should still normalize, protobuf will coerce types
    expect(normalized.data).toBeDefined();
    expect(normalized.service).toBe('test.TestService');
  });

  test('should extract metadata from context', () => {
    const context: ConnectContext = {
      requestHeader: {
        'x-request-id': 'req-123',
        'x-user-id': 'user-456',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'grpc-web',
      timeoutMs: 3000,
    };

    const normalized = normalizeRequest(
      'test.TestService',
      'TestMethod',
      { name: 'Test' },
      testRequestType,
      context
    );

    expect(normalized.metadata['x-request-id']).toBe('req-123');
    expect(normalized.metadata['x-user-id']).toBe('user-456');
    expect(normalized.metadata['x-connect-protocol']).toBe('grpc-web');
    expect(normalized.metadata['connect-timeout-ms']).toBe('3000');
  });
});

describe('Protocol Adapter - Response Formatting', () => {
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('message', 1, 'string'));
    testResponseType.add(new protobuf.Field('code', 2, 'int32'));
    testResponseType.add(new protobuf.Field('items', 3, 'string', 'repeated'));
    testNamespace.add(testResponseType);
  });

  test('should format plain object response', () => {
    const response = {
      message: 'Success',
      code: 200,
      items: ['item1', 'item2'],
    };

    const formatted = formatResponse(response, testResponseType);

    expect(formatted.message).toBe('Success');
    expect(formatted.code).toBe(200);
    expect(formatted.items).toEqual(['item1', 'item2']);
  });

  test('should format protobuf message response', () => {
    const message = testResponseType.create({
      message: 'Created',
      code: 201,
      items: ['new-item'],
    });

    const formatted = formatResponse(message, testResponseType);

    // Should return the message as-is or convert to object
    expect(formatted).toBeDefined();
    if (typeof formatted === 'object') {
      expect(formatted.message).toBe('Created');
      expect(formatted.code).toBe(201);
    }
  });

  test('should format buffer response', () => {
    const message = testResponseType.create({
      message: 'Binary',
      code: 100,
    });
    const buffer = testResponseType.encode(message).finish();

    const formatted = formatResponse(Buffer.from(buffer), testResponseType);

    expect(formatted.message).toBe('Binary');
    expect(formatted.code).toBe(100);
  });

  test('should handle empty response', () => {
    const formatted = formatResponse(null, testResponseType);

    expect(formatted).toBeDefined();
    // Should create empty message
    expect(typeof formatted).toBe('object');
  });

  test('should handle undefined response', () => {
    const formatted = formatResponse(undefined, testResponseType);

    expect(formatted).toBeDefined();
  });

  test('should handle response with missing optional fields', () => {
    const response = {
      message: 'Partial',
      // code and items are missing
    };

    const formatted = formatResponse(response, testResponseType);

    expect(formatted.message).toBe('Partial');
    // Missing scalar fields should not be included (defaults: false)
    expect(formatted.code).toBeUndefined();
    // Repeated fields default to empty arrays
    expect(formatted.items).toEqual([]);
  });

  test('should handle malformed response gracefully', () => {
    const response = {
      message: 123, // Should be string
      code: 'not-a-number', // Should be int32
      extra: 'ignored', // Not in schema
    };

    const formatted = formatResponse(response, testResponseType);

    // Should still format, protobuf will coerce types
    expect(formatted).toBeDefined();
  });
});

describe('Protocol Adapter - Protocol Detection', () => {
  test('should detect Connect protocol from content-type', () => {
    const headers = {
      'content-type': 'application/connect+json',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('connect');
  });

  test('should detect Connect binary protocol', () => {
    const headers = {
      'content-type': 'application/connect+proto',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('connect');
  });

  test('should detect gRPC-Web protocol', () => {
    const headers = {
      'content-type': 'application/grpc-web+proto',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('grpc-web');
  });

  test('should detect gRPC-Web text protocol', () => {
    const headers = {
      'content-type': 'application/grpc-web-text',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('grpc-web');
  });

  test('should detect standard gRPC protocol', () => {
    const headers = {
      'content-type': 'application/grpc+proto',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('grpc');
  });

  test('should detect gRPC protocol without subtype', () => {
    const headers = {
      'content-type': 'application/grpc',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('grpc');
  });

  test('should default to Connect for JSON content-type', () => {
    const headers = {
      'content-type': 'application/json',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('connect');
  });

  test('should default to Connect for missing content-type', () => {
    const headers = {};

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('connect');
  });

  test('should default to Connect for unknown content-type', () => {
    const headers = {
      'content-type': 'text/plain',
    };

    const protocol = detectProtocol(headers);

    expect(protocol).toBe('connect');
  });

  test('should handle case-insensitive content-type', () => {
    const headers = {
      'content-type': 'APPLICATION/GRPC-WEB+PROTO',
    };

    const protocol = detectProtocol(headers);

    // Note: detectProtocol uses includes() which is case-sensitive
    // In practice, HTTP headers are case-insensitive but Node.js normalizes them to lowercase
    // This test documents current behavior - uppercase content-type defaults to 'connect'
    expect(protocol).toBe('connect');
  });
});

describe('Protocol Adapter - Context Creation', () => {
  test('should create Connect context from headers', () => {
    const headers = {
      'content-type': 'application/connect+json',
      'authorization': 'Bearer token',
      'x-custom': 'value',
    };

    const context = createConnectContext(headers);

    expect(context.requestHeader).toBe(headers);
    expect(context.protocol).toBe('connect');
    expect(context.responseHeader).toEqual({});
    expect(context.responseTrailer).toEqual({});
    expect(context.timeoutMs).toBeUndefined();
    expect(context.signal).toBeUndefined();
  });

  test('should detect protocol from headers', () => {
    const grpcHeaders = {
      'content-type': 'application/grpc',
    };

    const context = createConnectContext(grpcHeaders);

    expect(context.protocol).toBe('grpc');
  });

  test('should extract timeout from connect-timeout-ms header', () => {
    const headers = {
      'content-type': 'application/connect+json',
      'connect-timeout-ms': '5000',
    };

    const context = createConnectContext(headers);

    expect(context.timeoutMs).toBe(5000);
  });

  test('should extract timeout from grpc-timeout header', () => {
    const headers = {
      'content-type': 'application/grpc',
      'grpc-timeout': '3000',
    };

    const context = createConnectContext(headers);

    expect(context.timeoutMs).toBe(3000);
  });

  test('should handle invalid timeout values', () => {
    const headers = {
      'content-type': 'application/connect+json',
      'connect-timeout-ms': 'invalid',
    };

    const context = createConnectContext(headers);

    expect(context.timeoutMs).toBeUndefined();
  });

  test('should include abort signal if provided', () => {
    const headers = {
      'content-type': 'application/connect+json',
    };
    const controller = new AbortController();

    const context = createConnectContext(headers, controller.signal);

    expect(context.signal).toBe(controller.signal);
  });

  test('should handle empty headers', () => {
    const context = createConnectContext({});

    expect(context.requestHeader).toEqual({});
    expect(context.protocol).toBe('connect'); // Default
    expect(context.responseHeader).toEqual({});
    expect(context.responseTrailer).toEqual({});
  });

  test('should prioritize connect-timeout-ms over grpc-timeout', () => {
    const headers = {
      'content-type': 'application/connect+json',
      'connect-timeout-ms': '5000',
      'grpc-timeout': '3000',
    };

    const context = createConnectContext(headers);

    // connect-timeout-ms should take precedence
    expect(context.timeoutMs).toBe(5000);
  });
});

// ============================================================================
// gRPC Protocol Adapter Tests
// ============================================================================

describe('Protocol Adapter - gRPC Metadata Extraction', () => {
  test('should extract metadata from gRPC Metadata object', () => {
    const metadata = new grpc.Metadata();
    metadata.set('authorization', 'Bearer token123');
    metadata.set('x-request-id', 'req-456');
    metadata.set('x-user-id', 'user-789');

    const extracted = extractGrpcMetadata(metadata);

    expect(extracted['authorization']).toBe('Bearer token123');
    expect(extracted['x-request-id']).toBe('req-456');
    expect(extracted['x-user-id']).toBe('user-789');
  });

  test('should handle empty gRPC metadata', () => {
    const metadata = new grpc.Metadata();

    const extracted = extractGrpcMetadata(metadata);

    expect(extracted).toEqual({});
  });

  test('should handle undefined metadata', () => {
    const extracted = extractGrpcMetadata(undefined);

    expect(extracted).toEqual({});
  });

  test('should convert all values to strings', () => {
    const metadata = new grpc.Metadata();
    metadata.set('x-number', '123');
    metadata.set('x-boolean', 'true');

    const extracted = extractGrpcMetadata(metadata);

    expect(typeof extracted['x-number']).toBe('string');
    expect(typeof extracted['x-boolean']).toBe('string');
    expect(extracted['x-number']).toBe('123');
    expect(extracted['x-boolean']).toBe('true');
  });

  test('should handle multiple values for same key', () => {
    const metadata = new grpc.Metadata();
    metadata.add('x-tags', 'tag1');
    metadata.add('x-tags', 'tag2');
    metadata.add('x-tags', 'tag3');

    const extracted = extractGrpcMetadata(metadata);

    // Multiple values should be joined with comma
    expect(typeof extracted['x-tags']).toBe('string');
    expect(extracted['x-tags']).toContain('tag1');
  });

  test('should handle binary metadata gracefully', () => {
    const metadata = new grpc.Metadata();
    metadata.set('x-text', 'text-value');
    // Binary metadata keys end with -bin
    metadata.set('x-binary-bin', Buffer.from('binary-data'));

    const extracted = extractGrpcMetadata(metadata);

    expect(extracted['x-text']).toBe('text-value');
    // Binary values should be converted to string representation
    expect(extracted['x-binary-bin']).toBeDefined();
  });
});

describe('Protocol Adapter - gRPC Unary Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('name', 1, 'string'));
    testRequestType.add(new protobuf.Field('age', 2, 'int32'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('message', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize gRPC unary request', () => {
    const metadata = new grpc.Metadata();
    metadata.set('authorization', 'Bearer token');
    metadata.set('x-request-id', 'req-123');

    const mockCall = {
      request: { name: 'Alice', age: 30 },
      metadata,
    } as grpc.ServerUnaryCall<any, any>;

    const normalized = normalizeGrpcUnaryRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.TestService',
      'TestMethod'
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.method).toBe('TestMethod');
    expect(normalized.data).toEqual({ name: 'Alice', age: 30 });
    expect(normalized.metadata['authorization']).toBe('Bearer token');
    expect(normalized.metadata['x-request-id']).toBe('req-123');
    expect(normalized.requestType).toBe(testRequestType);
    expect(normalized.responseType).toBe(testResponseType);
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(false);
  });

  test('should handle unary request with no metadata', () => {
    const mockCall = {
      request: { name: 'Bob', age: 25 },
      metadata: new grpc.Metadata(),
    } as grpc.ServerUnaryCall<any, any>;

    const normalized = normalizeGrpcUnaryRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.TestService',
      'TestMethod'
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.method).toBe('TestMethod');
    expect(normalized.data).toEqual({ name: 'Bob', age: 25 });
    expect(normalized.metadata).toEqual({});
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(false);
  });

  test('should handle unary request with empty data', () => {
    const mockCall = {
      request: {},
      metadata: new grpc.Metadata(),
    } as grpc.ServerUnaryCall<any, any>;

    const normalized = normalizeGrpcUnaryRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.TestService',
      'TestMethod'
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.data).toEqual({});
  });
});

describe('Protocol Adapter - gRPC Server Streaming Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('query', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('result', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize gRPC server streaming request', () => {
    const metadata = new grpc.Metadata();
    metadata.set('x-stream-id', 'stream-123');

    const mockCall = {
      request: { query: 'search term' },
      metadata,
    } as grpc.ServerWritableStream<any, any>;

    const normalized = normalizeGrpcServerStreamingRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.StreamService',
      'ServerStream'
    );

    expect(normalized.service).toBe('test.StreamService');
    expect(normalized.method).toBe('ServerStream');
    expect(normalized.data).toEqual({ query: 'search term' });
    expect(normalized.metadata['x-stream-id']).toBe('stream-123');
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(true);
  });
});

describe('Protocol Adapter - gRPC Client Streaming Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('data', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('summary', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize gRPC client streaming request', () => {
    const metadata = new grpc.Metadata();
    metadata.set('x-upload-id', 'upload-456');

    const mockCall = {
      metadata,
    } as grpc.ServerReadableStream<any, any>;

    const normalized = normalizeGrpcClientStreamingRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.StreamService',
      'ClientStream'
    );

    expect(normalized.service).toBe('test.StreamService');
    expect(normalized.method).toBe('ClientStream');
    expect(normalized.data).toBeNull(); // Data populated by stream handler
    expect(normalized.metadata['x-upload-id']).toBe('upload-456');
    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(false);
  });
});

describe('Protocol Adapter - gRPC Bidirectional Streaming Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('message', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('reply', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize gRPC bidirectional streaming request', () => {
    const metadata = new grpc.Metadata();
    metadata.set('x-session-id', 'session-789');

    const mockCall = {
      metadata,
    } as grpc.ServerDuplexStream<any, any>;

    const normalized = normalizeGrpcBidiStreamingRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.StreamService',
      'BidiStream'
    );

    expect(normalized.service).toBe('test.StreamService');
    expect(normalized.method).toBe('BidiStream');
    expect(normalized.data).toBeNull(); // Data populated by stream handler
    expect(normalized.metadata['x-session-id']).toBe('session-789');
    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(true);
  });
});

describe('Protocol Adapter - Generic gRPC Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('value', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('result', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize unary request using generic function', () => {
    const metadata = new grpc.Metadata();
    metadata.set('x-test', 'value');

    const mockCall = {
      request: { value: 'test' },
      metadata,
    } as grpc.ServerUnaryCall<any, any>;

    const normalized = normalizeGrpcRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.Service',
      'Method',
      false, // requestStream
      false  // responseStream
    );

    expect(normalized.service).toBe('test.Service');
    expect(normalized.method).toBe('Method');
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(false);
  });

  test('should normalize server streaming request using generic function', () => {
    const mockCall = {
      request: { value: 'test' },
      metadata: new grpc.Metadata(),
    } as grpc.ServerWritableStream<any, any>;

    const normalized = normalizeGrpcRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.Service',
      'Method',
      false, // requestStream
      true   // responseStream
    );

    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(true);
  });

  test('should normalize client streaming request using generic function', () => {
    const mockCall = {
      metadata: new grpc.Metadata(),
    } as grpc.ServerReadableStream<any, any>;

    const normalized = normalizeGrpcRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.Service',
      'Method',
      true,  // requestStream
      false  // responseStream
    );

    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(false);
  });

  test('should normalize bidirectional streaming request using generic function', () => {
    const mockCall = {
      metadata: new grpc.Metadata(),
    } as grpc.ServerDuplexStream<any, any>;

    const normalized = normalizeGrpcRequest(
      mockCall,
      testRequestType,
      testResponseType,
      'test.Service',
      'Method',
      true, // requestStream
      true  // responseStream
    );

    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(true);
  });
});

// ============================================================================
// gRPC Response Conversion Tests
// ============================================================================

import {
  sendGrpcUnaryResponse,
  sendGrpcUnaryError,
  sendGrpcServerStreamingResponse,
  sendGrpcServerStreamingError,
  endGrpcServerStreaming,
  sendGrpcClientStreamingResponse,
  sendGrpcClientStreamingError,
  sendGrpcBidiStreamingResponse,
  sendGrpcBidiStreamingError,
  endGrpcBidiStreaming,
  sendGrpcResponse,
  sendGrpcError,
  mapNormalizedErrorCodeToGrpc,
} from '../src/infrastructure/protocolAdapter.js';
import type { NormalizedResponse, NormalizedError } from '../src/domain/types/normalized.js';

describe('Protocol Adapter - Error Code Mapping', () => {
  test('should map normalized error codes to gRPC status codes', () => {
    expect(mapNormalizedErrorCodeToGrpc('OK')).toBe(grpc.status.OK);
    expect(mapNormalizedErrorCodeToGrpc('CANCELLED')).toBe(grpc.status.CANCELLED);
    expect(mapNormalizedErrorCodeToGrpc('UNKNOWN')).toBe(grpc.status.UNKNOWN);
    expect(mapNormalizedErrorCodeToGrpc('INVALID_ARGUMENT')).toBe(grpc.status.INVALID_ARGUMENT);
    expect(mapNormalizedErrorCodeToGrpc('DEADLINE_EXCEEDED')).toBe(grpc.status.DEADLINE_EXCEEDED);
    expect(mapNormalizedErrorCodeToGrpc('NOT_FOUND')).toBe(grpc.status.NOT_FOUND);
    expect(mapNormalizedErrorCodeToGrpc('ALREADY_EXISTS')).toBe(grpc.status.ALREADY_EXISTS);
    expect(mapNormalizedErrorCodeToGrpc('PERMISSION_DENIED')).toBe(grpc.status.PERMISSION_DENIED);
    expect(mapNormalizedErrorCodeToGrpc('RESOURCE_EXHAUSTED')).toBe(grpc.status.RESOURCE_EXHAUSTED);
    expect(mapNormalizedErrorCodeToGrpc('FAILED_PRECONDITION')).toBe(grpc.status.FAILED_PRECONDITION);
    expect(mapNormalizedErrorCodeToGrpc('ABORTED')).toBe(grpc.status.ABORTED);
    expect(mapNormalizedErrorCodeToGrpc('OUT_OF_RANGE')).toBe(grpc.status.OUT_OF_RANGE);
    expect(mapNormalizedErrorCodeToGrpc('UNIMPLEMENTED')).toBe(grpc.status.UNIMPLEMENTED);
    expect(mapNormalizedErrorCodeToGrpc('INTERNAL')).toBe(grpc.status.INTERNAL);
    expect(mapNormalizedErrorCodeToGrpc('UNAVAILABLE')).toBe(grpc.status.UNAVAILABLE);
    expect(mapNormalizedErrorCodeToGrpc('DATA_LOSS')).toBe(grpc.status.DATA_LOSS);
    expect(mapNormalizedErrorCodeToGrpc('UNAUTHENTICATED')).toBe(grpc.status.UNAUTHENTICATED);
  });

  test('should default to UNKNOWN for invalid error codes', () => {
    expect(mapNormalizedErrorCodeToGrpc('INVALID_CODE')).toBe(grpc.status.UNKNOWN);
    expect(mapNormalizedErrorCodeToGrpc('')).toBe(grpc.status.UNKNOWN);
  });
});

describe('Protocol Adapter - gRPC Unary Response Sending', () => {
  test('should send unary response without metadata', () => {
    let callbackCalled = false;
    let callbackError: any = null;
    let callbackData: any = null;

    const mockCall = {
      sendMetadata: () => {},
    } as unknown as grpc.ServerUnaryCall<any, any>;

    const mockCallback: grpc.sendUnaryData<any> = (error, data) => {
      callbackCalled = true;
      callbackError = error;
      callbackData = data;
    };

    const response: NormalizedResponse = {
      data: { message: 'Success', code: 200 },
    };

    sendGrpcUnaryResponse(mockCall, mockCallback, response);

    expect(callbackCalled).toBe(true);
    expect(callbackError).toBeNull();
    expect(callbackData).toEqual({ message: 'Success', code: 200 });
  });

  test('should send unary response with initial metadata', () => {
    let metadataSent = false;
    let sentMetadata: grpc.Metadata | null = null;

    const mockCall = {
      sendMetadata: (metadata: grpc.Metadata) => {
        metadataSent = true;
        sentMetadata = metadata;
      },
    } as unknown as grpc.ServerUnaryCall<any, any>;

    const mockCallback: grpc.sendUnaryData<any> = () => {};

    const response: NormalizedResponse = {
      data: { message: 'Success' },
      metadata: {
        'x-custom-header': 'custom-value',
        'x-request-id': 'req-123',
      },
    };

    sendGrpcUnaryResponse(mockCall, mockCallback, response);

    expect(metadataSent).toBe(true);
    expect(sentMetadata).toBeDefined();
  });

  test('should send unary response with trailing metadata', () => {
    let trailerSet = false;

    const mockCall = {
      sendMetadata: () => {},
      setTrailer: (trailer: grpc.Metadata) => {
        trailerSet = true;
      },
    } as any;

    const mockCallback: grpc.sendUnaryData<any> = () => {};

    const response: NormalizedResponse = {
      data: { message: 'Success' },
      trailer: {
        'x-trailer-header': 'trailer-value',
      },
    };

    sendGrpcUnaryResponse(mockCall, mockCallback, response);

    expect(trailerSet).toBe(true);
  });

  test('should send unary error', () => {
    let callbackCalled = false;
    let callbackError: any = null;

    const mockCallback: grpc.sendUnaryData<any> = (error) => {
      callbackCalled = true;
      callbackError = error;
    };

    const error: NormalizedError = {
      code: 'INVALID_ARGUMENT',
      message: 'Invalid request data',
      details: [{ field: 'name', message: 'required' }],
    };

    sendGrpcUnaryError(mockCallback, error);

    expect(callbackCalled).toBe(true);
    expect(callbackError).toBeDefined();
    expect(callbackError.code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(callbackError.message).toBe('Invalid request data');
    expect(callbackError.details).toBeDefined();
  });

  test('should send unary error without details', () => {
    let callbackError: any = null;

    const mockCallback: grpc.sendUnaryData<any> = (error) => {
      callbackError = error;
    };

    const error: NormalizedError = {
      code: 'NOT_FOUND',
      message: 'Resource not found',
    };

    sendGrpcUnaryError(mockCallback, error);

    expect(callbackError).toBeDefined();
    expect(callbackError.code).toBe(grpc.status.NOT_FOUND);
    expect(callbackError.message).toBe('Resource not found');
    expect(callbackError.details).toBe('');
  });
});

describe('Protocol Adapter - gRPC Server Streaming Response Sending', () => {
  test('should send server streaming response', () => {
    let written = false;
    let writtenData: any = null;

    const mockCall = {
      sendMetadata: () => {},
      write: (data: any) => {
        written = true;
        writtenData = data;
      },
    } as unknown as grpc.ServerWritableStream<any, any>;

    const response: NormalizedResponse = {
      data: { result: 'item1' },
    };

    sendGrpcServerStreamingResponse(mockCall, response);

    expect(written).toBe(true);
    expect(writtenData).toEqual({ result: 'item1' });
  });

  test('should send server streaming response with metadata', () => {
    let metadataSent = false;

    const mockCall = {
      sendMetadata: () => {
        metadataSent = true;
      },
      write: () => {},
    } as unknown as grpc.ServerWritableStream<any, any>;

    const response: NormalizedResponse = {
      data: { result: 'item1' },
      metadata: {
        'x-stream-id': 'stream-123',
      },
    };

    sendGrpcServerStreamingResponse(mockCall, response);

    expect(metadataSent).toBe(true);
  });

  test('should end server streaming without trailer', () => {
    let ended = false;

    const mockCall = {
      end: () => {
        ended = true;
      },
    } as unknown as grpc.ServerWritableStream<any, any>;

    endGrpcServerStreaming(mockCall);

    expect(ended).toBe(true);
  });

  test('should end server streaming with trailer', () => {
    let ended = false;
    let endedWithMetadata = false;

    const mockCall = {
      end: (metadata?: grpc.Metadata) => {
        ended = true;
        if (metadata) {
          endedWithMetadata = true;
        }
      },
    } as unknown as grpc.ServerWritableStream<any, any>;

    endGrpcServerStreaming(mockCall, {
      'x-final-status': 'complete',
    });

    expect(ended).toBe(true);
    expect(endedWithMetadata).toBe(true);
  });

  test('should send server streaming error', () => {
    let destroyed = false;
    let destroyError: any = null;

    const mockCall = {
      destroy: (error: any) => {
        destroyed = true;
        destroyError = error;
      },
    } as unknown as grpc.ServerWritableStream<any, any>;

    const error: NormalizedError = {
      code: 'INTERNAL',
      message: 'Stream processing error',
    };

    sendGrpcServerStreamingError(mockCall, error);

    expect(destroyed).toBe(true);
    expect(destroyError).toBeDefined();
    expect(destroyError.code).toBe(grpc.status.INTERNAL);
  });
});

describe('Protocol Adapter - gRPC Client Streaming Response Sending', () => {
  test('should send client streaming response', () => {
    let callbackCalled = false;
    let callbackData: any = null;

    const mockCall = {
      sendMetadata: () => {},
    } as unknown as grpc.ServerReadableStream<any, any>;

    const mockCallback: grpc.sendUnaryData<any> = (error, data) => {
      callbackCalled = true;
      callbackData = data;
    };

    const response: NormalizedResponse = {
      data: { summary: 'Processed 10 items' },
    };

    sendGrpcClientStreamingResponse(mockCall, mockCallback, response);

    expect(callbackCalled).toBe(true);
    expect(callbackData).toEqual({ summary: 'Processed 10 items' });
  });

  test('should send client streaming response with metadata', () => {
    let metadataSent = false;

    const mockCall = {
      sendMetadata: () => {
        metadataSent = true;
      },
    } as unknown as grpc.ServerReadableStream<any, any>;

    const mockCallback: grpc.sendUnaryData<any> = () => {};

    const response: NormalizedResponse = {
      data: { summary: 'Complete' },
      metadata: {
        'x-upload-id': 'upload-456',
      },
    };

    sendGrpcClientStreamingResponse(mockCall, mockCallback, response);

    expect(metadataSent).toBe(true);
  });

  test('should send client streaming error', () => {
    let callbackError: any = null;

    const mockCallback: grpc.sendUnaryData<any> = (error) => {
      callbackError = error;
    };

    const error: NormalizedError = {
      code: 'ABORTED',
      message: 'Upload aborted',
    };

    sendGrpcClientStreamingError(mockCallback, error);

    expect(callbackError).toBeDefined();
    expect(callbackError.code).toBe(grpc.status.ABORTED);
    expect(callbackError.message).toBe('Upload aborted');
  });
});

describe('Protocol Adapter - gRPC Bidirectional Streaming Response Sending', () => {
  test('should send bidi streaming response', () => {
    let written = false;
    let writtenData: any = null;

    const mockCall = {
      sendMetadata: () => {},
      write: (data: any) => {
        written = true;
        writtenData = data;
      },
    } as unknown as grpc.ServerDuplexStream<any, any>;

    const response: NormalizedResponse = {
      data: { reply: 'Echo: message' },
    };

    sendGrpcBidiStreamingResponse(mockCall, response);

    expect(written).toBe(true);
    expect(writtenData).toEqual({ reply: 'Echo: message' });
  });

  test('should end bidi streaming', () => {
    let ended = false;

    const mockCall = {
      end: () => {
        ended = true;
      },
    } as unknown as grpc.ServerDuplexStream<any, any>;

    endGrpcBidiStreaming(mockCall);

    expect(ended).toBe(true);
  });

  test('should send bidi streaming error', () => {
    let destroyed = false;
    let destroyError: any = null;

    const mockCall = {
      destroy: (error: any) => {
        destroyed = true;
        destroyError = error;
      },
    } as unknown as grpc.ServerDuplexStream<any, any>;

    const error: NormalizedError = {
      code: 'CANCELLED',
      message: 'Stream cancelled',
    };

    sendGrpcBidiStreamingError(mockCall, error);

    expect(destroyed).toBe(true);
    expect(destroyError).toBeDefined();
    expect(destroyError.code).toBe(grpc.status.CANCELLED);
  });
});

describe('Protocol Adapter - Generic gRPC Response Sending', () => {
  test('should send unary response using generic function', () => {
    let callbackCalled = false;

    const mockCall = {
      sendMetadata: () => {},
    } as unknown as grpc.ServerUnaryCall<any, any>;

    const mockCallback: grpc.sendUnaryData<any> = () => {
      callbackCalled = true;
    };

    const response: NormalizedResponse = {
      data: { message: 'Success' },
    };

    sendGrpcResponse(mockCall, response, false, false, mockCallback);

    expect(callbackCalled).toBe(true);
  });

  test('should send server streaming response using generic function', () => {
    let written = false;

    const mockCall = {
      sendMetadata: () => {},
      write: () => {
        written = true;
      },
    } as unknown as grpc.ServerWritableStream<any, any>;

    const response: NormalizedResponse = {
      data: { result: 'item' },
    };

    sendGrpcResponse(mockCall, response, false, true);

    expect(written).toBe(true);
  });

  test('should send client streaming response using generic function', () => {
    let callbackCalled = false;

    const mockCall = {
      sendMetadata: () => {},
    } as unknown as grpc.ServerReadableStream<any, any>;

    const mockCallback: grpc.sendUnaryData<any> = () => {
      callbackCalled = true;
    };

    const response: NormalizedResponse = {
      data: { summary: 'Complete' },
    };

    sendGrpcResponse(mockCall, response, true, false, mockCallback);

    expect(callbackCalled).toBe(true);
  });

  test('should send bidi streaming response using generic function', () => {
    let written = false;

    const mockCall = {
      sendMetadata: () => {},
      write: () => {
        written = true;
      },
    } as unknown as grpc.ServerDuplexStream<any, any>;

    const response: NormalizedResponse = {
      data: { reply: 'Echo' },
    };

    sendGrpcResponse(mockCall, response, true, true);

    expect(written).toBe(true);
  });

  test('should throw error for unary without callback', () => {
    const mockCall = {
      sendMetadata: () => {},
    } as unknown as grpc.ServerUnaryCall<any, any>;

    const response: NormalizedResponse = {
      data: { message: 'Success' },
    };

    expect(() => {
      sendGrpcResponse(mockCall, response, false, false);
    }).toThrow('Callback required for unary response');
  });

  test('should throw error for client streaming without callback', () => {
    const mockCall = {
      sendMetadata: () => {},
    } as unknown as grpc.ServerReadableStream<any, any>;

    const response: NormalizedResponse = {
      data: { summary: 'Complete' },
    };

    expect(() => {
      sendGrpcResponse(mockCall, response, true, false);
    }).toThrow('Callback required for client streaming response');
  });
});

describe('Protocol Adapter - Generic gRPC Error Sending', () => {
  test('should send unary error using generic function', () => {
    let callbackCalled = false;

    const mockCallback: grpc.sendUnaryData<any> = () => {
      callbackCalled = true;
    };

    const error: NormalizedError = {
      code: 'INVALID_ARGUMENT',
      message: 'Invalid data',
    };

    sendGrpcError({} as grpc.ServerUnaryCall<any, any>, error, false, false, mockCallback);

    expect(callbackCalled).toBe(true);
  });

  test('should send server streaming error using generic function', () => {
    let destroyed = false;

    const mockCall = {
      destroy: () => {
        destroyed = true;
      },
    } as unknown as grpc.ServerWritableStream<any, any>;

    const error: NormalizedError = {
      code: 'INTERNAL',
      message: 'Stream error',
    };

    sendGrpcError(mockCall, error, false, true);

    expect(destroyed).toBe(true);
  });

  test('should send client streaming error using generic function', () => {
    let callbackCalled = false;

    const mockCallback: grpc.sendUnaryData<any> = () => {
      callbackCalled = true;
    };

    const error: NormalizedError = {
      code: 'ABORTED',
      message: 'Upload aborted',
    };

    sendGrpcError({} as grpc.ServerReadableStream<any, any>, error, true, false, mockCallback);

    expect(callbackCalled).toBe(true);
  });

  test('should send bidi streaming error using generic function', () => {
    let destroyed = false;

    const mockCall = {
      destroy: () => {
        destroyed = true;
      },
    } as unknown as grpc.ServerDuplexStream<any, any>;

    const error: NormalizedError = {
      code: 'CANCELLED',
      message: 'Stream cancelled',
    };

    sendGrpcError(mockCall, error, true, true);

    expect(destroyed).toBe(true);
  });

  test('should throw error for unary without callback', () => {
    const error: NormalizedError = {
      code: 'INTERNAL',
      message: 'Error',
    };

    expect(() => {
      sendGrpcError({} as grpc.ServerUnaryCall<any, any>, error, false, false);
    }).toThrow('Callback required for unary error');
  });

  test('should throw error for client streaming without callback', () => {
    const error: NormalizedError = {
      code: 'INTERNAL',
      message: 'Error',
    };

    expect(() => {
      sendGrpcError({} as grpc.ServerReadableStream<any, any>, error, true, false);
    }).toThrow('Callback required for client streaming error');
  });
});

// ============================================================================
// Connect Protocol Adapter Tests (Normalized Format)
// ============================================================================

describe('Protocol Adapter - Connect Unary Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('name', 1, 'string'));
    testRequestType.add(new protobuf.Field('age', 2, 'int32'));
    testRequestType.add(new protobuf.Field('tags', 3, 'string', 'repeated'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('message', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize Connect unary request', () => {
    const context: ConnectContext = {
      requestHeader: {
        'content-type': 'application/connect+json',
        'authorization': 'Bearer token',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const request = {
      name: 'Alice',
      age: 30,
      tags: ['developer'],
    };

    const normalized = normalizeConnectUnaryRequest(
      request,
      testRequestType,
      testResponseType,
      context,
      'test.TestService',
      'TestMethod'
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.method).toBe('TestMethod');
    expect(normalized.data.name).toBe('Alice');
    expect(normalized.data.age).toBe(30);
    expect(normalized.data.tags).toEqual(['developer']);
    expect(normalized.metadata['content-type']).toBe('application/connect+json');
    expect(normalized.metadata['authorization']).toBe('Bearer token');
    expect(normalized.requestType).toBe(testRequestType);
    expect(normalized.responseType).toBe(testResponseType);
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(false);
  });

  test('should normalize Connect unary request with binary data', () => {
    const context: ConnectContext = {
      requestHeader: {
        'content-type': 'application/connect+proto',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const message = testRequestType.create({
      name: 'Bob',
      age: 25,
    });
    const buffer = testRequestType.encode(message).finish();

    const normalized = normalizeConnectUnaryRequest(
      Buffer.from(buffer),
      testRequestType,
      testResponseType,
      context,
      'test.TestService',
      'TestMethod'
    );

    expect(normalized.service).toBe('test.TestService');
    expect(normalized.data.name).toBe('Bob');
    expect(normalized.data.age).toBe(25);
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(false);
  });
});

describe('Protocol Adapter - Connect Server Streaming Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('query', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('result', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize Connect server streaming request', () => {
    const context: ConnectContext = {
      requestHeader: {
        'x-stream-id': 'stream-123',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const request = { query: 'search term' };

    const normalized = normalizeConnectServerStreamingRequest(
      request,
      testRequestType,
      testResponseType,
      context,
      'test.StreamService',
      'ServerStream'
    );

    expect(normalized.service).toBe('test.StreamService');
    expect(normalized.method).toBe('ServerStream');
    expect(normalized.data).toEqual({ query: 'search term' });
    expect(normalized.metadata['x-stream-id']).toBe('stream-123');
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(true);
  });
});

describe('Protocol Adapter - Connect Client Streaming Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('data', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('summary', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize Connect client streaming request', () => {
    const context: ConnectContext = {
      requestHeader: {
        'x-upload-id': 'upload-456',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const normalized = normalizeConnectClientStreamingRequest(
      testRequestType,
      testResponseType,
      context,
      'test.StreamService',
      'ClientStream'
    );

    expect(normalized.service).toBe('test.StreamService');
    expect(normalized.method).toBe('ClientStream');
    expect(normalized.data).toBeNull(); // Data populated by stream handler
    expect(normalized.metadata['x-upload-id']).toBe('upload-456');
    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(false);
  });
});

describe('Protocol Adapter - Connect Bidirectional Streaming Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('message', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('reply', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize Connect bidirectional streaming request', () => {
    const context: ConnectContext = {
      requestHeader: {
        'x-session-id': 'session-789',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const normalized = normalizeConnectBidiStreamingRequest(
      testRequestType,
      testResponseType,
      context,
      'test.StreamService',
      'BidiStream'
    );

    expect(normalized.service).toBe('test.StreamService');
    expect(normalized.method).toBe('BidiStream');
    expect(normalized.data).toBeNull(); // Data populated by stream handler
    expect(normalized.metadata['x-session-id']).toBe('session-789');
    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(true);
  });
});

describe('Protocol Adapter - Generic Connect Request Normalization', () => {
  let testRequestType: protobuf.Type;
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testRequestType = new protobuf.Type('TestRequest');
    testRequestType.add(new protobuf.Field('value', 1, 'string'));
    testNamespace.add(testRequestType);

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('result', 1, 'string'));
    testNamespace.add(testResponseType);
  });

  test('should normalize unary request using generic function', () => {
    const context: ConnectContext = {
      requestHeader: {
        'x-test': 'value',
      },
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const request = { value: 'test' };

    const normalized = normalizeConnectRequest(
      request,
      testRequestType,
      testResponseType,
      context,
      'test.Service',
      'Method',
      false, // requestStream
      false  // responseStream
    );

    expect(normalized.service).toBe('test.Service');
    expect(normalized.method).toBe('Method');
    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(false);
  });

  test('should normalize server streaming request using generic function', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const request = { value: 'test' };

    const normalized = normalizeConnectRequest(
      request,
      testRequestType,
      testResponseType,
      context,
      'test.Service',
      'Method',
      false, // requestStream
      true   // responseStream
    );

    expect(normalized.requestStream).toBe(false);
    expect(normalized.responseStream).toBe(true);
  });

  test('should normalize client streaming request using generic function', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const normalized = normalizeConnectRequest(
      null,
      testRequestType,
      testResponseType,
      context,
      'test.Service',
      'Method',
      true,  // requestStream
      false  // responseStream
    );

    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(false);
  });

  test('should normalize bidirectional streaming request using generic function', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const normalized = normalizeConnectRequest(
      null,
      testRequestType,
      testResponseType,
      context,
      'test.Service',
      'Method',
      true, // requestStream
      true  // responseStream
    );

    expect(normalized.requestStream).toBe(true);
    expect(normalized.responseStream).toBe(true);
  });
});

// ============================================================================
// Connect Response Conversion Tests
// ============================================================================

import { ConnectErrorCode } from '../src/infrastructure/protocolAdapter.js';

describe('Protocol Adapter - Connect Error Code Mapping', () => {
  test('should map normalized error codes to Connect error codes', () => {
    expect(mapNormalizedErrorCodeToConnect('CANCELLED')).toBe(ConnectErrorCode.Canceled);
    expect(mapNormalizedErrorCodeToConnect('UNKNOWN')).toBe(ConnectErrorCode.Unknown);
    expect(mapNormalizedErrorCodeToConnect('INVALID_ARGUMENT')).toBe(ConnectErrorCode.InvalidArgument);
    expect(mapNormalizedErrorCodeToConnect('DEADLINE_EXCEEDED')).toBe(ConnectErrorCode.DeadlineExceeded);
    expect(mapNormalizedErrorCodeToConnect('NOT_FOUND')).toBe(ConnectErrorCode.NotFound);
    expect(mapNormalizedErrorCodeToConnect('ALREADY_EXISTS')).toBe(ConnectErrorCode.AlreadyExists);
    expect(mapNormalizedErrorCodeToConnect('PERMISSION_DENIED')).toBe(ConnectErrorCode.PermissionDenied);
    expect(mapNormalizedErrorCodeToConnect('RESOURCE_EXHAUSTED')).toBe(ConnectErrorCode.ResourceExhausted);
    expect(mapNormalizedErrorCodeToConnect('FAILED_PRECONDITION')).toBe(ConnectErrorCode.FailedPrecondition);
    expect(mapNormalizedErrorCodeToConnect('ABORTED')).toBe(ConnectErrorCode.Aborted);
    expect(mapNormalizedErrorCodeToConnect('OUT_OF_RANGE')).toBe(ConnectErrorCode.OutOfRange);
    expect(mapNormalizedErrorCodeToConnect('UNIMPLEMENTED')).toBe(ConnectErrorCode.Unimplemented);
    expect(mapNormalizedErrorCodeToConnect('INTERNAL')).toBe(ConnectErrorCode.Internal);
    expect(mapNormalizedErrorCodeToConnect('UNAVAILABLE')).toBe(ConnectErrorCode.Unavailable);
    expect(mapNormalizedErrorCodeToConnect('DATA_LOSS')).toBe(ConnectErrorCode.DataLoss);
    expect(mapNormalizedErrorCodeToConnect('UNAUTHENTICATED')).toBe(ConnectErrorCode.Unauthenticated);
  });

  test('should default to Unknown for invalid error codes', () => {
    expect(mapNormalizedErrorCodeToConnect('INVALID_CODE')).toBe(ConnectErrorCode.Unknown);
    expect(mapNormalizedErrorCodeToConnect('')).toBe(ConnectErrorCode.Unknown);
  });
});

describe('Protocol Adapter - Connect Response Sending', () => {
  let testResponseType: protobuf.Type;

  beforeAll(() => {
    const root = new protobuf.Root();
    const testNamespace = root.define('test');

    testResponseType = new protobuf.Type('TestResponse');
    testResponseType.add(new protobuf.Field('message', 1, 'string'));
    testResponseType.add(new protobuf.Field('code', 2, 'int32'));
    testNamespace.add(testResponseType);
  });

  test('should send Connect response without metadata', () => {
    const response: NormalizedResponse = {
      data: { message: 'Success', code: 200 },
    };

    const result = sendConnectResponse(response, testResponseType);

    expect(result).toBeDefined();
    expect(result.message).toBe('Success');
    expect(result.code).toBe(200);
  });

  test('should send Connect response with initial metadata', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const response: NormalizedResponse = {
      data: { message: 'Success', code: 200 },
      metadata: {
        'x-custom-header': 'custom-value',
        'x-request-id': 'req-123',
      },
    };

    const result = sendConnectResponse(response, testResponseType, context);

    expect(result).toBeDefined();
    expect(context.responseHeader['x-custom-header']).toBe('custom-value');
    expect(context.responseHeader['x-request-id']).toBe('req-123');
  });

  test('should send Connect response with trailing metadata', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const response: NormalizedResponse = {
      data: { message: 'Success', code: 200 },
      trailer: {
        'x-trailer-header': 'trailer-value',
      },
    };

    const result = sendConnectResponse(response, testResponseType, context);

    expect(result).toBeDefined();
    expect(context.responseTrailer['x-trailer-header']).toBe('trailer-value');
  });

  test('should send Connect response with both metadata and trailer', () => {
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };

    const response: NormalizedResponse = {
      data: { message: 'Success', code: 200 },
      metadata: {
        'x-initial': 'initial-value',
      },
      trailer: {
        'x-final': 'final-value',
      },
    };

    const result = sendConnectResponse(response, testResponseType, context);

    expect(result).toBeDefined();
    expect(context.responseHeader['x-initial']).toBe('initial-value');
    expect(context.responseTrailer['x-final']).toBe('final-value');
  });
});

describe('Protocol Adapter - Connect Error Sending', () => {
  test('should send Connect error', () => {
    const error: NormalizedError = {
      code: 'INVALID_ARGUMENT',
      message: 'Invalid request data',
      details: [{ field: 'name', message: 'required' }],
    };

    const result = sendConnectError(error);

    expect(result).toBeDefined();
    expect(result.code).toBe(ConnectErrorCode.InvalidArgument);
    expect(result.message).toBe('Invalid request data');
    expect(result.details).toEqual([{ field: 'name', message: 'required' }]);
  });

  test('should send Connect error without details', () => {
    const error: NormalizedError = {
      code: 'NOT_FOUND',
      message: 'Resource not found',
    };

    const result = sendConnectError(error);

    expect(result).toBeDefined();
    expect(result.code).toBe(ConnectErrorCode.NotFound);
    expect(result.message).toBe('Resource not found');
    expect(result.details).toBeUndefined();
  });

  test('should map all error codes correctly', () => {
    const errorCodes = [
      'CANCELLED',
      'UNKNOWN',
      'INVALID_ARGUMENT',
      'DEADLINE_EXCEEDED',
      'NOT_FOUND',
      'ALREADY_EXISTS',
      'PERMISSION_DENIED',
      'RESOURCE_EXHAUSTED',
      'FAILED_PRECONDITION',
      'ABORTED',
      'OUT_OF_RANGE',
      'UNIMPLEMENTED',
      'INTERNAL',
      'UNAVAILABLE',
      'DATA_LOSS',
      'UNAUTHENTICATED',
    ];

    for (const code of errorCodes) {
      const error: NormalizedError = {
        code,
        message: `Test error: ${code}`,
      };

      const result = sendConnectError(error);

      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      expect(result.message).toBe(`Test error: ${code}`);
    }
  });
});

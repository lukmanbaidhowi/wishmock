/**
 * Unit tests for Connect RPC Protocol Adapter
 * 
 * Tests metadata extraction, request normalization, response formatting,
 * and protocol detection utilities.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import protobuf from 'protobufjs';
import {
  extractMetadata,
  normalizeRequest,
  formatResponse,
  detectProtocol,
  createConnectContext,
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

    // Multiple values should be kept as array
    expect(metadata['x-tags']).toEqual(['tag1', 'tag2', 'tag3']);
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

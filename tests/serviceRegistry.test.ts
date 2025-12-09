/**
 * Unit tests for Connect RPC Service Registry
 * 
 * Tests service discovery from protobuf root, handler generation,
 * and method registration.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import protobuf from 'protobufjs';
import {
  registerServices,
  createMethodHandler,
  type ConnectServiceMeta,
  type ConnectMethodMeta,
} from '../src/infrastructure/serviceRegistry.js';
import type { RuleDoc } from '../src/domain/types.js';
import type { ConnectContext } from '../src/infrastructure/protocolAdapter.js';

describe('Service Registry - Service Discovery', () => {
  let protoRoot: protobuf.Root;
  let rulesIndex: Map<string, RuleDoc>;
  const logs: string[] = [];
  const errors: string[] = [];
  const logger = (...args: any[]) => logs.push(args.join(' '));
  const errorLogger = (...args: any[]) => errors.push(args.join(' '));

  beforeAll(() => {
    // Create a test proto root with multiple services
    protoRoot = new protobuf.Root();
    
    // Package 1: helloworld
    const helloworldNs = protoRoot.define('helloworld');
    
    const helloRequest = new protobuf.Type('HelloRequest');
    helloRequest.add(new protobuf.Field('name', 1, 'string'));
    helloworldNs.add(helloRequest);
    
    const helloResponse = new protobuf.Type('HelloResponse');
    helloResponse.add(new protobuf.Field('message', 1, 'string'));
    helloworldNs.add(helloResponse);
    
    const greeterService = new protobuf.Service('Greeter');
    greeterService.add(new protobuf.Method('SayHello', 'rpc', 'HelloRequest', 'HelloResponse'));
    greeterService.add(new protobuf.Method('SayGoodbye', 'rpc', 'HelloRequest', 'HelloResponse'));
    helloworldNs.add(greeterService);
    
    // Package 2: test.nested
    const testNs = protoRoot.define('test');
    const nestedNs = testNs.define('nested');
    
    const testRequest = new protobuf.Type('TestRequest');
    testRequest.add(new protobuf.Field('id', 1, 'int32'));
    nestedNs.add(testRequest);
    
    const testResponse = new protobuf.Type('TestResponse');
    testResponse.add(new protobuf.Field('result', 1, 'string'));
    nestedNs.add(testResponse);
    
    const testService = new protobuf.Service('TestService');
    testService.add(new protobuf.Method('RunTest', 'rpc', 'TestRequest', 'TestResponse'));
    nestedNs.add(testService);
    
    // Initialize rules index
    rulesIndex = new Map();
  });

  test('should discover all services from proto root', () => {
    logs.length = 0;
    errors.length = 0;
    
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    // Should discover 2 services
    expect(services.size).toBe(2);
    expect(services.has('helloworld.Greeter')).toBe(true);
    expect(services.has('test.nested.TestService')).toBe(true);
  });

  test('should correctly identify service metadata', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    const greeter = services.get('helloworld.Greeter');
    expect(greeter).toBeDefined();
    expect(greeter?.serviceName).toBe('Greeter');
    expect(greeter?.fullServiceName).toBe('helloworld.Greeter');
    expect(greeter?.packageName).toBe('helloworld');
    
    const testService = services.get('test.nested.TestService');
    expect(testService).toBeDefined();
    expect(testService?.serviceName).toBe('TestService');
    expect(testService?.fullServiceName).toBe('test.nested.TestService');
    expect(testService?.packageName).toBe('test.nested');
  });

  test('should discover all methods in each service', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    const greeter = services.get('helloworld.Greeter');
    expect(greeter?.methods.size).toBe(2);
    expect(greeter?.methods.has('SayHello')).toBe(true);
    expect(greeter?.methods.has('SayGoodbye')).toBe(true);
    
    const testService = services.get('test.nested.TestService');
    expect(testService?.methods.size).toBe(1);
    expect(testService?.methods.has('RunTest')).toBe(true);
  });

  test('should correctly identify method metadata', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    const greeter = services.get('helloworld.Greeter');
    const sayHello = greeter?.methods.get('SayHello');
    
    expect(sayHello).toBeDefined();
    expect(sayHello?.methodName).toBe('SayHello');
    expect(sayHello?.requestType.name).toBe('HelloRequest');
    expect(sayHello?.responseType.name).toBe('HelloResponse');
    expect(sayHello?.requestStream).toBe(false);
    expect(sayHello?.responseStream).toBe(false);
    expect(sayHello?.ruleKey).toBe('helloworld.greeter.sayhello');
    expect(sayHello?.handler).toBeDefined();
    expect(typeof sayHello?.handler).toBe('function');
  });

  test('should generate correct rule keys', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    const greeter = services.get('helloworld.Greeter');
    expect(greeter?.methods.get('SayHello')?.ruleKey).toBe('helloworld.greeter.sayhello');
    expect(greeter?.methods.get('SayGoodbye')?.ruleKey).toBe('helloworld.greeter.saygoodbye');
    
    const testService = services.get('test.nested.TestService');
    expect(testService?.methods.get('RunTest')?.ruleKey).toBe('test.nested.testservice.runtest');
  });

  test('should log service registration', () => {
    logs.length = 0;
    
    registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    // Should log registration for each service
    const registrationLogs = logs.filter(log => log.includes('Registered Connect service'));
    expect(registrationLogs.length).toBeGreaterThanOrEqual(2);
    
    // Should log discovery summary
    const discoveryLogs = logs.filter(log => log.includes('Discovered'));
    expect(discoveryLogs.length).toBeGreaterThanOrEqual(1);
  });

  test('should handle empty proto root', () => {
    logs.length = 0;
    const emptyRoot = new protobuf.Root();
    
    const services = registerServices(emptyRoot, rulesIndex, logger, errorLogger);
    
    expect(services.size).toBe(0);
    
    // Should log warning about no services
    const warningLogs = logs.filter(log => log.includes('No services discovered'));
    expect(warningLogs.length).toBeGreaterThanOrEqual(1);
  });

  test('should handle proto root with only messages (no services)', () => {
    const messagesOnlyRoot = new protobuf.Root();
    const ns = messagesOnlyRoot.define('messages');
    
    const msg = new protobuf.Type('Message');
    msg.add(new protobuf.Field('text', 1, 'string'));
    ns.add(msg);
    
    const services = registerServices(messagesOnlyRoot, rulesIndex, logger, errorLogger);
    
    expect(services.size).toBe(0);
  });

  test('should skip methods with missing types', () => {
    errors.length = 0;
    
    // Create a proto root with a service that references non-existent types
    const badRoot = new protobuf.Root();
    const ns = badRoot.define('bad');
    
    // Create service without defining the request/response types
    const badService = new protobuf.Service('BadService');
    badService.add(new protobuf.Method('BadMethod', 'rpc', 'MissingRequest', 'MissingResponse'));
    ns.add(badService);
    
    const services = registerServices(badRoot, rulesIndex, logger, errorLogger);
    
    // Service should be registered but method should be skipped
    const badSvc = services.get('bad.BadService');
    expect(badSvc).toBeDefined();
    expect(badSvc?.methods.size).toBe(0);
    
    // Should log error about missing types
    expect(errors.length).toBeGreaterThan(0);
    const typeErrors = errors.filter(err => err.includes('Failed to lookup types'));
    expect(typeErrors.length).toBeGreaterThan(0);
  });
});

describe('Service Registry - Streaming Method Detection', () => {
  let protoRoot: protobuf.Root;
  let rulesIndex: Map<string, RuleDoc>;
  const logger = () => {};
  const errorLogger = () => {};

  beforeAll(() => {
    // Create proto root with streaming methods
    protoRoot = new protobuf.Root();
    const streamingNs = protoRoot.define('streaming');
    
    const streamRequest = new protobuf.Type('StreamRequest');
    streamRequest.add(new protobuf.Field('id', 1, 'int32'));
    streamingNs.add(streamRequest);
    
    const streamResponse = new protobuf.Type('StreamResponse');
    streamResponse.add(new protobuf.Field('data', 1, 'string'));
    streamingNs.add(streamResponse);
    
    const streamService = new protobuf.Service('StreamService');
    
    // Unary
    const unaryMethod = new protobuf.Method('Unary', 'rpc', 'StreamRequest', 'StreamResponse');
    streamService.add(unaryMethod);
    
    // Server streaming
    const serverStreamMethod = new protobuf.Method('ServerStream', 'rpc', 'StreamRequest', 'StreamResponse');
    serverStreamMethod.responseStream = true;
    streamService.add(serverStreamMethod);
    
    // Client streaming
    const clientStreamMethod = new protobuf.Method('ClientStream', 'rpc', 'StreamRequest', 'StreamResponse');
    clientStreamMethod.requestStream = true;
    streamService.add(clientStreamMethod);
    
    // Bidirectional streaming
    const bidiStreamMethod = new protobuf.Method('BidiStream', 'rpc', 'StreamRequest', 'StreamResponse');
    bidiStreamMethod.requestStream = true;
    bidiStreamMethod.responseStream = true;
    streamService.add(bidiStreamMethod);
    
    streamingNs.add(streamService);
    
    rulesIndex = new Map();
  });

  test('should detect unary methods', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const streamService = services.get('streaming.StreamService');
    const unary = streamService?.methods.get('Unary');
    
    expect(unary?.requestStream).toBe(false);
    expect(unary?.responseStream).toBe(false);
  });

  test('should detect server streaming methods', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const streamService = services.get('streaming.StreamService');
    const serverStream = streamService?.methods.get('ServerStream');
    
    expect(serverStream?.requestStream).toBe(false);
    expect(serverStream?.responseStream).toBe(true);
  });

  test('should detect client streaming methods', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const streamService = services.get('streaming.StreamService');
    const clientStream = streamService?.methods.get('ClientStream');
    
    expect(clientStream?.requestStream).toBe(true);
    expect(clientStream?.responseStream).toBe(false);
  });

  test('should detect bidirectional streaming methods', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const streamService = services.get('streaming.StreamService');
    const bidiStream = streamService?.methods.get('BidiStream');
    
    expect(bidiStream?.requestStream).toBe(true);
    expect(bidiStream?.responseStream).toBe(true);
  });
});

describe('Service Registry - Handler Generation', () => {
  let reqType: protobuf.Type;
  let resType: protobuf.Type;
  let rulesIndex: Map<string, RuleDoc>;
  const logger = () => {};
  const errorLogger = () => {};

  beforeAll(() => {
    // Create test types
    const root = new protobuf.Root();
    const ns = root.define('test');
    
    reqType = new protobuf.Type('Request');
    reqType.add(new protobuf.Field('name', 1, 'string'));
    ns.add(reqType);
    
    resType = new protobuf.Type('Response');
    resType.add(new protobuf.Field('message', 1, 'string'));
    ns.add(resType);
    
    // Setup rules index with test rule
    rulesIndex = new Map();
    rulesIndex.set('test.service.method', {
      response: {
        body: { message: 'Test response' },
      },
    } as RuleDoc);
  });

  test('should create unary handler', () => {
    const handler = createMethodHandler(
      'test.Service',
      'Method',
      reqType,
      resType,
      false, // requestStream
      false, // responseStream
      'test.service.method',
      rulesIndex,
      logger,
      errorLogger
    );
    
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  test('should create server streaming handler', () => {
    const handler = createMethodHandler(
      'test.Service',
      'Method',
      reqType,
      resType,
      false, // requestStream
      true,  // responseStream
      'test.service.method',
      rulesIndex,
      logger,
      errorLogger
    );
    
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  test('should create client streaming handler', () => {
    const handler = createMethodHandler(
      'test.Service',
      'Method',
      reqType,
      resType,
      true,  // requestStream
      false, // responseStream
      'test.service.method',
      rulesIndex,
      logger,
      errorLogger
    );
    
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  test('should create bidirectional streaming handler', () => {
    const handler = createMethodHandler(
      'test.Service',
      'Method',
      reqType,
      resType,
      true, // requestStream
      true, // responseStream
      'test.service.method',
      rulesIndex,
      logger,
      errorLogger
    );
    
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  test('unary handler should return Promise', () => {
    const handler = createMethodHandler(
      'test.Service',
      'Method',
      reqType,
      resType,
      false,
      false,
      'test.service.method',
      rulesIndex,
      logger,
      errorLogger
    );
    
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };
    
    const result = handler({ name: 'test' }, context);
    expect(result).toBeInstanceOf(Promise);
  });

  test('server streaming handler should return AsyncGenerator', () => {
    const handler = createMethodHandler(
      'test.Service',
      'Method',
      reqType,
      resType,
      false,
      true,
      'test.service.method',
      rulesIndex,
      logger,
      errorLogger
    );
    
    const context: ConnectContext = {
      requestHeader: {},
      responseHeader: {},
      responseTrailer: {},
      protocol: 'connect',
    };
    
    const result = handler({ name: 'test' }, context);
    
    // AsyncGenerator has next, return, throw methods
    expect(typeof (result as any).next).toBe('function');
    expect(typeof (result as any).return).toBe('function');
    expect(typeof (result as any).throw).toBe('function');
  });
});

describe('Service Registry - Method Registration', () => {
  let protoRoot: protobuf.Root;
  let rulesIndex: Map<string, RuleDoc>;
  const logger = () => {};
  const errorLogger = () => {};

  beforeAll(() => {
    // Create proto root with multiple methods
    protoRoot = new protobuf.Root();
    const ns = protoRoot.define('registration');
    
    const req = new protobuf.Type('Req');
    req.add(new protobuf.Field('id', 1, 'int32'));
    ns.add(req);
    
    const res = new protobuf.Type('Res');
    res.add(new protobuf.Field('status', 1, 'string'));
    ns.add(res);
    
    const service = new protobuf.Service('TestService');
    service.add(new protobuf.Method('Method1', 'rpc', 'Req', 'Res'));
    service.add(new protobuf.Method('Method2', 'rpc', 'Req', 'Res'));
    service.add(new protobuf.Method('Method3', 'rpc', 'Req', 'Res'));
    ns.add(service);
    
    rulesIndex = new Map();
  });

  test('should register all methods in service', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const testService = services.get('registration.TestService');
    
    expect(testService?.methods.size).toBe(3);
    expect(testService?.methods.has('Method1')).toBe(true);
    expect(testService?.methods.has('Method2')).toBe(true);
    expect(testService?.methods.has('Method3')).toBe(true);
  });

  test('should create unique handlers for each method', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const testService = services.get('registration.TestService');
    
    const handler1 = testService?.methods.get('Method1')?.handler;
    const handler2 = testService?.methods.get('Method2')?.handler;
    const handler3 = testService?.methods.get('Method3')?.handler;
    
    // Each handler should be a unique function instance
    expect(handler1).not.toBe(handler2);
    expect(handler2).not.toBe(handler3);
    expect(handler1).not.toBe(handler3);
  });

  test('should associate correct types with each method', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const testService = services.get('registration.TestService');
    
    const method1 = testService?.methods.get('Method1');
    expect(method1?.requestType.name).toBe('Req');
    expect(method1?.responseType.name).toBe('Res');
    
    const method2 = testService?.methods.get('Method2');
    expect(method2?.requestType.name).toBe('Req');
    expect(method2?.responseType.name).toBe('Res');
  });

  test('should generate unique rule keys for each method', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const testService = services.get('registration.TestService');
    
    const ruleKeys = new Set<string>();
    testService?.methods.forEach(method => {
      ruleKeys.add(method.ruleKey);
    });
    
    // All rule keys should be unique
    expect(ruleKeys.size).toBe(3);
    expect(ruleKeys.has('registration.testservice.method1')).toBe(true);
    expect(ruleKeys.has('registration.testservice.method2')).toBe(true);
    expect(ruleKeys.has('registration.testservice.method3')).toBe(true);
  });
});

describe('Service Registry - Complex Package Structures', () => {
  let protoRoot: protobuf.Root;
  let rulesIndex: Map<string, RuleDoc>;
  const logger = () => {};
  const errorLogger = () => {};

  beforeAll(() => {
    // Create proto root with deeply nested packages
    protoRoot = new protobuf.Root();
    
    // com.example.api.v1
    const com = protoRoot.define('com');
    const example = com.define('example');
    const api = example.define('api');
    const v1 = api.define('v1');
    
    const req = new protobuf.Type('Request');
    req.add(new protobuf.Field('data', 1, 'string'));
    v1.add(req);
    
    const res = new protobuf.Type('Response');
    res.add(new protobuf.Field('result', 1, 'string'));
    v1.add(res);
    
    const service = new protobuf.Service('ApiService');
    service.add(new protobuf.Method('Execute', 'rpc', 'Request', 'Response'));
    v1.add(service);
    
    rulesIndex = new Map();
  });

  test('should handle deeply nested packages', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    expect(services.size).toBe(1);
    expect(services.has('com.example.api.v1.ApiService')).toBe(true);
  });

  test('should generate correct full service name for nested packages', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const apiService = services.get('com.example.api.v1.ApiService');
    
    expect(apiService?.fullServiceName).toBe('com.example.api.v1.ApiService');
    expect(apiService?.packageName).toBe('com.example.api.v1');
    expect(apiService?.serviceName).toBe('ApiService');
  });

  test('should generate correct rule key for nested packages', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    const apiService = services.get('com.example.api.v1.ApiService');
    const execute = apiService?.methods.get('Execute');
    
    expect(execute?.ruleKey).toBe('com.example.api.v1.apiservice.execute');
  });
});

describe('Service Registry - Multiple Services in Same Package', () => {
  let protoRoot: protobuf.Root;
  let rulesIndex: Map<string, RuleDoc>;
  const logger = () => {};
  const errorLogger = () => {};

  beforeAll(() => {
    // Create proto root with multiple services in same package
    protoRoot = new protobuf.Root();
    const pkg = protoRoot.define('mypackage');
    
    const req = new protobuf.Type('Req');
    req.add(new protobuf.Field('id', 1, 'int32'));
    pkg.add(req);
    
    const res = new protobuf.Type('Res');
    res.add(new protobuf.Field('status', 1, 'string'));
    pkg.add(res);
    
    // Service 1
    const service1 = new protobuf.Service('ServiceA');
    service1.add(new protobuf.Method('MethodA', 'rpc', 'Req', 'Res'));
    pkg.add(service1);
    
    // Service 2
    const service2 = new protobuf.Service('ServiceB');
    service2.add(new protobuf.Method('MethodB', 'rpc', 'Req', 'Res'));
    pkg.add(service2);
    
    // Service 3
    const service3 = new protobuf.Service('ServiceC');
    service3.add(new protobuf.Method('MethodC', 'rpc', 'Req', 'Res'));
    pkg.add(service3);
    
    rulesIndex = new Map();
  });

  test('should register all services in same package', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    expect(services.size).toBe(3);
    expect(services.has('mypackage.ServiceA')).toBe(true);
    expect(services.has('mypackage.ServiceB')).toBe(true);
    expect(services.has('mypackage.ServiceC')).toBe(true);
  });

  test('should maintain separate method maps for each service', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    const serviceA = services.get('mypackage.ServiceA');
    const serviceB = services.get('mypackage.ServiceB');
    const serviceC = services.get('mypackage.ServiceC');
    
    expect(serviceA?.methods.size).toBe(1);
    expect(serviceB?.methods.size).toBe(1);
    expect(serviceC?.methods.size).toBe(1);
    
    expect(serviceA?.methods.has('MethodA')).toBe(true);
    expect(serviceB?.methods.has('MethodB')).toBe(true);
    expect(serviceC?.methods.has('MethodC')).toBe(true);
  });

  test('should generate unique rule keys for methods in different services', () => {
    const services = registerServices(protoRoot, rulesIndex, logger, errorLogger);
    
    const serviceA = services.get('mypackage.ServiceA');
    const serviceB = services.get('mypackage.ServiceB');
    const serviceC = services.get('mypackage.ServiceC');
    
    expect(serviceA?.methods.get('MethodA')?.ruleKey).toBe('mypackage.servicea.methoda');
    expect(serviceB?.methods.get('MethodB')?.ruleKey).toBe('mypackage.serviceb.methodb');
    expect(serviceC?.methods.get('MethodC')?.ruleKey).toBe('mypackage.servicec.methodc');
  });
});

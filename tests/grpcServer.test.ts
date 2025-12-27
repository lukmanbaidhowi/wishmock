import { describe, it, expect, beforeEach, vi } from "bun:test";
import protobuf from "protobufjs";
import { createGrpcServer } from "../src/infrastructure/grpcServer.js";

const serverCtorMock = vi.fn(() => ({ addService: vi.fn() }));
const loadPackageDefinitionMock = vi.fn();
const protoLoaderLoadSyncMock = vi.fn();
const wrapServerMock = vi.fn((server: any) => server);

// Mock objects for injection
const mockGrpc = {
  Server: serverCtorMock,
  loadPackageDefinition: loadPackageDefinitionMock,
  status: {
    CANCELLED: 1,
    INTERNAL: 13
  },
  Metadata: class { },
} as any;

const mockProtoLoader = {
  loadSync: protoLoaderLoadSyncMock,
} as any;

describe("createGrpcServer", () => {
  beforeEach(() => {
    serverCtorMock.mockClear();
    serverCtorMock.mockImplementation(() => ({ addService: vi.fn() }));
    loadPackageDefinitionMock.mockReset();
    protoLoaderLoadSyncMock.mockReset();
    wrapServerMock.mockClear();
    wrapServerMock.mockImplementation((server: any) => server);
  });

  function buildRoot() {
    const root = protobuf.Root.fromJSON({
      nested: {
        example: {
          nested: {
            HelloRequest: { fields: { name: { type: "string", id: 1 } } },
            HelloReply: { fields: { message: { type: "string", id: 1 } } },
            Greeter: {
              methods: {
                SayHello: {
                  requestType: "example.HelloRequest",
                  responseType: "example.HelloReply",
                  comment: ""
                },
              },
            },
          },
        },
      },
    });
    (root as any).files = ["/virtual/hello.proto"];
    return root;
  }

  it("uses proto-loader definition when available", async () => {
    const root = buildRoot();
    const rules = new Map([
      ["example.greeter.sayhello", { responses: [{ body: { message: "hi" } }] }],
    ]);
    const pkgDef = Symbol("pkgDef");
    protoLoaderLoadSyncMock.mockReturnValue(pkgDef);
    const serviceDefinition = { sayHello: {} };
    const packageObject = { example: { Greeter: { service: serviceDefinition } } };
    loadPackageDefinitionMock.mockReturnValue(packageObject);

    const log = vi.fn();
    const err = vi.fn();

    const { servicesMap } = await createGrpcServer(
      root,
      rules as any,
      log,
      err,
      { entryFiles: ["/virtual/hello.proto"] },
      {
        grpc: mockGrpc,
        protoLoader: mockProtoLoader,
        wrapServerWithReflection: wrapServerMock,
      }
    );

    expect(protoLoaderLoadSyncMock).toHaveBeenCalledWith([
      "/virtual/hello.proto",
    ], expect.objectContaining({ includeDirs: [] }));

    expect(loadPackageDefinitionMock).toHaveBeenCalledWith(pkgDef);

    const serverInstance = serverCtorMock.mock.results[0].value as { addService: vi.Mock };
    expect(serverInstance.addService).toHaveBeenCalledTimes(1);
    const [def, impl] = serverInstance.addService.mock.calls[0];
    expect(def).toBe(serviceDefinition);
    expect(typeof impl.sayHello).toBe("function");

    expect(wrapServerMock).toHaveBeenCalledTimes(1);
    expect(wrapServerMock.mock.calls[0][1]).toEqual({ packageObject });

    expect([...servicesMap.keys()]).toEqual(["example.Greeter/SayHello"]);
  });

  it("falls back to fallback definition when packageObject does not have service", async () => {
    const root = buildRoot();
    const rules = new Map([
      ["example.greeter.sayhello", { responses: [{ body: { message: "hi" } }] }],
    ]);
    protoLoaderLoadSyncMock.mockReturnValue(Symbol("pkgDef"));
    loadPackageDefinitionMock.mockReturnValue({});

    const log = vi.fn();
    const err = vi.fn();

    const { servicesMap } = await createGrpcServer(
      root,
      rules as any,
      log,
      err,
      { entryFiles: ["/virtual/hello.proto"] },
      {
        grpc: mockGrpc,
        protoLoader: mockProtoLoader,
        wrapServerWithReflection: wrapServerMock,
      }
    );

    const serverInstance = serverCtorMock.mock.results[0].value as { addService: vi.Mock };
    expect(serverInstance.addService).toHaveBeenCalledTimes(1);
    const [def, impl] = serverInstance.addService.mock.calls[0];
    expect(def).toHaveProperty("sayHello.path", "/example.Greeter/SayHello");
    expect(def).toHaveProperty("sayHello.requestStream", false);
    expect(def).toHaveProperty("sayHello.responseStream", false);
    expect(typeof def.sayHello.requestSerialize).toBe("function");
    expect(typeof def.sayHello.responseDeserialize).toBe("function");
    expect(typeof impl.sayHello).toBe("function");

    expect(wrapServerMock).toHaveBeenCalledTimes(1);
    expect(wrapServerMock.mock.calls[0][1]).toEqual({ packageObject: {} });

    expect([...servicesMap.keys()]).toEqual(["example.Greeter/SayHello"]);
  });
});

import { describe, it, expect, vi } from "bun:test";
import { EventEmitter } from "events";
import wrapServerWithReflection from "../src/infrastructure/reflection.js";
import {
  FileDescriptorProto,
  DescriptorProto,
  ServiceDescriptorProto,
  MethodDescriptorProto,
} from "google-protobuf/google/protobuf/descriptor_pb.js";

type FakeServer = { addService: ReturnType<typeof vi.fn> };

type DescriptorOptions = {
  fileName?: string;
  packageName?: string;
  serviceName?: string;
  methodName?: string;
};

function createDescriptorBuffer(options: DescriptorOptions = {}): Buffer {
  const fileName = options.fileName ?? "example.proto";
  const packageName = options.packageName ?? "example";
  const serviceName = options.serviceName ?? "Greeter";
  const methodName = options.methodName ?? "SayHello";

  const file = new FileDescriptorProto();
  file.setName(fileName);
  file.setPackage(packageName);

  const request = new DescriptorProto();
  request.setName("HelloRequest");
  const response = new DescriptorProto();
  response.setName("HelloReply");

  file.addMessageType(request);
  file.addMessageType(response);

  const service = new ServiceDescriptorProto();
  service.setName(serviceName);
  const method = new MethodDescriptorProto();
  method.setName(methodName);
  method.setInputType(`.${packageName}.HelloRequest`);
  method.setOutputType(`.${packageName}.HelloReply`);
  service.addMethod(method);
  file.addService(service);

  return Buffer.from(file.serializeBinary());
}

describe("wrapServerWithReflection", () => {
  it("menambahkan layanan reflection ke server dasar", () => {
    const baseServer: FakeServer = { addService: vi.fn() };

    wrapServerWithReflection(baseServer as any);

    expect(baseServer.addService).toHaveBeenCalledTimes(1);
    const [serviceDef, handlers] = baseServer.addService.mock.calls[0];
    expect(typeof serviceDef.ServerReflectionInfo).toBe("object");
    expect(typeof handlers.ServerReflectionInfo).toBe("function");
  });

  it("mengembalikan daftar layanan dan descriptor untuk simbol yang diminta", () => {
    const baseServer: FakeServer = { addService: vi.fn() };
    const serverProxy = wrapServerWithReflection(baseServer as any);
    const [, reflectionHandlers] = baseServer.addService.mock.calls[0];

    const descriptor = createDescriptorBuffer({ fileName: "hello.proto", packageName: "pkg", serviceName: "Greeter" });
    const serviceDef = {
      SayHello: {
        path: "/pkg.Greeter/SayHello",
        requestType: { fileDescriptorProtos: [descriptor] },
        responseType: { fileDescriptorProtos: [descriptor] },
      },
    };

    serverProxy.addService(serviceDef as any, {});

    const emitter = new EventEmitter();
    const writes: any[] = [];
    const call = {
      on: (event: string, handler: (...args: any[]) => void) => {
        emitter.on(event, handler);
      },
      write: (payload: any) => {
        writes.push(payload);
      },
      end: vi.fn(),
    };

    reflectionHandlers.ServerReflectionInfo(call as any);

    emitter.emit("data", { listServices: {} });
    const services = writes[0].listServicesResponse.service.map((s: any) => s.name);
    expect(services).toContain("pkg.Greeter");

    const writeCount = writes.length;
    emitter.emit("data", { fileContainingSymbol: "pkg.Greeter" });
    const descriptorResponse = writes.slice(writeCount)[0].fileDescriptorResponse;

    expect(descriptorResponse.fileDescriptorProto).toHaveLength(1);
    const decoded = FileDescriptorProto.deserializeBinary(descriptorResponse.fileDescriptorProto[0]);
    expect(decoded.getName()).toBe("hello.proto");
  });

  it("mengirim descriptor yang dipanen dari packageObject saat layanan tidak memiliki metadata", () => {
    const baseServer: FakeServer = { addService: vi.fn() };
    const descriptor = createDescriptorBuffer({ fileName: "package-only.proto", packageName: "custom" });
    const packageObject = { Foo: { fileDescriptorProtos: [descriptor] } };

    wrapServerWithReflection(baseServer as any, { packageObject });
    const [, reflectionHandlers] = baseServer.addService.mock.calls[0];

    const emitter = new EventEmitter();
    const writes: any[] = [];
    const call = {
      on: (event: string, handler: (...args: any[]) => void) => {
        emitter.on(event, handler);
      },
      write: (payload: any) => {
        writes.push(payload);
      },
      end: vi.fn(),
    };

    reflectionHandlers.ServerReflectionInfo(call as any);

    emitter.emit("data", { fileContainingSymbol: "custom.Symbol" });
    const response = writes[0].fileDescriptorResponse;

    expect(response.fileDescriptorProto.length).toBeGreaterThan(0);
    const decodedNames = Array.from(response.fileDescriptorProto, (buf: Uint8Array) => {
      try { return FileDescriptorProto.deserializeBinary(buf).getName(); } catch { return null; }
    });
    expect(decodedNames).toContain("package-only.proto");
  });
});

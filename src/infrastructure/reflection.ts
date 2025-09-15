import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { createRequire } from "module";
import { FileDescriptorProto } from "google-protobuf/google/protobuf/descriptor_pb.js";

// A reflection wrapper that unions file descriptors across all added services
// so tools like grpcurl can resolve transitive dependencies (e.g., google/type/*).
export default function wrapServerWithReflection(server: grpc.Server, opts?: { packageObject?: any }): grpc.Server {
  const services: any[] = [];
  const fileDescriptorSet = new Set<string>(); // base64-encoded buffers (stable as Set keys)
  let indexDirty = true;
  const fdByName = new Map<string, Uint8Array>();
  const symbolToFile = new Map<string, string>();

  function rebuildIndex() {
    fdByName.clear();
    symbolToFile.clear();

    const addFd = (name: string, buf: Uint8Array) => {
      if (!name) return;
      if (!fdByName.has(name)) fdByName.set(name, buf);
    };

    for (const b64 of fileDescriptorSet) {
      const buf = Buffer.from(b64, "base64");
      const fdp = FileDescriptorProto.deserializeBinary(buf);
      const fileName = fdp.getName();
      
      // Index by multiple candidate keys to handle absolute/relative mismatches
      // that can happen between descriptor file names and dependency entries
      // (e.g., "/abs/.../protos/google/type/datetime.proto" vs "google/type/datetime.proto").
      const posixName = (fileName || "").replace(/\\/g, "/");
      const baseName = posixName ? posixName.substring(posixName.lastIndexOf("/") + 1) : "";
      // Try to strip well-known vendor prefixes to get a stable relative name
      const vendorRoots = ["/google/", "/validate/", "/opentelemetry/", "/envoy/", "/protoc-gen-openapiv2/"];
      let vendorRel = "";
      for (const root of vendorRoots) {
        const idx = posixName.indexOf(root);
        if (idx >= 0) { vendorRel = posixName.slice(idx + 1); break; }
      }

      addFd(fileName, buf);
      if (posixName && posixName !== fileName) addFd(posixName, buf);
      if (vendorRel) addFd(vendorRel, buf);
      if (baseName) addFd(baseName, buf);
      const pkg = fdp.getPackage() || "";
      const pref = pkg ? pkg + "." : "";
      // services
      for (const svc of fdp.getServiceList()) {
        const name = pref + svc.getName();
        symbolToFile.set(name, fileName);
      }
      // messages
      for (const msg of fdp.getMessageTypeList()) {
        const name = pref + msg.getName();
        symbolToFile.set(name, fileName);
      }
      // enums
      for (const en of fdp.getEnumTypeList()) {
        const name = pref + en.getName();
        symbolToFile.set(name, fileName);
      }
    }
    indexDirty = false;
  }

  function addFdpBuffer(b: Buffer | Uint8Array) {
    const b64 = Buffer.from(b).toString("base64");
    if (!fileDescriptorSet.has(b64)) {
      fileDescriptorSet.add(b64);
      indexDirty = true;
    }
  }

  function collectDescriptorsFromService(serviceDef: Record<string, any>) {
    for (const def of Object.values(serviceDef)) {
      const req = (def as any)?.requestType?.fileDescriptorProtos as Buffer[] | undefined;
      const res = (def as any)?.responseType?.fileDescriptorProtos as Buffer[] | undefined;
      if (Array.isArray(req)) for (const b of req) addFdpBuffer(b);
      if (Array.isArray(res)) for (const b of res) addFdpBuffer(b);
    }
  }

  const serverProxy = new Proxy(server as any, {
    get(target, prop, receiver) {
      if (prop === "addService") {
        return (service: any, implementation: any) => {
          try { services.push(service); collectDescriptorsFromService(service); } catch {}
          return target.addService(service, implementation);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as grpc.Server;

  // Load the official reflection proto from the installed module path
  const req = createRequire(import.meta.url);
  const modPkgPath = req.resolve("grpc-node-server-reflection/package.json");
  const reflectionProto = path.join(path.dirname(modPkgPath), "proto/grpc/reflection/v1alpha/reflection.proto");
  const pkgDef = protoLoader.loadSync(reflectionProto);
  const pkg = grpc.loadPackageDefinition(pkgDef) as any;
  const reflectionService = pkg.grpc.reflection.v1alpha.ServerReflection.service;

  // If a loaded packageObject is provided, harvest any message types that carry
  // fileDescriptorProtos (e.g., google.type.DateTime) to ensure dependencies
  // like google/type/* are present in the reflection descriptor set.
  try {
    const po = opts?.packageObject;
    if (po && (typeof po === "object" || typeof po === "function")) {
      const seen = new Set<any>();
      const visit = (node: any) => {
        if (!node || seen.has(node)) return;
        const t = typeof node;
        if (t !== "object" && t !== "function") return;
        seen.add(node);
        // Message constructors from grpc.loadPackageDefinition are functions
        // with a fileDescriptorProtos array attached.
        const fdpList = (node as any).fileDescriptorProtos as Buffer[] | undefined;
        if (Array.isArray(fdpList)) {
          for (const b of fdpList) fileDescriptorSet.add(Buffer.from(b).toString("base64"));
        }
        // Recurse into object/function properties
        try {
          for (const v of Object.values(node)) visit(v);
        } catch {}
      };
      visit(po);
    }
  } catch {}

  const handlers = {
    ServerReflectionInfo(call: grpc.ServerDuplexStream<any, any>) {
      call.on("data", (request: any) => {
        const { listServices, fileContainingSymbol } = request;
        if (listServices) {
          const names = services.map((svc) => {
            const first = Object.values(svc)[0] as any;
            const name = first?.path?.split("/")?.[1] || "Unknown";
            return { name };
          });
          call.write({ listServicesResponse: { service: names } });
        }
        if (fileContainingSymbol) {
          if (indexDirty) rebuildIndex();
          const target = symbolToFile.get(fileContainingSymbol);
          if (!target) {
            // Fallback: return everything we have
            const files = Array.from(fileDescriptorSet).map((b64) => Buffer.from(b64, "base64"));
            call.write({ fileDescriptorResponse: { fileDescriptorProto: files } });
            return;
          }
          // Compute dependency-closed set starting from the file that defines the symbol
          const visited = new Set<string>();
          const result: Uint8Array[] = [];
          const queue: string[] = [target];
          while (queue.length) {
            const name = queue.shift()!;
            if (visited.has(name)) continue;
            visited.add(name);
            const buf = fdByName.get(name);
            if (!buf) continue;
            result.push(buf);
            try {
              const fdp = FileDescriptorProto.deserializeBinary(buf);
              for (const depName of fdp.getDependencyList()) {
                if (!visited.has(depName)) queue.push(depName);
              }
            } catch {}
          }
          call.write({ fileDescriptorResponse: { fileDescriptorProto: result } });
        }
      });
      call.on("end", () => call.end());
    },
  };

  (serverProxy as any).addService(reflectionService, handlers);
  return serverProxy;
}

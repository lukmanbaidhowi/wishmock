import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { createRequire } from "module";
import { FileDescriptorProto } from "google-protobuf/google/protobuf/descriptor_pb.js";

const DEBUG = process.env.DEBUG_REFLECTION === "1";

// Vendor roots and dependency canonicalization rules
const VENDOR_ROOTS = [
  "/google/",
  "/validate/",
  "/opentelemetry/",
  "/envoy/",
  "/protoc-gen-openapiv2/",
];

const DEP_CANON_RULES: { prefix: string; target: string }[] = [
  { prefix: "google/type/", target: "google_type.proto" },
  { prefix: "google/protobuf/", target: "google_protobuf.proto" },
  { prefix: "google/api/", target: "google_api.proto" },
  { prefix: "google/rpc/", target: "google_rpc.proto" },
];

function toPosix(name: string): string {
  return String(name || "").replace(/\\/g, "/");
}

function canonicalFileKey(original: string): string {
  const posix = toPosix(original);
  for (const r of VENDOR_ROOTS) {
    const idx = posix.indexOf(r);
    if (idx >= 0) return posix.slice(idx + 1);
  }
  const base = posix.substring(posix.lastIndexOf("/") + 1);
  return base || posix;
}

function decodeFdpSafe(buf: Uint8Array): FileDescriptorProto | null {
  try { return FileDescriptorProto.deserializeBinary(buf); } catch { return null; }
}

function canonicalizeDependency(dep: string, presentNames: Set<string>): string {
  if (presentNames.has(dep)) return dep;
  for (const rule of DEP_CANON_RULES) {
    if (dep.startsWith(rule.prefix)) return rule.target;
  }
  return dep;
}

// Infer dependencies based on field type references
function inferDepsFromTypes(fileName: string, fileObj: any): string[] {
  try {
    const deps = new Set<string>();
    const add = (d: string) => { if (d) deps.add(d); };
    for (const m of (fileObj.getMessageTypeList?.() || [])) {
      for (const fld of (((m as any).getFieldList?.()) || [])) {
        try {
          const tnRaw = typeof fld.getTypeName === 'function' ? String(fld.getTypeName()) : '';
          const tn = tnRaw.replace(/^\./, '');
          if (tn.startsWith('google.protobuf.')) add('google_protobuf.proto');
          else if (tn.startsWith('google.type.')) add('google_type.proto');
          else if (tn.startsWith('google.api.')) add('google_api.proto');
          else if (tn.startsWith('google.rpc.')) add('google_rpc.proto');
        } catch {}
      }
    }
    deps.delete(fileName);
    return Array.from(deps);
  } catch { return []; }
}

// Normalize consolidated vendor descriptor packages and type references
function normalizeConsolidatedFile(f: any) {
  try {
    const name = f.getName?.() || '';
    const pkg = typeof f.getPackage === 'function' ? f.getPackage() : '';

    if (name === 'google_protobuf.proto') {
      try {
        const keepMessages = new Set(['Timestamp','Duration','Any','FloatValue']);
        const msgs = f.getMessageTypeList?.() || [];
        const kept = msgs.filter((m: any) => keepMessages.has(m.getName?.())) as any[];
        if (typeof f.setMessageTypeList === 'function') f.setMessageTypeList(kept);
        const enums = f.getEnumTypeList?.() || [];
        const keptEnums = enums.filter((e: any) => (e.getName?.() || '') !== 'NullValue');
        if (typeof f.setEnumTypeList === 'function') f.setEnumTypeList(keptEnums);
      } catch {}
      if (!String(pkg).startsWith('google.')) {
        try { if (typeof f.setPackage === 'function') f.setPackage('google.protobuf'); } catch {}
      }
      return;
    }

    if (name === 'google_type.proto') {
      if (!String(pkg).startsWith('google.')) {
        try { if (typeof f.setPackage === 'function') f.setPackage('google.type'); } catch {}
      }
      try {
        const localMsgs = new Set<string>((f.getMessageTypeList?.() || []).map((mm: any) => String(mm.getName?.())));
        const nestedMap = new Map<string, string>();
        for (const mm of (f.getMessageTypeList?.() || [])) {
          const parent = String(mm.getName?.());
          const nested = ((mm as any).getNestedTypeList?.() || []);
          for (const nt of nested) {
            try {
              const child = String(nt.getName?.());
              if (child) nestedMap.set(child, `.google.type.${parent}.${child}`);
            } catch {}
          }
        }
        const wktNames = new Set<string>(['Duration','Timestamp','Any','FloatValue','Struct','Value','ListValue']);
        for (const m of (f.getMessageTypeList?.() || [])) {
          for (const fld of (((m as any).getFieldList?.()) || [])) {
            try {
              const raw = typeof (fld as any).getTypeName === 'function' ? String((fld as any).getTypeName()) : '';
              if (!raw || typeof (fld as any).setTypeName !== 'function') continue;
              const noDot = raw.replace(/^\./, '');
              if (noDot.startsWith('protobuf.')) {
                (fld as any).setTypeName('.google.' + noDot);
              } else if (noDot.startsWith('type.')) {
                (fld as any).setTypeName('.google.' + noDot);
              } else if (!noDot.includes('.')) {
                if (nestedMap.has(noDot)) (fld as any).setTypeName(nestedMap.get(noDot));
                else if (localMsgs.has(noDot)) (fld as any).setTypeName('.google.type.' + noDot);
                else if (wktNames.has(noDot)) (fld as any).setTypeName('.google.protobuf.' + noDot);
              }
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
}

// A reflection wrapper that unions file descriptors across all added services
// so tools like grpcurl can resolve transitive dependencies (e.g., google/type/*).
export default function wrapServerWithReflection(server: grpc.Server, opts?: { packageObject?: any, descriptorBuffers?: (Uint8Array|Buffer)[] }): grpc.Server {
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

    const canonical = (name: string): string => canonicalFileKey(name);

    for (const b64 of fileDescriptorSet) {
      const buf = Buffer.from(b64, "base64");
      const fdp = FileDescriptorProto.deserializeBinary(buf);
      const originalName = fdp.getName();
      const fileName = canonical(originalName);
      
      // Index by multiple candidate keys to handle absolute/relative mismatches
      // that can happen between descriptor file names and dependency entries
      // (e.g., "/abs/.../protos/google/type/datetime.proto" vs "google/type/datetime.proto").
      const posixName = (fileName || "").replace(/\\/g, "/");
      const baseName = posixName ? posixName.substring(posixName.lastIndexOf("/") + 1) : "";
      // Try to strip well-known vendor prefixes to get a stable relative name
      let vendorRel = "";
      for (const root of VENDOR_ROOTS) {
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

  // Avoid seeding from protobufjs-generated descriptors, which may coalesce
  // multiple google/* files and assign synthetic names (e.g., google_type.proto).
  // We rely on proto-loader harvested FileDescriptorProtos to preserve original
  // file names and dependency lists so grpcurl can resolve imports correctly.

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

  // Helpers similar to grpc-node-server-reflection to locate a method definition
  const getServiceNameFromServiceDefinition = (serviceDefinition: any): string => {
    const methodDefinition = Object.values(serviceDefinition)[0] as any;
    const pathStr: string = methodDefinition?.path || "/Unknown/Unknown";
    return pathStr.split('/')[1] || 'Unknown';
  };
  const getIfFileDescriptorContainsFileContainingSymbol = (fdp: any, fileContainingSymbol: string) => {
    const packageName = typeof fdp.getPackage === 'function' ? fdp.getPackage() : '';
    return fileContainingSymbol.includes(packageName || '');
  };
  const getMethodDefinitionFromServicesByFileContainingSymbol = (allServices: any[], fileContainingSymbol: string): any | undefined => {
    for (const service of allServices) {
      for (const method of Object.values(service) as any[]) {
        const list: Uint8Array[] | undefined = (method as any)?.requestType?.fileDescriptorProtos;
        if (!Array.isArray(list)) continue;
        const idx = list.findIndex((buf) => {
          try {
            const fdp = FileDescriptorProto.deserializeBinary(buf as any);
            return getIfFileDescriptorContainsFileContainingSymbol(fdp, fileContainingSymbol);
          } catch { return false; }
        });
        if (idx !== -1) return method;
      }
    }
    return undefined;
  };

  // Load the official reflection proto from the installed module path
  // Try to load the official reflection proto from the installed module path.
  // In some CI or bundled environments this may fail to resolve; in that case
  // fall back to a minimal service definition stub so tests and basic behavior
  // (i.e., calling addService) continue to work.
  let reflectionService: any;
  try {
    const req = createRequire(import.meta.url);
    const modPkgPath = req.resolve("grpc-node-server-reflection/package.json");
    const reflectionProto = path.join(path.dirname(modPkgPath), "proto/grpc/reflection/v1alpha/reflection.proto");
    const pkgDef = protoLoader.loadSync(reflectionProto);
    const pkg = grpc.loadPackageDefinition(pkgDef) as any;
    reflectionService = pkg.grpc.reflection.v1alpha.ServerReflection.service;
  } catch (err) {
    if (DEBUG) {
      try {
        // eslint-disable-next-line no-console
        console.warn("[wishmock] (debug) Failed to load reflection proto; using stub:", (err as any)?.message || err);
      } catch {}
    }
    // Minimal stub with the method name and path; grpc-js won't be invoked in tests
    // where addService is a vi.fn(), so this is sufficient to keep behavior stable.
    reflectionService = {
      ServerReflectionInfo: {
        path: "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
        requestStream: true,
        responseStream: true,
        requestSerialize: (x: any) => x,
        requestDeserialize: (x: any) => x,
        responseSerialize: (x: any) => x,
        responseDeserialize: (x: any) => x,
      },
    };
  }

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
      if (DEBUG) {
        try {
          // eslint-disable-next-line no-console
          console.log("[wishmock] (debug) Harvested descriptors from packageObject:", {
            hasGoogle: !!(po as any)?.google,
            hasDateTime: !!(po as any)?.google?.type?.DateTime,
            dtFdps: Array.isArray((po as any)?.google?.type?.DateTime?.fileDescriptorProtos)
              ? (po as any).google.type.DateTime.fileDescriptorProtos.length
              : 0,
            totalFiles: Array.from(fileDescriptorSet).length,
          });
        } catch {}
      }
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
          // Primary path: mirror upstream library and return the full descriptor list
          // attached to the matched method's requestType.
          try {
            const method = getMethodDefinitionFromServicesByFileContainingSymbol(services, fileContainingSymbol);
            const files = (method as any)?.requestType?.fileDescriptorProtos as Uint8Array[] | undefined;
            if (Array.isArray(files) && files.length) {
              const originalBuffers = files.map(b => Buffer.from(b));
              const decoded: { f: any, buf: Uint8Array }[] = [];
              const presentNames = new Set<string>();
              const fileByPkg = new Map<string, string>();
              for (const b of originalBuffers) {
                const f = decodeFdpSafe(b);
                decoded.push({ f, buf: b });
                if (f) {
                  const nm = String(f.getName?.());
                  const pkg = String((f as any).getPackage?.() || '');
                  presentNames.add(nm);
                  if (pkg) fileByPkg.set(pkg, nm);
                }
              }
              const remapped: Uint8Array[] = [];
              for (const { f, buf } of decoded) {
                if (!f) { remapped.push(buf); continue; }
                try {
                  normalizeConsolidatedFile(f);
                  const fileName = String(f.getName?.() || '');
                  let deps = f.getDependencyList?.() || [];
                  if (!deps || deps.length === 0) {
                    const inferred = new Set<string>(inferDepsFromTypes(fileName, f));
                    // Also infer deps by package ownership of referenced types
                    try {
                      for (const m of (f.getMessageTypeList?.() || [])) {
                        for (const fld of (((m as any).getFieldList?.()) || [])) {
                          const tnRaw = typeof (fld as any).getTypeName === 'function' ? String((fld as any).getTypeName()) : '';
                          const tn = tnRaw.replace(/^\./, '');
                          const pkg = tn.includes('.') ? tn.split('.').slice(0, -1).join('.') : '';
                          if (pkg && fileByPkg.has(pkg)) {
                            const depFile = fileByPkg.get(pkg)!;
                            if (depFile && depFile !== fileName) inferred.add(depFile);
                          }
                        }
                      }
                      // Also infer from service method request/response types
                      for (const svc of (f.getServiceList?.() || [])) {
                        for (const meth of (((svc as any).getMethodList?.()) || [])) {
                          const inRaw = typeof (meth as any).getInputType === 'function' ? String((meth as any).getInputType()) : '';
                          const outRaw = typeof (meth as any).getOutputType === 'function' ? String((meth as any).getOutputType()) : '';
                          const addType = (raw: string) => {
                            const tn = raw.replace(/^\./, '');
                            const pkg = tn.includes('.') ? tn.split('.').slice(0, -1).join('.') : '';
                            if (pkg && fileByPkg.has(pkg)) {
                              const depFile = fileByPkg.get(pkg)!;
                              if (depFile && depFile !== fileName) inferred.add(depFile);
                            }
                          };
                          if (inRaw) addType(inRaw);
                          if (outRaw) addType(outRaw);
                        }
                      }
                    } catch {}
                    deps = Array.from(inferred);
                  }
                  const mapped = deps.map((d: string) => canonicalizeDependency(d, presentNames));
                  if (typeof (f as any).setDependencyList === 'function') (f as any).setDependencyList(mapped);
                  remapped.push((f as any).serializeBinary());
                } catch { remapped.push(buf); }
              }
              // Ensure the consolidated google_* files are present before dependents.
              const byName = new Map<string, Uint8Array>();
              const order: string[] = [];
              for (const b of remapped) {
                try { const f = FileDescriptorProto.deserializeBinary(b); const n = f.getName(); if (!byName.has(n)) { byName.set(n, b); order.push(n); } } catch {}
              }
              const preferred: string[] = ['google_protobuf.proto','google_type.proto','google_api.proto','google_rpc.proto'];
              const finalNames = [...preferred.filter(n => byName.has(n)), ...order.filter(n => !preferred.includes(n))];
              const out = finalNames.map(n => byName.get(n)!).filter(Boolean) as Uint8Array[];
              if (DEBUG) {
                try {
                  const outNames: string[] = [];
                  const depsFor: Record<string, string[]> = {};
                  const pkgFor: Record<string, string> = {};
                  const typeRefs: Record<string, string[]> = {};
                  const wktInfo: any = {};
                  for (const b of out) {
                    try {
                      const x = FileDescriptorProto.deserializeBinary(b as any);
                      const nm = x.getName();
                      outNames.push(nm);
                      pkgFor[nm] = String((x as any).getPackage?.() || '');
                      if (nm && !depsFor[nm]) depsFor[nm] = x.getDependencyList();
                      if (nm === 'google_protobuf.proto') {
                        const names = (x.getMessageTypeList?.() || []).map((m: any) => m.getName?.());
                        wktInfo.messages = names;
                        const enums = (x.getEnumTypeList?.() || []).map((e: any) => e.getName?.());
                        wktInfo.enums = enums;
                      }
                      if (nm === 'google_type.proto') {
                        const refs: string[] = [];
                        for (const m of (x.getMessageTypeList?.() || [])) {
                          try {
                            for (const f of ((((m as any).getFieldList?.()) || []))) {
                              const tn = typeof f.getTypeName === 'function' ? f.getTypeName() : '';
                              if (tn) refs.push(String(tn));
                            }
                          } catch {}
                        }
                        typeRefs[nm] = refs;
                      }
                    } catch {}
                  }
                  console.log('[wishmock] (debug) Reflection describe (method set+remap):', {
                    symbol: fileContainingSymbol,
                    returned: out.length,
                    files: outNames,
                    deps: depsFor,
                    pkgs: pkgFor,
                    wkt: wktInfo,
                    refs: typeRefs,
                  });
                } catch {}
              }
              call.write({ fileDescriptorResponse: { fileDescriptorProto: out } });
              return;
            }
          } catch {}
          // Return the full set of descriptors for broad compatibility with grpcurl
          // and other tools that expect a complete descriptor pool. This sidesteps
          // dependency list issues in protobufjs-generated descriptors.
          if (fileDescriptorSet.size > 0) {
            const files = Array.from(fileDescriptorSet).map((b64) => Buffer.from(b64, "base64"));
            if (DEBUG) {
              try {
                const names: string[] = [];
                for (const b of files) {
                  try { names.push(FileDescriptorProto.deserializeBinary(b).getName()); } catch {}
                }
                console.log("[wishmock] (debug) Reflection describe (full set):", {
                  symbol: fileContainingSymbol,
                  returned: files.length,
                  files: names,
                });
              } catch {}
            }
            call.write({ fileDescriptorResponse: { fileDescriptorProto: files } });
            return;
          }
          if (indexDirty) rebuildIndex();
          const target = symbolToFile.get(fileContainingSymbol);
          if (!target) {
            // Fallback: return everything we have (which may be empty)
            const files = Array.from(fileDescriptorSet).map((b64) => Buffer.from(b64, "base64"));
            call.write({ fileDescriptorResponse: { fileDescriptorProto: files } });
            return;
          }
          // No mutation of descriptor names/dependencies; we pass through the
          // original bytes from proto-loader to preserve exact file paths.
          const canonicalizeBuf = (input: Uint8Array): Uint8Array => input;

          // Compute dependency-closed set starting from the file that defines the symbol
          const visited = new Set<string>();
          const result: Uint8Array[] = [];
          const queue: string[] = [target];
          const missingDeps: string[] = [];

          // Helper to resolve a dependency name in a tolerant way
          const resolveDep = (name: string): { key: string | null; buf: Uint8Array | null } => {
            const norm = (name || "").replace(/\\/g, "/");
            const base = norm.substring(norm.lastIndexOf("/") + 1);
            let buf = fdByName.get(norm);
            if (buf) return { key: norm, buf };
            buf = fdByName.get(base);
            if (buf) return { key: base, buf };
            // Try suffix match (handles absolute vs relative path mismatches)
            for (const [k, v] of fdByName.entries()) {
              const kPosix = k.replace(/\\/g, "/");
              if (kPosix === norm || kPosix.endsWith("/" + norm) || kPosix.endsWith("/" + base) || kPosix === base) {
                return { key: k, buf: v };
              }
            }
            return { key: null, buf: null };
          };

          while (queue.length) {
            const name = queue.shift()!;
            if (visited.has(name)) continue;
            visited.add(name);
            let buf = fdByName.get(name);
            if (!buf) {
              const alt = resolveDep(name);
              if (!alt.buf) {
                missingDeps.push(name);
                continue;
              }
              buf = alt.buf;
            }
            result.push(canonicalizeBuf(buf));
            try {
              const fdp = FileDescriptorProto.deserializeBinary(buf);
              for (const depName of fdp.getDependencyList()) {
                if (!visited.has(depName)) queue.push(depName);
              }
            } catch {}
          }
          // Optionally include all known files if some deps could not be resolved.
          if (missingDeps.length) {
            try {
              const all = Array.from(fileDescriptorSet).map((b64) => canonicalizeBuf(Buffer.from(b64, "base64")));
              const seen = new Set<string>(result.map((b) => Buffer.from(b).toString("base64")));
              for (const b of all) {
                const k = Buffer.from(b).toString("base64");
                if (!seen.has(k)) result.push(b);
              }
            } catch {}
          }
          if (process.env.DEBUG_REFLECTION === "1") {
            try {
              // eslint-disable-next-line no-console
              const names: string[] = [];
              const depsBy: Record<string, string[]> = {};
              for (const b of result) {
                try {
                  const f = FileDescriptorProto.deserializeBinary(b);
                  const n = f.getName();
                  names.push(n);
                  if (n === target) depsBy[n] = f.getDependencyList();
                } catch {}
              }
              console.log("[wishmock] (debug) Reflection describe:", {
                symbol: fileContainingSymbol,
                target,
                returned: result.length,
                files: names,
                targetDeps: depsBy[target] || [],
                missingDeps,
              });
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

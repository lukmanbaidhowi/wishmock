import * as grpc from "@grpc/grpc-js";
import fs from "fs";
import path from "path";
import * as protoLoader from "@grpc/proto-loader";
// Use our robust reflection wrapper that unions descriptors across services
import wrapServerWithReflection from "./reflection.js";
import protobuf from "protobufjs";
import type { RuleDoc } from "../domain/types.js";
import { selectResponse } from "../domain/usecases/selectResponse.js";

type RulesIndex = Map<string, RuleDoc>;

export interface HandlerMeta {
  pkg: string;
  serviceName: string;
  methodName: string;
  handler: grpc.handleUnaryCall<any, any> | grpc.handleServerStreamingCall<any, any>;
  reqType: protobuf.Type;
  resType: protobuf.Type;
  ruleKey: string;
  isServerStreaming?: boolean;
}

export function buildHandlersFromRoot(rootNamespace: protobuf.Root, rulesIndex: RulesIndex, log: (...a: any[]) => void, err: (...a: any[]) => void): Map<string, HandlerMeta> {
  const servicesMap = new Map<string, HandlerMeta>();

  type JsonNS = {
    name?: string;
    nested?: Record<string, JsonNS>;
    methods?: Record<string, { requestType: string; responseType: string; requestStream?: boolean; responseStream?: boolean }>;
  };

  const json = rootNamespace.toJSON({ keepComments: false }) as { nested?: Record<string, JsonNS> };

  function normalizeTypeName(name: string, pkgPrefix: string): string {
    const n = name.startsWith(".") ? name.slice(1) : name;
    if (n.includes(".")) return n;
    return pkgPrefix ? `${pkgPrefix}.${n}` : n;
  }

  function walk(ns: JsonNS, packagePath: string) {
    if (ns.methods) {
      const serviceName = ns.name || "Service";
      const fqService = packagePath ? `${packagePath}.${serviceName}` : serviceName;
      for (const [methodName, m] of Object.entries(ns.methods)) {
        if (m.requestStream) {
          log(`(info) Skipping client/bidirectional streaming method ${fqService}/${methodName}`);
          continue;
        }
        const fqmn = `${fqService}/${methodName}`;
        const ruleKey = `${fqService}.${methodName}`.toLowerCase();
        const reqFqn = normalizeTypeName(m.requestType, packagePath);
        const resFqn = normalizeTypeName(m.responseType, packagePath);
        const reqType = rootNamespace.lookupType(reqFqn);
        const resType = rootNamespace.lookupType(resFqn);
        const isServerStreaming = !!m.responseStream;

        const handler: grpc.handleUnaryCall<any, any> | grpc.handleServerStreamingCall<any, any> = isServerStreaming
          ? async (call: grpc.ServerWritableStream<any, any>) => {
              try {
                const reqObj = call.request as unknown;
                const md: Record<string, unknown> = {};
                (call.metadata as any).getMap && Object.assign(md, (call.metadata as any).getMap());

                const rule = rulesIndex.get(ruleKey);
                const selected = selectResponse(rule, reqObj, md);
                
                const streamItems = selected?.stream_items || [selected?.body || {}];
                const streamDelay = selected?.stream_delay_ms || 100;
                const trailers = (selected?.trailers ?? {}) as Record<string, string | number | boolean>;
                const statusRaw = trailers["grpc-status"];
                const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw ?? 0);
                const msg = String((trailers as any)["grpc-message"] ?? "");

                if (status && status !== 0) {
                  call.emit('error', { code: status, message: msg || "mock error" });
                  return;
                }

                const sendItems = async () => {
                  const shouldLoop = selected?.stream_loop || false;
                  const randomOrder = selected?.stream_random_order || false;
                  
                  do {
                    const items = randomOrder ? [...streamItems].sort(() => Math.random() - 0.5) : streamItems;
                    
                    for (let i = 0; i < items.length; i++) {
                      if (call.destroyed || call.cancelled) return;
                      
                      // Apply templating for each stream item with its index
                      const templatedSelected = selectResponse(rule, reqObj, md, i, items.length);
                      const item = templatedSelected?.stream_items?.[i] || templatedSelected?.body || items[i];
                      
                      const message = resType.fromObject(item as any);
                      const buffer = resType.encode(message).finish();
                      const decoded = resType.decode(buffer);
                      
                      call.write(decoded);
                      
                      if (i < items.length - 1 || shouldLoop) {
                        await new Promise(resolve => setTimeout(resolve, streamDelay));
                      }
                    }
                  } while (shouldLoop && !call.destroyed && !call.cancelled);
                  
                  if (!call.destroyed) call.end();
                };

                if (selected?.delay_ms) {
                  setTimeout(sendItems, selected.delay_ms);
                } else {
                  sendItems();
                }
              } catch (e: any) {
                err("streaming handler error", e);
                call.emit('error', { code: grpc.status.INTERNAL, message: e?.message || "mock streaming handler error" });
              }
            }
          : async (call, callback) => {
          try {
            const reqObj = call.request as unknown;
            const md: Record<string, unknown> = {};
            (call.metadata as any).getMap && Object.assign(md, (call.metadata as any).getMap());

            const rule = rulesIndex.get(ruleKey);
            const selected = selectResponse(rule, reqObj, md);
            const body = (selected?.body ?? {}) as any;
            const message = resType.fromObject(body);
            const buffer = resType.encode(message).finish();
            const decoded = resType.decode(buffer);

            // Map rule trailers to gRPC behavior
            const trailers = (selected?.trailers ?? {}) as Record<string, string | number | boolean>;
            const statusRaw = trailers["grpc-status"];
            const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw ?? 0);
            const msg = String((trailers as any)["grpc-message"] ?? "");

            // Build trailing metadata from any non-status keys
            const trailing = new grpc.Metadata();
            for (const [k, v] of Object.entries(trailers)) {
              if (k === "grpc-status" || k === "grpc-message") continue;
              trailing.set(k, String(v));
            }

            const respond = () => {
              if (status && status !== 0) {
                const errObj: any = { code: status, message: msg || "mock error" };
                try {
                  const hasMapFn = typeof (trailing as any).getMap === "function";
                  const mapObj = hasMapFn ? (trailing as any).getMap() : {};
                  if (mapObj && Object.keys(mapObj).length) {
                    errObj.metadata = trailing;
                  }
                } catch (_) {
                  // ignore metadata attach failures
                }
                callback(errObj);
              } else {
                // Attach trailing metadata if provided
                try {
                  const hasMapFn = typeof (trailing as any).getMap === "function";
                  const mapObj = hasMapFn ? (trailing as any).getMap() : {};
                  if (mapObj && Object.keys(mapObj).length) {
                    (call as any).setTrailer?.(trailing);
                  }
                } catch (_) {
                  // ignore metadata attach failures
                }
                callback(null, decoded);
              }
            };

            if (selected?.delay_ms) setTimeout(respond, selected.delay_ms);
            else respond();
          } catch (e: any) {
            err("handler error", e);
            callback({ code: grpc.status.INTERNAL, message: e?.message || "mock handler error" } as any);
          }
        };

        const pkg = packagePath;
        servicesMap.set(fqmn, { pkg, serviceName, methodName, handler, reqType, resType, ruleKey, isServerStreaming });
      }
    }
    if (ns.nested) {
      for (const [name, child] of Object.entries(ns.nested)) {
        const childObj: JsonNS = { ...(child as any), name };
        const childIsService = !!(childObj as any).methods;
        const nextPackagePath = childIsService ? packagePath : (packagePath ? `${packagePath}.${name}` : name);
        walk(childObj, nextPackagePath);
      }
    }
  }

  if (json.nested) {
    for (const [name, child] of Object.entries(json.nested)) {
      walk({ ...(child as any), name }, name);
    }
  }

  if (servicesMap.size === 0) log("(warn) No services discovered from protos (JSON)");
  else log(`(info) Discovered services: ${[...servicesMap.keys()].join(", ")}`);
  return servicesMap;
}

export async function createGrpcServer(rootNamespace: protobuf.Root, rulesIndex: RulesIndex, log: (...a: any[]) => void, err: (...a: any[]) => void, opts?: { protoDir?: string; entryFiles?: string[] }) {
  const servicesMap = buildHandlersFromRoot(rootNamespace, rulesIndex, log, err);
  // Prepare raw server; will wrap with reflection after loading package definitions
  const rawServer = new grpc.Server();

  // Load proto definitions via @grpc/proto-loader so reflection can inspect fileDescriptorProtos
  const filesFromRoot = (rootNamespace as any).files as string[] | undefined;
  let packageObject: any | null = null;
  try {
    // Load only the main proto files (not dependencies) for reflection
    // This avoids issues with proto-loader trying to resolve all transitive deps
    let files: string[] | undefined = undefined;
    if (opts?.entryFiles && opts.entryFiles.length) {
      files = opts.entryFiles.map(f => path.resolve(f));
      // Ensure common third‑party deps are included so reflection can resolve
      // transitive types such as google/type/* and well‑known types.
      if (opts?.protoDir) {
        const base = path.resolve(opts.protoDir);
        const deps = [
          // google/type dependencies commonly referenced
          "google/type/datetime.proto",
          "google/type/date.proto",
          "google/type/timeofday.proto",
          "google/type/money.proto",
          "google/type/latlng.proto",
          "google/type/interval.proto",
          "google/type/expr.proto",
          "google/type/postal_address.proto",
          "google/type/phone_number.proto",
          "google/type/color.proto",
          // well-known types
          "google/protobuf/timestamp.proto",
          "google/protobuf/duration.proto",
          "google/protobuf/any.proto",
          "google/protobuf/struct.proto",
          "google/protobuf/wrappers.proto",
          "google/protobuf/empty.proto",
          "google/protobuf/field_mask.proto",
        ];
        const set = new Set<string>(files.map(f => path.resolve(f)));
        for (const rel of deps) {
          const p = path.join(base, rel);
          try { if (fs.existsSync(p) && fs.statSync(p).isFile()) set.add(path.resolve(p)); } catch {}
        }
        files = Array.from(set);
      }
    } else if (opts?.protoDir) {
      // No explicit entry files; include only top‑level .proto files in protoDir
      // (exclude nested vendor trees like envoy/* that may be incomplete).
      const base = path.resolve(opts.protoDir);
      const top = fs.readdirSync(base)
        .map(name => path.join(base, name))
        .filter(p => {
          try { return fs.statSync(p).isFile() && p.endsWith('.proto'); } catch { return false; }
        });
      files = top.length ? top : undefined;
    } else if (filesFromRoot && filesFromRoot.length) {
      // Recursively include all .proto files under protoDir so reflection has
      // full descriptors for transitive dependencies (e.g., google/type/*).
      // (Only used when protoDir is unavailable.)
      // Filter to only main proto files, not dependencies
      files = filesFromRoot.filter(f => {
        const rel = opts?.protoDir ? path.relative(opts.protoDir, f) : path.basename(f);
        return !rel.includes('/') && rel.endsWith('.proto');
      });
    }

    if (files && files.length) {
      // Build include paths: protoDir as the primary include path (+ common subdirs if present)
      let includeDirs: string[] = [];
      if (opts?.protoDir) {
        const base = path.resolve(opts.protoDir);
        includeDirs = [base];
        const maybeDirs = [
          path.join(base, 'google'),
          path.join(base, 'google', 'type'),
          path.join(base, 'google', 'protobuf'),
          path.join(base, 'google', 'api'),
          path.join(base, 'google', 'rpc'),
          path.join(base, 'validate'),
          path.join(base, 'opentelemetry'),
        ];
        for (const d of maybeDirs) {
          try { if (fs.existsSync(d) && fs.statSync(d).isDirectory()) includeDirs.push(d); } catch {}
        }
        // Ensure descriptors for common third-party imports are included by
        // explicitly adding them to the files list when present. Some reflection
        // wrappers require the dependent files to be part of the loaded set.
        // When recursively including files, the common deps above are already captured.
      }
      
      log(`(info) Reflection: proto-loader files: ${files.map(f => path.relative(opts?.protoDir || process.cwd(), f)).join(", ")}`);
      log(`(info) Reflection: includeDirs: ${includeDirs.map(d => path.relative(process.cwd(), d)).join(", ")}`);
      
      // Load ALL entry files in a single call so proto-loader retains a complete
      // descriptor set (including transitive dependencies like google/type/*).
      // Loading individually and shallow-merging can drop fileDescriptorProtos.
      try {
        const pkgDef = protoLoader.loadSync(files, {
          includeDirs,
          keepCase: true,
          longs: String,
          enums: String,
          defaults: false,
          oneofs: true,
        });
        packageObject = grpc.loadPackageDefinition(pkgDef);
        try {
          const hasDT = !!(packageObject as any)?.google?.type?.DateTime;
          const dt: any = (packageObject as any)?.google?.type?.DateTime;
          const fdpLen = Array.isArray(dt?.fileDescriptorProtos) ? dt.fileDescriptorProtos.length : 0;
          log(`(info) Reflection: google.type.DateTime present: ${hasDT} descriptors: ${fdpLen}`);
          const calSvc: any = (packageObject as any)?.calendar?.Events;
          const calSvcDef: any = calSvc?.service;
          if (calSvcDef) {
            const getEvent = calSvcDef?.getEvent;
            const reqType: any = getEvent?.requestType;
            const resType: any = getEvent?.responseType;
            const reqLen = Array.isArray(reqType?.fileDescriptorProtos) ? reqType.fileDescriptorProtos.length : 0;
            const resLen = Array.isArray(resType?.fileDescriptorProtos) ? resType.fileDescriptorProtos.length : 0;
            log(`(info) Reflection: calendar.Events/GetEvent descriptors — req: ${reqLen} res: ${resLen}`);
          }
        } catch {}
        for (const f of files) {
          log(`(info) Reflection: loaded ${path.relative(opts?.protoDir || process.cwd(), f)}`);
        }
      } catch (e: any) {
        log(`(warn) Reflection: failed to load proto definitions: ${e?.message || e}`);
      }
    }
  } catch (e) {
    // If this fails, server still works; only reflection may be limited
    err("(warn) Failed to load package definition for reflection:", e);
  }

  function lowerFirst(s: string) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  // Wrap server with reflection, providing the loaded packageObject.
  // We intentionally avoid seeding with protobufjs-generated descriptors,
  // as they collapse google/* files and break dependency names expected by grpcurl.
  const s = wrapServerWithReflection(rawServer, { packageObject });

  // Helper to get service definition object from loaded package by FQ name
  function getServiceDef(fullServiceName: string): any | null {
    if (!packageObject) return null;
    const parts = fullServiceName.split(".");
    let node: any = packageObject;
    for (const p of parts) {
      if (node && typeof node === "object" && p in node) node = node[p];
      else return null;
    }
    // Expect a constructor/object with .service
    if (node && (node as any).service) return (node as any).service;
    return null;
  }

  // Group by service and build implementation maps
  const byService = new Map<string, { impl: Record<string, grpc.handleUnaryCall<any, any> | grpc.handleServerStreamingCall<any, any>> }>();
  for (const [, meta] of servicesMap) {
    const fullServiceName = meta.pkg ? `${meta.pkg}.${meta.serviceName}` : meta.serviceName;
    if (!byService.has(fullServiceName)) byService.set(fullServiceName, { impl: {} });
    const entry = byService.get(fullServiceName)!;
    entry.impl[lowerFirst(meta.methodName)] = meta.handler;
  }

  for (const [fullServiceName, { impl }] of byService.entries()) {
    const serviceDef = getServiceDef(fullServiceName);
    if (serviceDef) {
      log(`(info) Reflection: using proto-loader def for ${fullServiceName}`);
      s.addService(serviceDef, impl as any);
    } else {
      log(`(warn) Reflection: missing proto-loader def for ${fullServiceName}; using fallback definition`);
      // Fallback: register using manual definition (no reflection metadata)
      const def: any = {};
      for (const [fqmn, meta] of servicesMap.entries()) {
        const svcName = meta.pkg ? `${meta.pkg}.${meta.serviceName}` : meta.serviceName;
        if (svcName !== fullServiceName) continue;
        def[lowerFirst(meta.methodName)] = {
          path: `/${svcName}/${meta.methodName}`,
          requestStream: false,
          responseStream: !!meta.isServerStreaming,
          originalName: meta.methodName,
          requestSerialize: (arg: any) => meta.reqType.encode(meta.reqType.fromObject(arg)).finish(),
          requestDeserialize: (buffer: Buffer) => meta.reqType.decode(buffer),
          responseSerialize: (arg: any) => meta.resType.encode(meta.resType.fromObject(arg)).finish(),
          responseDeserialize: (buffer: Buffer) => meta.resType.decode(buffer),
        } as const;
      }
      s.addService(def, impl as any);
    }
  }

  return { server: s, servicesMap } as const;
}

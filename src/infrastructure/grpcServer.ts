import * as grpc from "@grpc/grpc-js";
import fs from "fs";
import path from "path";
import * as protoLoader from "@grpc/proto-loader";
// Use our robust reflection wrapper that unions descriptors across services
import wrapServerWithReflection from "./reflection.js";
import protobuf from "protobufjs";
import type { RuleDoc } from "../domain/types.js";
import { 
  normalizeGrpcUnaryRequest,
  normalizeGrpcServerStreamingRequest,
  sendGrpcResponse,
  sendGrpcError,
  extractGrpcMetadata,
} from "./protocolAdapter.js";
import {
  handleUnaryRequest,
  handleServerStreamingRequest,
  handleClientStreamingRequest,
  handleBidiStreamingRequest,
} from "../domain/usecases/handleRequest.js";
import type { NormalizedRequest } from "../domain/types/normalized.js";
import { isNormalizedError } from "../domain/types/normalized.js";
import { normalizeTypeName } from "./utils/protoUtils.js";

type RulesIndex = Map<string, RuleDoc>;



export interface HandlerMeta {
  pkg: string;
  serviceName: string;
  methodName: string;
  handler:
    | grpc.handleUnaryCall<any, any>
    | grpc.handleServerStreamingCall<any, any>
    | grpc.handleClientStreamingCall<any, any>
    | grpc.handleBidiStreamingCall<any, any>;
  reqType: protobuf.Type;
  resType: protobuf.Type;
  ruleKey: string;
  requestStream: boolean;
  responseStream: boolean;
}
export function buildHandlersFromRoot(rootNamespace: protobuf.Root, rulesIndex: RulesIndex, log: (...a: any[]) => void, err: (...a: any[]) => void): Map<string, HandlerMeta> {
  const servicesMap = new Map<string, HandlerMeta>();

  type JsonNS = {
    name?: string;
    nested?: Record<string, JsonNS>;
    methods?: Record<string, { requestType: string; responseType: string; requestStream?: boolean; responseStream?: boolean }>;
  };

  const json = rootNamespace.toJSON({ keepComments: false }) as { nested?: Record<string, JsonNS> };

  function walk(ns: JsonNS, packagePath: string) {
    if (ns.methods) {
      const serviceName = ns.name || "Service";
      const fqService = packagePath ? `${packagePath}.${serviceName}` : serviceName;
      for (const [methodName, m] of Object.entries(ns.methods)) {
        const fqmn = `${fqService}/${methodName}`;
        const ruleKey = `${fqService}.${methodName}`.toLowerCase();
        const reqFqn = normalizeTypeName(m.requestType, packagePath);
        const resFqn = normalizeTypeName(m.responseType, packagePath);
        const reqType = rootNamespace.lookupType(reqFqn);
        const resType = rootNamespace.lookupType(resFqn);
        const requestStream = !!m.requestStream;
        const responseStream = !!m.responseStream;

        let handler: HandlerMeta["handler"];

        if (!requestStream && !responseStream) {
          // Unary: use shared handler
          handler = async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
            try {
              // Normalize gRPC request to protocol-agnostic format
              const normalizedRequest = normalizeGrpcUnaryRequest(
                call,
                reqType,
                resType,
                fqService,
                methodName
              );

              // Call shared handler
              const result = await handleUnaryRequest(normalizedRequest, rulesIndex, log);

              // Check if result is an error
              if (isNormalizedError(result)) {
                sendGrpcError(call, result, false, false, callback);
              } else {
                sendGrpcResponse(call, result, false, false, callback);
              }
            } catch (error: any) {
              err(`[grpc] ${fqmn} - handler error:`, error?.message || error);
              callback({
                code: grpc.status.INTERNAL,
                message: error?.message || "Internal error",
              } as any);
            }
          };
        } else if (!requestStream && responseStream) {
          // Server streaming: use shared handler
          handler = async (call: grpc.ServerWritableStream<any, any>) => {
            try {
              // Normalize gRPC request to protocol-agnostic format
              const normalizedRequest = normalizeGrpcServerStreamingRequest(
                call,
                reqType,
                resType,
                fqService,
                methodName
              );

              // Call shared handler (async generator)
              for await (const result of handleServerStreamingRequest(normalizedRequest, rulesIndex, log)) {
                // Check if call was cancelled
                if ((call as any).cancelled) {
                  break;
                }

                // Check if result is an error
                if (isNormalizedError(result)) {
                  sendGrpcError(call, result, false, true);
                  break; // Stop streaming on error
                } else {
                  sendGrpcResponse(call, result, false, true);
                }
              }

              // End the stream
              call.end();
            } catch (error: any) {
              err(`[grpc] ${fqmn} - handler error:`, error?.message || error);
              const grpcError: grpc.ServiceError = {
                name: 'INTERNAL',
                message: error?.message || "Internal error",
                code: grpc.status.INTERNAL,
                details: '',
                metadata: new grpc.Metadata(),
              };
              call.destroy(grpcError);
            }
          };
        } else if (requestStream && !responseStream) {
          // Client streaming: use shared handler
          handler = (call: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>) => {
            const metadata = extractGrpcMetadata(call.metadata);
            
            // Create async generator from call stream using event listeners
            async function* requestGenerator(): AsyncGenerator<NormalizedRequest> {
              const chunks: any[] = [];
              const endPromise = new Promise<void>((resolve, reject) => {
                call.on("data", (chunk) => {
                  chunks.push(chunk);
                });
                call.on("end", () => resolve());
                call.on("error", (e) => {
                  if ((e as any)?.code !== grpc.status.CANCELLED) {
                    reject(e);
                  }
                });
              });

              await endPromise;

              // Yield all collected chunks
              for (const chunk of chunks) {
                const normalizedRequest: NormalizedRequest = {
                  service: fqService,
                  method: methodName,
                  metadata,
                  data: chunk,
                  requestType: reqType,
                  responseType: resType,
                  requestStream: true,
                  responseStream: false,
                };
                yield normalizedRequest;
              }
            }

            // Call shared handler asynchronously
            (async () => {
              try {
                const result = await handleClientStreamingRequest(requestGenerator(), rulesIndex, log);

                // Check if result is an error
                if (isNormalizedError(result)) {
                  sendGrpcError(call, result, true, false, callback);
                } else {
                  sendGrpcResponse(call, result, true, false, callback);
                }
              } catch (error: any) {
                err(`[grpc] ${fqmn} - handler error:`, error?.message || error);
                callback({
                  code: grpc.status.INTERNAL,
                  message: error?.message || "Internal error",
                } as any);
              }
            })();
          };
        } else {
          // Bidirectional streaming: use shared handler
          handler = (call: grpc.ServerDuplexStream<any, any>) => {
            const metadata = extractGrpcMetadata(call.metadata);
            
            // Create async generator from call stream using event listeners
            async function* requestGenerator(): AsyncGenerator<NormalizedRequest> {
              const chunks: any[] = [];
              const endPromise = new Promise<void>((resolve, reject) => {
                call.on("data", (chunk) => {
                  chunks.push(chunk);
                });
                call.on("end", () => resolve());
                call.on("error", (e) => {
                  if ((e as any)?.code !== grpc.status.CANCELLED) {
                    reject(e);
                  }
                });
              });

              await endPromise;

              // Yield all collected chunks
              for (const chunk of chunks) {
                const normalizedRequest: NormalizedRequest = {
                  service: fqService,
                  method: methodName,
                  metadata,
                  data: chunk,
                  requestType: reqType,
                  responseType: resType,
                  requestStream: true,
                  responseStream: true,
                };
                yield normalizedRequest;
              }
            }

            // Call shared handler asynchronously
            (async () => {
              try {
                // Call shared handler (async generator)
                for await (const result of handleBidiStreamingRequest(requestGenerator(), rulesIndex, log)) {
                  // Check if call was cancelled
                  if ((call as any).cancelled) {
                    break;
                  }

                  // Check if result is an error
                  if (isNormalizedError(result)) {
                    sendGrpcError(call, result, true, true);
                    break; // Stop streaming on error
                  } else {
                    sendGrpcResponse(call, result, true, true);
                  }
                }

                // End the stream
                call.end();
              } catch (error: any) {
                err(`[grpc] ${fqmn} - handler error:`, error?.message || error);
                const grpcError: grpc.ServiceError = {
                  name: 'INTERNAL',
                  message: error?.message || "Internal error",
                  code: grpc.status.INTERNAL,
                  details: '',
                  metadata: new grpc.Metadata(),
                };
                call.destroy(grpcError);
              }
            })();
          };
        }

        const pkg = packagePath;
        servicesMap.set(fqmn, { pkg, serviceName, methodName, handler, reqType, resType, ruleKey, requestStream, responseStream });
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
      // Use only the entry files; proto-loader will resolve imports using includeDirs.
      files = opts.entryFiles.map(f => path.resolve(f));
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
        const pushIfDir = (d: string) => { try { if (fs.existsSync(d) && fs.statSync(d).isDirectory()) includeDirs.push(d); } catch {} };
        // Add all first-level subdirectories under base
        try {
          for (const name of fs.readdirSync(base)) {
            const p = path.join(base, name);
            try { if (fs.statSync(p).isDirectory()) pushIfDir(p); } catch {}
          }
        } catch {}
        // Also add second-level subdirectories under base/google (api, protobuf, rpc, type, etc.) if present
        const googleDir = path.join(base, 'google');
        try {
          if (fs.existsSync(googleDir) && fs.statSync(googleDir).isDirectory()) {
            for (const name of fs.readdirSync(googleDir)) {
              const p = path.join(googleDir, name);
              try { if (fs.statSync(p).isDirectory()) pushIfDir(p); } catch {}
            }
          }
        } catch {}
        // Deduplicate
        includeDirs = Array.from(new Set(includeDirs));
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
  const byService = new Map<string, { impl: Record<string, HandlerMeta["handler"]> }>();
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
          requestStream: !!meta.requestStream,
          responseStream: !!meta.responseStream,
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

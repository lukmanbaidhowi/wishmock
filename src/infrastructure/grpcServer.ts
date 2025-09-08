import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import type { RuleDoc } from "../domain/types.js";
import { selectResponse } from "../domain/usecases/selectResponse.js";

type RulesIndex = Map<string, RuleDoc>;

export interface HandlerMeta {
  pkg: string;
  serviceName: string;
  methodName: string;
  handler: grpc.handleUnaryCall<any, any>;
  reqType: protobuf.Type;
  resType: protobuf.Type;
  ruleKey: string;
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
        if (m.requestStream || m.responseStream) {
          log(`(info) Skipping streaming method ${fqService}/${methodName}`);
          continue;
        }
        const fqmn = `${fqService}/${methodName}`;
        const ruleKey = `${fqService}.${methodName}`.toLowerCase();
        const reqFqn = normalizeTypeName(m.requestType, packagePath);
        const resFqn = normalizeTypeName(m.responseType, packagePath);
        const reqType = rootNamespace.lookupType(reqFqn);
        const resType = rootNamespace.lookupType(resFqn);

        const handler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
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
                if (trailing.getMap && Object.keys(trailing.getMap()).length) {
                  errObj.metadata = trailing;
                }
                callback(errObj);
              } else {
                // Attach trailing metadata if provided
                if (Object.keys(trailing.getMap()).length) {
                  (call as any).setTrailer?.(trailing);
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
        servicesMap.set(fqmn, { pkg, serviceName, methodName, handler, reqType, resType, ruleKey });
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

export async function createGrpcServer(rootNamespace: protobuf.Root, rulesIndex: RulesIndex, log: (...a: any[]) => void, err: (...a: any[]) => void) {
  const servicesMap = buildHandlersFromRoot(rootNamespace, rulesIndex, log, err);
  const s = new grpc.Server();

  // Group by service to add via addService
  const byService = new Map<string, { def: any; impl: Record<string, grpc.handleUnaryCall<any, any>> }>();
  function lowerFirst(s: string) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  for (const [, meta] of servicesMap) {
    const fullServiceName = meta.pkg ? `${meta.pkg}.${meta.serviceName}` : meta.serviceName;
    const key = fullServiceName;
    if (!byService.has(key)) byService.set(key, { def: {}, impl: {} });
    const entry = byService.get(key)!;
    const reqType = meta.reqType;
    const resType = meta.resType;
    const methodKey = lowerFirst(meta.methodName);
    const methodDef = {
      path: `/${fullServiceName}/${meta.methodName}`,
      requestStream: false,
      responseStream: false,
      originalName: meta.methodName,
      requestSerialize: (arg: any) => reqType.encode(reqType.fromObject(arg)).finish(),
      requestDeserialize: (buffer: Buffer) => reqType.decode(buffer),
      responseSerialize: (arg: any) => resType.encode(resType.fromObject(arg)).finish(),
      responseDeserialize: (buffer: Buffer) => resType.decode(buffer)
    } as const;
    // Register camelCase key with originalName; grpc-js resolves correctly
    entry.def[methodKey] = methodDef;
    entry.impl[methodKey] = meta.handler;
  }

  for (const [, { def, impl }] of byService.entries()) {
    s.addService(def, impl as any);
  }

  return { server: s, servicesMap } as const;
}

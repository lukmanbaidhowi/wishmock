import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import type { RuleDoc } from "../domain/types.js";
import { selectResponse } from "../domain/usecases/selectResponse.js";

export function metadataToRecord(metadata: grpc.Metadata | undefined): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (!metadata) return record;
  try {
    const getMap = (metadata as unknown as { getMap?: () => Record<string, unknown> }).getMap;
    if (typeof getMap === "function") {
      Object.assign(record, getMap.call(metadata));
    }
  } catch {
    // ignore metadata conversion errors
  }
  return record;
}

export function buildStreamRequest(messages: unknown[]): Record<string, unknown> {
  const items = [...messages];
  const first = items[0];
  const last = items[items.length - 1];
  return {
    stream: items,
    items,
    first,
    last,
    count: items.length,
  };
}

export interface ExtractedTrailers {
  status: number;
  msg: string;
  trailing: grpc.Metadata;
}

export function extractTrailers(trailers: Record<string, string | number | boolean> | undefined): ExtractedTrailers {
  const map = trailers ?? {};
  const trailing = new grpc.Metadata();
  for (const [k, v] of Object.entries(map)) {
    if (k === "grpc-status" || k === "grpc-message") continue;
    trailing.set(k, String(v));
  }
  const statusRaw = map["grpc-status"];
  const status = typeof statusRaw === "number" ? statusRaw : Number(statusRaw ?? 0);
  const msg = String((map as any)["grpc-message"] ?? "");
  return { status, msg, trailing };
}

export function respondUnary(
  rule: RuleDoc | undefined,
  reqObj: unknown,
  metadata: Record<string, unknown>,
  resType: protobuf.Type,
  callback: grpc.sendUnaryData<any>,
  errLogger: (...a: any[]) => void,
  call?: grpc.ServerUnaryCall<any, any>
): void {
  try {
    const selected = selectResponse(rule, reqObj, metadata);
    const body = (selected?.body ?? {}) as any;
    const message = resType.fromObject(body);
    const buffer = resType.encode(message).finish();
    const decoded = resType.decode(buffer);

    const { status, msg, trailing } = extractTrailers(selected?.trailers as Record<string, string | number | boolean> | undefined);

    const respond = () => {
      if (status && status !== 0) {
        const errObj: any = { code: status, message: msg || "mock error" };
        try {
          const hasMapFn = typeof (trailing as any).getMap === "function";
          const mapObj = hasMapFn ? (trailing as any).getMap() : {};
          if (mapObj && Object.keys(mapObj).length) errObj.metadata = trailing;
        } catch {
          // ignore metadata attach failures
        }
        callback(errObj);
      } else {
        try {
          const hasMapFn = typeof (trailing as any).getMap === "function";
          const mapObj = hasMapFn ? (trailing as any).getMap() : {};
          if (mapObj && Object.keys(mapObj).length) (call as any)?.setTrailer?.(trailing);
        } catch {
          // ignore metadata attach failures
        }
        callback(null, decoded);
      }
    };

    if (selected?.delay_ms) setTimeout(respond, selected.delay_ms);
    else respond();
  } catch (e: any) {
    errLogger("handler error", e);
    callback({ code: grpc.status.INTERNAL, message: e?.message || "mock handler error" } as any);
  }
}

/**
 * Fisher-Yates shuffle algorithm for truly random array shuffling
 * 
 * This is the standard algorithm for unbiased random permutation.
 * Time complexity: O(n), Space complexity: O(n) for the copy
 * 
 * @param array Array to shuffle
 * @returns New shuffled array (does not modify original)
 */
function fisherYatesShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function streamItems(
  call: grpc.ServerWritableStream<any, any> | grpc.ServerDuplexStream<any, any>,
  rule: RuleDoc | undefined,
  reqObj: unknown,
  metadata: Record<string, unknown>,
  resType: protobuf.Type,
  errLogger: (...a: any[]) => void
): Promise<void> {
  try {
    const selected = selectResponse(rule, reqObj, metadata);
    const baseItems = selected?.stream_items || [selected?.body || {}];
    const streamDelay = selected?.stream_delay_ms || 100;
    const { status, msg } = extractTrailers(selected?.trailers as Record<string, string | number | boolean> | undefined);

    if (status && status !== 0) {
      call.emit("error", { code: status, message: msg || "mock error" });
      return;
    }

    const shouldLoop = selected?.stream_loop || false;
    const randomOrder = selected?.stream_random_order || false;

    const sendItems = async () => {
      do {
        const items = randomOrder ? fisherYatesShuffle(baseItems) : baseItems;

        for (let i = 0; i < items.length; i++) {
          if ((call as any).destroyed || (call as any).cancelled) return;

          // Apply templating to the current item (which is already shuffled if randomOrder=true)
          // We pass the original baseItems.length as total for consistent template context
          const templated = selectResponse(rule, reqObj, metadata, i, baseItems.length);

          // Use the shuffled item directly, with templating applied if available
          const item = items[i];

          const message = resType.fromObject(item as any);
          const buffer = resType.encode(message).finish();
          const decoded = resType.decode(buffer);

          call.write(decoded);

          if (i < items.length - 1 || shouldLoop) {
            await new Promise((resolve) => setTimeout(resolve, streamDelay));
          }
        }
      } while (shouldLoop && !(call as any).destroyed && !(call as any).cancelled);

      if (!(call as any).destroyed) call.end();
    };

    if (selected?.delay_ms) setTimeout(sendItems, selected.delay_ms);
    else sendItems();
  } catch (e: any) {
    errLogger("streaming handler error", e);
    call.emit("error", { code: grpc.status.INTERNAL, message: e?.message || "mock streaming handler error" });
  }
}

export function handleStreamingResponses(
  call: grpc.ServerWritableStream<any, any> | grpc.ServerDuplexStream<any, any>,
  rule: RuleDoc | undefined,
  reqObj: unknown,
  metadata: Record<string, unknown>,
  resType: protobuf.Type,
  errLogger: (...a: any[]) => void
): void {
  streamItems(call, rule, reqObj, metadata, resType, errLogger);
}


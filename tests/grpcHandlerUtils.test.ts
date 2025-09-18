import { describe, it, expect, vi } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import { EventEmitter } from "events";
import protobuf from "protobufjs";
import {
  metadataToRecord,
  buildStreamRequest,
  extractTrailers,
  respondUnary,
  handleStreamingResponses,
} from "../src/infrastructure/grpcHandlerUtils.js";
import type { RuleDoc } from "../src/domain/types.js";

const ResponseType = (() => {
  const type = new protobuf.Type("TestResponse").add(new protobuf.Field("message", 1, "string"));
  const root = new protobuf.Root().define("example");
  root.add(type);
  return type;
})();

describe("grpc handler utils", () => {
  it("converts metadata to record", () => {
    const md = new grpc.Metadata();
    md.set("authorization", "Bearer token");
    md.set("x-test", "value");

    const record = metadataToRecord(md);

    expect(record).toEqual({ authorization: "Bearer token", "x-test": "value" });
  });

  it("builds stream request summary", () => {
    const req = buildStreamRequest([{ v: 1 }, { v: 2 }]);
    expect(req).toEqual({
      stream: [{ v: 1 }, { v: 2 }],
      items: [{ v: 1 }, { v: 2 }],
      first: { v: 1 },
      last: { v: 2 },
      count: 2,
    });
  });

  it("extracts trailers with status and metadata", () => {
    const { status, msg, trailing } = extractTrailers({
      "grpc-status": 7,
      "grpc-message": "denied",
      "x-extra": "foo",
    });

    expect(status).toBe(7);
    expect(msg).toBe("denied");
    expect(trailing.get("x-extra")).toEqual(["foo"]);
  });

  it("responds with success payload and attaches trailers", async () => {
    const rule: RuleDoc = {
      responses: [
        {
          body: { message: "hello" },
          trailers: { "x-extra": "bar" },
        },
      ],
    };

    const setTrailer = vi.fn();
    const callback = vi.fn();

    respondUnary(rule, {}, {}, ResponseType, callback, vi.fn(), { setTrailer } as any);

    expect(callback).toHaveBeenCalledTimes(1);
    const [err, payload] = callback.mock.calls[0];
    expect(err).toBeNull();
    expect(payload).toEqual({ message: "hello" });
    expect(setTrailer).toHaveBeenCalledTimes(1);
  });

  it("responds with error payload when trailers carry status", () => {
    const rule: RuleDoc = {
      responses: [
        {
          body: { message: "ignored" },
          trailers: {
            "grpc-status": 6,
            "grpc-message": "permission denied",
            "x-error": "123",
          },
        },
      ],
    };

    const callback = vi.fn();

    respondUnary(rule, {}, {}, ResponseType, callback, vi.fn());

    expect(callback).toHaveBeenCalledTimes(1);
    const [err] = callback.mock.calls[0];
    expect(err?.code).toBe(6);
    expect(err?.message).toBe("permission denied");
    expect(err?.metadata?.get("x-error")).toEqual(["123"]);
  });

  it("streams responses for server/bidi handlers", async () => {
    const rule: RuleDoc = {
      responses: [
        {
          stream_items: [
            { message: "Hello Alice" },
            { message: "Hello Bob" },
          ],
          stream_delay_ms: 0,
        },
      ],
    };

    class MockStream extends EventEmitter {
      metadata = new grpc.Metadata();
      cancelled = false;
      destroyed = false;
      request: any = {};
      writes: any[] = [];
      private resolve?: () => void;
      finished = new Promise<void>((resolve) => {
        this.resolve = resolve;
      });
      write(payload: any) {
        this.writes.push(payload);
      }
      end() {
        this.resolve?.();
      }
    }

    const stream = new MockStream();

    handleStreamingResponses(stream as any, rule, {}, {}, ResponseType, vi.fn());
    await (stream as any).finished;

    expect(stream.writes.map((w: any) => w.message)).toEqual([
      "Hello Alice",
      "Hello Bob",
    ]);
  });
});

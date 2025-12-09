import { describe, it, expect, beforeEach } from "bun:test";
import protobuf from "protobufjs";
import * as grpc from "@grpc/grpc-js";

import { buildHandlersFromRoot } from "../src/infrastructure/grpcServer.js";
import { runtime as validationRuntime } from "../src/infrastructure/validation/runtime.js";

describe("gRPC Server - Message-level CEL enforcement (Protovalidate)", () => {
  beforeEach(() => {
    process.env.VALIDATION_ENABLED = "true";
    process.env.VALIDATION_SOURCE = "protovalidate";
    process.env.VALIDATION_MODE = "per_message";
    process.env.VALIDATION_CEL_MESSAGE = "experimental";
  });

  function makeRoot() {
    const root = protobuf.Root.fromJSON({
      nested: {
        example: {
          nested: {
            // Message with message-level CEL: require min < max
            BufMessageCel: {
              options: {
                "(buf.validate.message).cel.expression": "this.min < this.max",
                "(buf.validate.message).cel.message": "min must be less than max",
              },
              fields: {
                min: { type: "int32", id: 1 },
                max: { type: "int32", id: 2 },
              },
            },
            HelloReply: {
              fields: { message: { type: "string", id: 1 } },
            },
            Val: {
              methods: {
                Check: {
                  requestType: "example.BufMessageCel",
                  responseType: "example.HelloReply",
                  comment: "",
                },
              },
            },
          },
        },
      },
    });
    return root;
  }

  it("returns INVALID_ARGUMENT when message-level CEL fails", async () => {
    const root = makeRoot();
    validationRuntime.loadFromRoot(root);

    const rules = new Map<string, any>([
      [
        "example.val.check",
        { responses: [{ body: { message: "ok" } }] },
      ],
    ]);

    const handlers = buildHandlersFromRoot(
      root,
      rules as any,
      () => {},
      () => {}
    );
    const meta = handlers.get("example.Val/Check");
    expect(meta).toBeDefined();
    const handler = meta!.handler as any;

    const call: any = { request: { min: 10, max: 5 }, metadata: new grpc.Metadata() };

    let capturedErr: any | null = null;
    let capturedRes: any | null = null;
    
    // Wait for async handler to complete
    await handler(call, (err: any, res: any) => { capturedErr = err; capturedRes = res; });

    expect(capturedRes).toBeUndefined();
    expect(capturedErr).toBeTruthy();
    expect(capturedErr.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("succeeds when message-level CEL passes", async () => {
    const root = makeRoot();
    validationRuntime.loadFromRoot(root);

    const rules = new Map<string, any>([
      [
        "example.val.check",
        { responses: [{ body: { message: "ok" } }] },
      ],
    ]);

    const handlers = buildHandlersFromRoot(
      root,
      rules as any,
      () => {},
      () => {}
    );
    const meta = handlers.get("example.Val/Check");
    expect(meta).toBeDefined();
    const handler = meta!.handler as any;

    const call: any = { request: { min: 1, max: 2 }, metadata: new grpc.Metadata() };

    let capturedErr: any | null = null;
    let capturedRes: any | null = null;
    
    // Wait for async handler to complete
    await handler(call, (err: any, res: any) => { capturedErr = err; capturedRes = res; });

    expect(capturedErr).toBeNull();
    expect(capturedRes).toBeDefined();
    expect(capturedRes).toHaveProperty("message", "ok");
  });
});


import { describe, it, beforeAll, expect } from "bun:test";
import path from "path";
import fs from "fs";
import { EventEmitter } from "events";
import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import yaml from "js-yaml";
import { buildHandlersFromRoot } from "../src/infrastructure/grpcServer.js";
import type { RuleDoc } from "../src/domain/types.js";

type UnaryCallback = Parameters<grpc.handleClientStreamingCall<any, any>>[1];

class MockReadableStream extends EventEmitter {
  metadata = new grpc.Metadata();
  cancelled = false;
  setTrailer = () => {};
}

class MockDuplexStream extends EventEmitter {
  metadata = new grpc.Metadata();
  cancelled = false;
  destroyed = false;
  writes: any[] = [];
  finished = false;

  write(payload: any) {
    this.writes.push(payload);
  }

  end() {
    this.finished = true;
    this.emit("finished");
  }
}

describe("gRPC streaming handlers", () => {
  const protoPath = path.join(process.cwd(), "protos", "helloworld.proto");
  const rulesDir = path.join(process.cwd(), "rules");

  let uploadHandler: grpc.handleClientStreamingCall<any, any>;
  let chatHandler: grpc.handleBidiStreamingCall<any, any>;

  beforeAll(async () => {
    const root = await protobuf.load(protoPath);
    const rulesIndex = new Map<string, RuleDoc>();
    const uploadRule = yaml.load(fs.readFileSync(path.join(rulesDir, "helloworld.greeter.uploadhello.yaml"), "utf8")) as RuleDoc;
    const chatRule = yaml.load(fs.readFileSync(path.join(rulesDir, "helloworld.greeter.chathello.yaml"), "utf8")) as RuleDoc;
    rulesIndex.set("helloworld.greeter.uploadhello", uploadRule);
    rulesIndex.set("helloworld.greeter.chathello", chatRule);

    const handlers = buildHandlersFromRoot(root, rulesIndex, () => {}, () => {});
    const uploadMeta = handlers.get("helloworld.Greeter/UploadHello");
    const chatMeta = handlers.get("helloworld.Greeter/ChatHello");
    if (!uploadMeta || !chatMeta) throw new Error("Expected streaming handlers to be registered");

    uploadHandler = uploadMeta.handler as grpc.handleClientStreamingCall<any, any>;
    chatHandler = chatMeta.handler as grpc.handleBidiStreamingCall<any, any>;
  });

  it("handles client streaming UploadHello", async () => {
    const call = new MockReadableStream();

    const result = await new Promise<any>((resolve, reject) => {
      const callback: UnaryCallback = (error, response) => {
        if (error) return reject(error);
        resolve(response);
      };
      uploadHandler(call as any, callback);
      call.emit("data", { name: "Alice" });
      call.emit("data", { name: "Bob" });
      call.emit("end");
    });

    expect(result.message).toBe("Uploaded 2 names. First=Alice Last=Bob");
  });

  it("handles bidirectional streaming ChatHello", async () => {
    const call = new MockDuplexStream();

    chatHandler(call as any);

    const finished = new Promise<void>((resolve) => {
      call.once("finished", resolve);
    });

    call.emit("data", { name: "Alice" });
    call.emit("data", { name: "Bob" });
    call.emit("end");

    await finished;

    expect(call.writes.map((msg) => msg.message)).toEqual([
      "Hello Alice",
      "Names received: 2",
      "Last seen: Bob",
    ]);
  });
});

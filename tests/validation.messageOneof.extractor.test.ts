import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";
import protobuf from "protobufjs";
import { loadProtos } from "../src/infrastructure/protoLoader.js";
import { buildDescriptorInfo } from "../src/infrastructure/validation/descriptors.js";
import { extractMessageRules } from "../src/domain/validation/ruleExtractor.js";

describe("Protovalidate Message-level Oneof - Extractor (baseline)", () => {
  let root: protobuf.Root;
  let msgType: protobuf.Type;

  beforeAll(async () => {
    const { root: loadedRoot } = await loadProtos(path.resolve("protos"));
    root = loadedRoot;
    const info = buildDescriptorInfo(root);
    msgType = info.messages.get("helloworld.BufMessageOneof")!;
  });

  it("extracts one message-level oneof from flattened options", () => {
    const ir = extractMessageRules(msgType, 'protovalidate');
    expect(ir.oneofs && ir.oneofs.length).toBeGreaterThan(0);
    const o = ir.oneofs![0];
    expect(o.source).toBe('protovalidate');
    expect(typeof o.required).toBe("boolean");
    expect(Array.isArray(o.fields)).toBe(true);
    expect(o.fields.length).toBeGreaterThan(0);
  });
});


import { describe, it, expect, beforeAll } from "bun:test";
import protobuf from "protobufjs";
import path from "path";
import {
  buildDescriptorInfo,
  normalizeTypeName,
  getMessageDescriptor,
  getAllMessageTypes,
} from "../src/infrastructure/validation/descriptors.js";
import { loadProtos } from "../src/infrastructure/protoLoader.js";

describe("Descriptor Loader (Fase 1)", () => {
  let root: protobuf.Root;

  beforeAll(async () => {
    const protoDir = path.resolve("protos");
    const { root: loadedRoot } = await loadProtos(protoDir);
    root = loadedRoot;
  });

  it("should build descriptor info from protobuf root", () => {
    const info = buildDescriptorInfo(root);
    
    expect(info.root).toBe(root);
    expect(info.messages).toBeInstanceOf(Map);
    expect(info.enums).toBeInstanceOf(Map);
  });

  it("should extract HelloRequest message type", () => {
    const info = buildDescriptorInfo(root);
    
    expect(info.messages.has("helloworld.HelloRequest")).toBe(true);
    expect(info.messages.has("helloworld.HelloReply")).toBe(true);
  });

  it("should normalize type names correctly", () => {
    expect(normalizeTypeName(".helloworld.HelloRequest")).toBe("helloworld.HelloRequest");
    expect(normalizeTypeName("helloworld.HelloRequest")).toBe("helloworld.HelloRequest");
  });

  it("should get message descriptor by type name", () => {
    const info = buildDescriptorInfo(root);
    
    const descriptor = getMessageDescriptor(info, "helloworld.HelloRequest");
    expect(descriptor).toBeDefined();
    expect(descriptor?.name).toBe("HelloRequest");
  });

  it("should get all message types", () => {
    const info = buildDescriptorInfo(root);
    
    const types = getAllMessageTypes(info);
    expect(types).toContain("helloworld.HelloRequest");
    expect(types).toContain("helloworld.HelloReply");
  });
});


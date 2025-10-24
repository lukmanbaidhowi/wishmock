import { describe, it, expect, beforeAll } from "bun:test";
import protobuf from "protobufjs";
import path from "path";
import {
  extractFieldRules,
  extractMessageRules,
  extractAllRules,
} from "../src/domain/validation/ruleExtractor.js";
import { buildDescriptorInfo } from "../src/infrastructure/validation/descriptors.js";
import { loadProtos } from "../src/infrastructure/protoLoader.js";

describe("Rule Extractor (Fase 2)", () => {
  let root: protobuf.Root;
  let helloRequestType: protobuf.Type;

  beforeAll(async () => {
    const protoDir = path.resolve("protos");
    const { root: loadedRoot } = await loadProtos(protoDir);
    root = loadedRoot;
    
    const info = buildDescriptorInfo(root);
    helloRequestType = info.messages.get("helloworld.HelloRequest")!;
  });

  it("should extract string validation rules from name field", () => {
    const nameField = helloRequestType.fields["name"];
    const constraint = extractFieldRules(nameField);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("string");
    expect(constraint?.fieldPath).toBe("name");
    expect(constraint?.source).toBe("pgv");
    
    const ops = constraint?.ops as any;
    expect(ops.min_len).toBe(3);
    expect(ops.max_len).toBe(50);
    expect(ops.pattern).toBe("^[a-zA-Z0-9_-]+$");
  });

  it("should extract email validation rules from email field", () => {
    const emailField = helloRequestType.fields["email"];
    const constraint = extractFieldRules(emailField);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("string");
    expect(constraint?.fieldPath).toBe("email");
    
    const ops = constraint?.ops as any;
    expect(ops.email).toBe(true);
  });

  it("should extract number validation rules from age field", () => {
    const ageField = helloRequestType.fields["age"];
    const constraint = extractFieldRules(ageField);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("number");
    expect(constraint?.fieldPath).toBe("age");
    
    const ops = constraint?.ops as any;
    expect(ops.gte).toBe(0);
    expect(ops.lte).toBe(150);
  });

  it("should extract message-level validation IR", () => {
    const ir = extractMessageRules(helloRequestType);
    
    expect(ir.typeName).toBe("helloworld.HelloRequest");
    expect(ir.fields.size).toBeGreaterThan(0);
    expect(ir.fields.has("name")).toBe(true);
  });

  it("should extract all rules from message map", () => {
    const info = buildDescriptorInfo(root);
    const irMap = extractAllRules(info.messages);
    
    expect(irMap.has("helloworld.HelloRequest")).toBe(true);
    
    const helloRequestIR = irMap.get("helloworld.HelloRequest");
    expect(helloRequestIR?.fields.size).toBeGreaterThan(0);
  });

  it("should not extract rules from fields without validation", () => {
    const info = buildDescriptorInfo(root);
    const helloReplyType = info.messages.get("helloworld.HelloReply")!;
    
    const ir = extractMessageRules(helloReplyType);
    expect(ir.fields.size).toBe(0);
  });
});


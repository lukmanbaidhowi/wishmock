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

describe("Rule Extractor - Protovalidate Validation", () => {
  let root: protobuf.Root;
  let protovalidateStringRequestType: protobuf.Type;
  let protovalidateNumberRequestType: protobuf.Type;
  let protovalidateRepeatedRequestType: protobuf.Type;

  beforeAll(async () => {
    const protoDir = path.resolve("protos");
    const { root: loadedRoot } = await loadProtos(protoDir);
    root = loadedRoot;
    
    const info = buildDescriptorInfo(root);
    protovalidateStringRequestType = info.messages.get("helloworld.BufValidationStringRequest")!;
    protovalidateNumberRequestType = info.messages.get("helloworld.BufValidationNumberRequest")!;
    protovalidateRepeatedRequestType = info.messages.get("helloworld.BufValidationRepeatedRequest")!;
  });

  it("should extract Protovalidate string min_len constraint", () => {
    const constraint = extractFieldRules(protovalidateStringRequestType.fields["minLenField"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("string");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.min_len).toBe(5);
  });

  it("should extract Protovalidate string max_len constraint", () => {
    const constraint = extractFieldRules(protovalidateStringRequestType.fields["maxLenField"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("string");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.max_len).toBe(10);
  });

  it("should extract Protovalidate string email constraint", () => {
    const constraint = extractFieldRules(protovalidateStringRequestType.fields["emailField"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("string");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.email).toBe(true);
  });

  it("should extract Protovalidate string ipv4 constraint", () => {
    const constraint = extractFieldRules(protovalidateStringRequestType.fields["ipv4Field"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("string");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.ipv4).toBe(true);
  });

  it("should extract Protovalidate string pattern constraint", () => {
    const constraint = extractFieldRules(protovalidateStringRequestType.fields["patternField"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("string");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.pattern).toBe("^[A-Z0-9]{3,6}$");
  });

  it("should extract Protovalidate number const constraint", () => {
    const constraint = extractFieldRules(protovalidateNumberRequestType.fields["constField"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("number");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.const).toBe(42);
  });

  it("should extract Protovalidate number range constraints", () => {
    const constraint = extractFieldRules(protovalidateNumberRequestType.fields["rangeField"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("number");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.gte).toBe(0);
    expect(ops.lte).toBe(100);
  });

  it("should extract Protovalidate repeated constraints", () => {
    const constraint = extractFieldRules(protovalidateRepeatedRequestType.fields["items"]);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("repeated");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.min_items).toBe(1);
    expect(ops.max_items).toBe(5);
  });

  it("should extract all Protovalidate validation rules from message", () => {
    const ir = extractMessageRules(protovalidateStringRequestType);
    
    expect(ir.typeName).toBe("helloworld.BufValidationStringRequest");
    expect(ir.fields.size).toBeGreaterThan(0);
  });
});

describe("Rule Extractor - CEL Expressions", () => {
  let root: protobuf.Root;
  let celValidationRequestType: protobuf.Type;
  let bufMessageCelType: protobuf.Type;

  beforeAll(async () => {
    const protoDir = path.resolve("protos");
    const { root: loadedRoot } = await loadProtos(protoDir);
    root = loadedRoot;
    
    const info = buildDescriptorInfo(root);
    celValidationRequestType = info.messages.get("helloworld.CelValidationRequest")!;
    bufMessageCelType = info.messages.get("helloworld.BufMessageCel")!;
  });

  it("should extract CEL expression constraint", () => {
    const field = celValidationRequestType.fields["age"];
    const constraint = extractFieldRules(field);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("cel");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.expression).toBe("age >= 18");
    expect(ops.message).toBe("must be 18 years old");
  });

  it("should extract all CEL validation rules from message", () => {
    const ir = extractMessageRules(celValidationRequestType);
    
    expect(ir.typeName).toBe("helloworld.CelValidationRequest");
    expect(ir.fields.size).toBe(1);
    expect(ir.fields.has("age")).toBe(true);
  });

  it("should parse message-level CEL (protovalidate)", () => {
    const ir = extractMessageRules(bufMessageCelType);
    expect(ir.typeName).toBe("helloworld.BufMessageCel");
    expect(ir.message?.cel && ir.message.cel.length).toBe(1);
    const rule = ir.message?.cel?.[0]!;
    expect(rule.expression).toBe("this.min_value < this.max_value");
    expect(rule.message).toBe("min_value must be less than max_value");
  });
});

describe("Rule Extractor - Enum Validation", () => {
  let root: protobuf.Root;
  let enumValidationRequestType: protobuf.Type;

  beforeAll(async () => {
    const protoDir = path.resolve("protos");
    const { root: loadedRoot } = await loadProtos(protoDir);
    root = loadedRoot;
    
    const info = buildDescriptorInfo(root);
    enumValidationRequestType = info.messages.get("helloworld.EnumValidationRequest")!;
  });

  it("should extract enum validation constraint", () => {
    const field = enumValidationRequestType.fields["status"];
    const constraint = extractFieldRules(field);
    
    expect(constraint).toBeDefined();
    expect(constraint?.kind).toBe("enum");
    expect(constraint?.source).toBe("protovalidate");
    
    const ops = constraint?.ops as any;
    expect(ops.definedOnly).toBe(true);
    // Note: protobufjs only captures the last value from repeated arrays in inline options
    expect(ops.in).toEqual([3]);
  });

  it("should extract all enum validation rules from message", () => {
    const ir = extractMessageRules(enumValidationRequestType);
    
    expect(ir.typeName).toBe("helloworld.EnumValidationRequest");
    expect(ir.fields.size).toBe(1);
    expect(ir.fields.has("status")).toBe(true);
  });
});

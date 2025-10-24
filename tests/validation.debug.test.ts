import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";
import { loadProtos } from "../src/infrastructure/protoLoader.js";
import { buildDescriptorInfo } from "../src/infrastructure/validation/descriptors.js";

describe("Debug validation options", () => {
  beforeAll(async () => {
    const protoDir = path.resolve("protos");
    const { root } = await loadProtos(protoDir);
    
    const info = buildDescriptorInfo(root);
    const helloRequestType = info.messages.get("helloworld.HelloRequest")!;
    
    console.log("HelloRequest fields:", Object.keys(helloRequestType.fields));
    
    for (const [fieldName, field] of Object.entries(helloRequestType.fields)) {
      console.log(`\nField: ${fieldName}`);
      console.log("  Type:", field.type);
      console.log("  Options:", field.options);
      console.log("  Options keys:", field.options ? Object.keys(field.options) : "none");
      if (field.options) {
        console.log("  Full options:", JSON.stringify(field.options, null, 2));
      }
    }
  });

  it("debug test", () => {
    expect(true).toBe(true);
  });
});


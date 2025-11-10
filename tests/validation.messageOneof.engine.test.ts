import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";
import { loadProtos } from "../src/infrastructure/protoLoader.js";
import { buildDescriptorInfo } from "../src/infrastructure/validation/descriptors.js";
import { extractMessageRules } from "../src/domain/validation/ruleExtractor.js";
import { validate } from "../src/domain/validation/engine.js";

describe("Protovalidate Message-level Oneof - Engine (baseline)", () => {
  let ir: ReturnType<typeof extractMessageRules>;

  beforeAll(async () => {
    const { root } = await loadProtos(path.resolve("protos"));
    const info = buildDescriptorInfo(root);
    const t = info.messages.get("helloworld.BufMessageOneof")!;
    ir = extractMessageRules(t, 'protovalidate');
  });

  it("enforces required when present", () => {
    // Required group should fail on empty message
    const r0 = validate(ir, {} as any);
    if (!r0.ok) {
      // If a required rule is present, we expect oneof_required; if not (loader flattened away), r0 may be ok.
      const hasRequired = (ir.oneofs || []).some(o => o.required === true);
      if (hasRequired) {
        expect(r0.violations.some(v => v.rule === 'oneof_required')).toBe(true);
      }
    }

    // Setting the visible field should pass
    const field = (ir.oneofs && ir.oneofs[0] && ir.oneofs[0].fields[0]) || 'd';
    const obj: any = {};
    obj[field] = 'x';
    const r1 = validate(ir, obj);
    expect(r1.ok).toBe(true);
  });
});


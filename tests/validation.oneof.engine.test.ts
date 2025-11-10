import { describe, it, expect } from "bun:test";
import { validate } from "../src/domain/validation/engine.js";
import type { ValidationIR } from "../src/domain/validation/types.js";

describe("Oneof Validation - Engine", () => {
  it("allows 0 or 1 field set by default (proto semantics)", () => {
    const ir: ValidationIR = {
      typeName: "test.OneofMessage",
      fields: new Map(),
      oneofs: [
        { name: "contact", fields: ["email", "phone"], required: false, source: 'proto' }
      ]
    };

    // 0 set => OK
    expect(validate(ir, {} as any).ok).toBe(true);
    // 1 set => OK
    expect(validate(ir, { email: "x@example.com" }).ok).toBe(true);
    // >1 set => INVALID
    const r = validate(ir, { email: "x@example.com", phone: "123" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.length).toBe(1);
      expect(r.violations[0].rule).toBe("oneof_multiple");
    }
  });

  it("requires exactly one when annotated required", () => {
    const ir: ValidationIR = {
      typeName: "test.OneofReqMessage",
      fields: new Map(),
      oneofs: [
        { name: "contact_req", fields: ["email_req", "phone_req"], required: true, source: 'pgv' }
      ]
    };

    // 0 set => INVALID
    const r0 = validate(ir, {} as any);
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.violations[0].rule).toBe("oneof_required");
    // 1 set => OK
    expect(validate(ir, { email_req: "x@example.com" }).ok).toBe(true);
    // >1 set => INVALID (multiple)
    const r2 = validate(ir, { email_req: "x@example.com", phone_req: "123" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.violations[0].rule).toBe("oneof_multiple");
  });
});


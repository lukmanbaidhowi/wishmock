import { describe, it, expect } from "bun:test";
import { validate } from "../src/domain/validation/engine.js";
import type { ValidationIR } from "../src/domain/validation/types.js";

describe("Validation Engine - Message-level CEL (basic)", () => {
  const irWithMessageCel: ValidationIR = {
    typeName: "test.MessageCel",
    fields: new Map(),
    message: {
      cel: [
        { expression: "this.min < this.max", message: "min must be less than max" },
      ],
      source: 'protovalidate',
    },
  };

  it("should ignore message-level CEL when not enforced", () => {
    const msg = { min: 10, max: 5 };
    const result = validate(irWithMessageCel, msg); // no opts
    expect(result.ok).toBe(true);
  });

  it("should fail when message-level CEL evaluates to false and enforcement is on", () => {
    const msg = { min: 10, max: 5 };
    const result = validate(irWithMessageCel, msg, { enforceMessageCel: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].rule).toBe("cel");
    }
  });

  it("should pass when message-level CEL evaluates to true and enforcement is on", () => {
    const msg = { min: 1, max: 2 };
    const result = validate(irWithMessageCel, msg, { enforceMessageCel: true });
    expect(result.ok).toBe(true);
  });
});


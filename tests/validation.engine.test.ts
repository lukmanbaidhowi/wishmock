import { describe, it, expect } from "bun:test";
import { validate } from "../src/domain/validation/engine.js";
import type { ValidationIR, StringConstraintOps, NumberConstraintOps } from "../src/domain/validation/types.js";

describe("Validator Engine (Fase 3)", () => {
  describe("String validation", () => {
    it("should validate min_len constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "name",
            {
              kind: "string",
              ops: { min_len: 3 } as StringConstraintOps,
              fieldPath: "name",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { name: "abc" });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { name: "ab" });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(1);
        expect(invalidResult.violations[0].rule).toBe("min_len");
        expect(invalidResult.violations[0].field).toBe("name");
      }
    });

    it("should validate max_len constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "name",
            {
              kind: "string",
              ops: { max_len: 5 } as StringConstraintOps,
              fieldPath: "name",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { name: "abc" });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { name: "abcdef" });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(1);
        expect(invalidResult.violations[0].rule).toBe("max_len");
      }
    });

    it("should validate pattern constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "name",
            {
              kind: "string",
              ops: { pattern: "^[a-zA-Z0-9_-]+$" } as StringConstraintOps,
              fieldPath: "name",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { name: "valid_name-123" });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { name: "invalid@name" });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(1);
        expect(invalidResult.violations[0].rule).toBe("pattern");
      }
    });

    it("should validate email constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "email",
            {
              kind: "string",
              ops: { email: true } as StringConstraintOps,
              fieldPath: "email",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { email: "test@example.com" });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { email: "not-an-email" });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(1);
        expect(invalidResult.violations[0].rule).toBe("email");
      }
    });

    it("should validate uuid constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "id",
            {
              kind: "string",
              ops: { uuid: true } as StringConstraintOps,
              fieldPath: "id",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { id: "123e4567-e89b-12d3-a456-426614174000" });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { id: "not-a-uuid" });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(1);
        expect(invalidResult.violations[0].rule).toBe("uuid");
      }
    });
  });

  describe("Number validation", () => {
    it("should validate gte constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "age",
            {
              kind: "number",
              ops: { gte: 0 } as NumberConstraintOps,
              fieldPath: "age",
              fieldType: "int32",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { age: 0 });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { age: -1 });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(1);
        expect(invalidResult.violations[0].rule).toBe("gte");
      }
    });

    it("should validate lte constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "age",
            {
              kind: "number",
              ops: { lte: 150 } as NumberConstraintOps,
              fieldPath: "age",
              fieldType: "int32",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { age: 150 });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { age: 151 });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(1);
        expect(invalidResult.violations[0].rule).toBe("lte");
      }
    });

    it("should validate gt constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "value",
            {
              kind: "number",
              ops: { gt: 0 } as NumberConstraintOps,
              fieldPath: "value",
              fieldType: "int32",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { value: 1 });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { value: 0 });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations[0].rule).toBe("gt");
      }
    });

    it("should validate lt constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "value",
            {
              kind: "number",
              ops: { lt: 100 } as NumberConstraintOps,
              fieldPath: "value",
              fieldType: "int32",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { value: 99 });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { value: 100 });
      expect(invalidResult.ok).toBe(false);
    });

    it("should validate in constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "status",
            {
              kind: "number",
              ops: { in: [1, 2, 3] } as NumberConstraintOps,
              fieldPath: "status",
              fieldType: "int32",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { status: 2 });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { status: 5 });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations[0].rule).toBe("in");
      }
    });
  });

  describe("Repeated validation", () => {
    it("should validate min_items constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "tags",
            {
              kind: "repeated",
              ops: { min_items: 2 },
              fieldPath: "tags",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { tags: ["a", "b"] });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { tags: ["a"] });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations[0].rule).toBe("min_items");
      }
    });

    it("should validate max_items constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "tags",
            {
              kind: "repeated",
              ops: { max_items: 3 },
              fieldPath: "tags",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { tags: ["a", "b", "c"] });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { tags: ["a", "b", "c", "d"] });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations[0].rule).toBe("max_items");
      }
    });

    it("should validate unique constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "tags",
            {
              kind: "repeated",
              ops: { unique: true },
              fieldPath: "tags",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { tags: ["a", "b", "c"] });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { tags: ["a", "b", "a"] });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations[0].rule).toBe("unique");
      }
    });
  });

  describe("Presence validation", () => {
    it("should validate required constraint", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "name",
            {
              kind: "presence",
              ops: { required: true },
              fieldPath: "name",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { name: "test" });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, {});
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations[0].rule).toBe("required");
      }
    });
  });

  describe("Combined validation", () => {
    it("should validate multiple constraints on a single field", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "name",
            {
              kind: "string",
              ops: {
                min_len: 3,
                max_len: 10,
                pattern: "^[a-zA-Z]+$",
              } as StringConstraintOps,
              fieldPath: "name",
              fieldType: "string",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { name: "valid" });
      expect(validResult.ok).toBe(true);

      const tooShortResult = validate(ir, { name: "ab" });
      expect(tooShortResult.ok).toBe(false);

      const tooLongResult = validate(ir, { name: "verylongname" });
      expect(tooLongResult.ok).toBe(false);

      const invalidPatternResult = validate(ir, { name: "test123" });
      expect(invalidPatternResult.ok).toBe(false);
    });

    it("should validate multiple fields", () => {
      const ir: ValidationIR = {
        typeName: "test.Message",
        fields: new Map([
          [
            "name",
            {
              kind: "string",
              ops: { min_len: 3 } as StringConstraintOps,
              fieldPath: "name",
              fieldType: "string",
              source: "pgv",
            },
          ],
          [
            "age",
            {
              kind: "number",
              ops: { gte: 0, lte: 150 } as NumberConstraintOps,
              fieldPath: "age",
              fieldType: "int32",
              source: "pgv",
            },
          ],
        ]),
      };

      const validResult = validate(ir, { name: "John", age: 25 });
      expect(validResult.ok).toBe(true);

      const invalidResult = validate(ir, { name: "ab", age: 200 });
      expect(invalidResult.ok).toBe(false);
      if (!invalidResult.ok) {
        expect(invalidResult.violations).toHaveLength(2);
      }
    });
  });
});

describe("Validation Engine - CEL Expressions", () => {
  it("should validate CEL expression success", () => {
    const ir: ValidationIR = {
      typeName: "test.CelMessage",
      fields: new Map([
        ["age", {
          kind: "cel",
          ops: {
            expression: "age >= 18",
            message: "must be 18 years old"
          },
          fieldPath: "age",
          fieldType: "int32",
          source: "buf",
        }]
      ])
    };

    const message = { age: 25 };
    const result = validate(ir, message);

    expect(result.ok).toBe(true);
  });

  it("should validate CEL expression failure", () => {
    const ir: ValidationIR = {
      typeName: "test.CelMessage",
      fields: new Map([
        ["age", {
          kind: "cel",
          ops: {
            expression: "age >= 18",
            message: "must be 18 years old"
          },
          fieldPath: "age",
          fieldType: "int32",
          source: "buf",
        }]
      ])
    };

    const message = { age: 15 };
    const result = validate(ir, message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].description).toBe("must be 18 years old");
    }
  });

  it("should validate complex CEL expression with multiple fields", () => {
    const ir: ValidationIR = {
      typeName: "test.RangeMessage",
      fields: new Map([
        ["range_check", {
          kind: "cel",
          ops: {
            expression: "min_value < max_value"
          },
          fieldPath: "range_check",
          fieldType: "bool",
          source: "buf",
        }]
      ])
    };

    const message = { min_value: 10, max_value: 20 };
    const result = validate(ir, message);

    expect(result.ok).toBe(true);
  });

  it("should fail complex CEL expression with multiple fields", () => {
    const ir: ValidationIR = {
      typeName: "test.RangeMessage",
      fields: new Map([
        ["range_check", {
          kind: "cel",
          ops: {
            expression: "min_value < max_value",
            message: "min_value must be less than max_value"
          },
          fieldPath: "range_check",
          fieldType: "bool",
          source: "buf",
        }]
      ])
    };

    const message = { min_value: 30, max_value: 20 };
    const result = validate(ir, message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].description).toBe("min_value must be less than max_value");
    }
  });
});

describe("Validation Engine - Enum Validation", () => {
  it("should validate enum in constraint", () => {
    const ir: ValidationIR = {
      typeName: "test.EnumMessage",
      fields: new Map([
        ["status", {
          kind: "enum",
          ops: {
            in: [1, 2, 3]
          },
          fieldPath: "status",
          fieldType: "enum",
          source: "buf",
        }]
      ])
    };

    const message = { status: 2 };
    const result = validate(ir, message);

    expect(result.ok).toBe(true);
  });

  it("should fail enum in constraint for disallowed value", () => {
    const ir: ValidationIR = {
      typeName: "test.EnumMessage",
      fields: new Map([
        ["status", {
          kind: "enum",
          ops: {
            in: [1, 2, 3]
          },
          fieldPath: "status",
          fieldType: "enum",
          source: "buf",
        }]
      ])
    };

    const message = { status: 5 };
    const result = validate(ir, message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].rule).toBe("in");
    }
  });

  it("should validate enum not_in constraint", () => {
    const ir: ValidationIR = {
      typeName: "test.EnumMessage",
      fields: new Map([
        ["status", {
          kind: "enum",
          ops: {
            not_in: [0, 4]
          },
          fieldPath: "status",
          fieldType: "enum",
          source: "buf",
        }]
      ])
    };

    const message = { status: 2 };
    const result = validate(ir, message);

    expect(result.ok).toBe(true);
  });

  it("should fail enum not_in constraint for disallowed value", () => {
    const ir: ValidationIR = {
      typeName: "test.EnumMessage",
      fields: new Map([
        ["status", {
          kind: "enum",
          ops: {
            not_in: [0, 4]
          },
          fieldPath: "status",
          fieldType: "enum",
          source: "buf",
        }]
      ])
    };

    const message = { status: 0 };
    const result = validate(ir, message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0].rule).toBe("not_in");
    }
  });

  it("should validate enum defined_only constraint", () => {
    const ir: ValidationIR = {
      typeName: "test.EnumMessage",
      fields: new Map([
        ["status", {
          kind: "enum",
          ops: {
            definedOnly: true
          },
          fieldPath: "status",
          fieldType: "enum",
          source: "buf",
        }]
      ])
    };

    const message = { status: 1 };
    const result = validate(ir, message);

    expect(result.ok).toBe(true);
  });

  it("should allow null/undefined enum values when not defined_only", () => {
    const ir: ValidationIR = {
      typeName: "test.EnumMessage",
      fields: new Map([
        ["status", {
          kind: "enum",
          ops: {
            in: [1, 2, 3]
          },
          fieldPath: "status",
          fieldType: "enum",
          source: "buf",
        }]
      ])
    };

    const message = { status: undefined };
    const result = validate(ir, message);

    expect(result.ok).toBe(true);
  });
});


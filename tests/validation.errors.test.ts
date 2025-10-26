import { describe, it, expect } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import { makeInvalidArgError } from "../src/domain/validation/errors.js";

describe("Validation Errors - Standardization", () => {
  it("should return INVALID_ARGUMENT with JSON summary", () => {
    const err = makeInvalidArgError([
      { field: "name", description: "required", rule: "required" },
    ]);
    expect(err.code).toBe(grpc.status.INVALID_ARGUMENT);
    expect(typeof err.message).toBe("string");
    const parsed = JSON.parse(err.message);
    expect(parsed.reason).toBe("validation_failed");
    expect(parsed.field_violations.length).toBe(1);
    expect(parsed.field_violations[0].field).toBe("name");
  });
});


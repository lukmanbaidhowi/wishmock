import { describe, it, expect } from "bun:test";
import { selectResponse } from "../src/domain/usecases/selectResponse.js";
import type { RuleDoc, ResponseOption, MetadataMap } from "../src/domain/types.js";

describe("selectResponse", () => {
  it("returns default ok when rule is undefined", () => {
    const res = selectResponse(undefined, {}, {});
    expect(res.body).toEqual({});
    expect(res.trailers).toEqual({ "grpc-status": "0" });
  });

  it("uses fallback when top-level match.metadata fails", () => {
    const rule: RuleDoc = {
      match: { metadata: { auth: "token" } },
      responses: [{ body: { message: "fallback" }, trailers: { "grpc-status": "0" } }],
    };
    const res = selectResponse(rule, {}, { auth: "wrong" } as MetadataMap);
    expect(res.body).toEqual({ message: "fallback" });
  });

  it("uses fallback when top-level match.request fails", () => {
    const rule: RuleDoc = {
      match: { request: { "user.id": 1 } },
      responses: [{ body: { message: "fb" }, trailers: { "grpc-status": "0" } }],
    };
    const res = selectResponse(rule, { user: { id: 2 } }, {});
    expect(res.body).toEqual({ message: "fb" });
  });

  it("selects first matching conditional response when match passes", () => {
    const rule: RuleDoc = {
      match: { request: { name: "Tom" } },
      responses: [
        { when: { "request.name": "Tom" }, body: { message: "hi Tom" }, trailers: { "grpc-status": "0" } },
        { body: { message: "fb" }, trailers: { "grpc-status": "0" } },
      ],
    };
    const res = selectResponse(rule, { name: "Tom" }, {});
    expect(res.body).toEqual({ message: "hi Tom" });
  });

  it("supports metadata in conditional 'when'", () => {
    const rule: RuleDoc = {
      match: { request: { id: 1 } },
      responses: [
        { when: { "metadata.role": "admin" }, body: { ok: true }, trailers: { "grpc-status": "0" } },
        { body: { ok: false }, trailers: { "grpc-status": "0" } },
      ],
    };
    const res1 = selectResponse(rule, { id: 1 }, { role: "admin" });
    expect(res1.body).toEqual({ ok: true });

    const res2 = selectResponse(rule, { id: 1 }, { role: "user" });
    expect(res2.body).toEqual({ ok: false });
  });

  it("falls back to default ok when no responses present", () => {
    const rule: RuleDoc = { match: { request: { a: 1 } }, responses: [] };
    const res = selectResponse(rule, { a: 1 }, {});
    expect(res.body).toEqual({});
    expect(res.trailers).toEqual({ "grpc-status": "0" });
  });

  it("supports regex operator in top-level metadata match", () => {
    const rule: RuleDoc = {
      match: { metadata: { authorization: { regex: "^Bearer \\w+$" } as any } },
      responses: [
        { when: { "request.id": 1 }, body: { ok: true }, trailers: { "grpc-status": "0" } },
        { body: { ok: false }, trailers: { "grpc-status": "0" } },
      ],
    } as any;
    const res = selectResponse(rule, { id: 1 }, { authorization: "Bearer token123" });
    expect(res.body).toEqual({ ok: true });
  });

  it("supports contains operator for arrays and strings", () => {
    const rule: RuleDoc = {
      match: { request: { name: { contains: "Tom" } as any } },
      responses: [
        { when: { "request.tags": { contains: "gold" } as any }, body: { tier: "vip" }, trailers: { "grpc-status": "0" } },
        { body: { tier: "std" }, trailers: { "grpc-status": "0" } },
      ],
    } as any;
    const res = selectResponse(rule, { name: "Tommy", tags: ["silver", "gold"] }, {});
    expect(res.body).toEqual({ tier: "vip" });
  });

  it("supports in and numeric comparisons", () => {
    const rule: RuleDoc = {
      match: { request: { "user.age": { gte: 18 } as any } },
      responses: [
        { when: { "metadata.role": { in: ["admin", "root"] } as any }, body: { allow: true }, trailers: { "grpc-status": "0" } },
        { body: { allow: false }, trailers: { "grpc-status": "0" } },
      ],
    } as any;
    const res1 = selectResponse(rule, { user: { age: 20 } }, { role: "admin" });
    expect(res1.body).toEqual({ allow: true });
    const res2 = selectResponse(rule, { user: { age: 17 } }, { role: "admin" });
    // age < 18 -> top-level match fails -> fallback chosen (second response)
    expect(res2.body).toEqual({ allow: false });
  });

  it("picks the highest numeric priority among matched when", () => {
    const rule: RuleDoc = {
      match: { request: { type: "x" } },
      responses: [
        { when: { "request.type": "x" }, body: { id: 1 }, trailers: { "grpc-status": "0" }, priority: 1 },
        { when: { "request.type": "x" }, body: { id: 2 }, trailers: { "grpc-status": "0" }, priority: 5 },
        { when: { "request.type": "x" }, body: { id: 3 }, trailers: { "grpc-status": "0" }, priority: 3 },
        { body: { id: 999 }, trailers: { "grpc-status": "0" } },
      ],
    } as any;
    const res = selectResponse(rule, { type: "x" }, {});
    expect(res.body).toEqual({ id: 2 });
  });

  it("defaults priority to 0 when unspecified and uses order as tiebreaker", () => {
    const rule: RuleDoc = {
      match: { request: { v: 1 } },
      responses: [
        { when: { "request.v": 1 }, body: { pick: "first" }, trailers: { "grpc-status": "0" } },
        { when: { "request.v": 1 }, body: { pick: "second" }, trailers: { "grpc-status": "0" }, priority: 0 },
        { when: { "request.v": 1 }, body: { pick: "low" }, trailers: { "grpc-status": "0" }, priority: -1 },
      ],
    } as any;
    const res = selectResponse(rule, { v: 1 }, {});
    expect(res.body).toEqual({ pick: "first" });
  });

  it("uses highest priority among fallbacks when match fails or none match", () => {
    // Top-level match fails -> choose fallback with highest priority
    const rule1: RuleDoc = {
      match: { request: { a: 1 } },
      responses: [
        { body: { fb: 1 }, trailers: { "grpc-status": "0" }, priority: 1 },
        { body: { fb: 2 }, trailers: { "grpc-status": "0" }, priority: 10 },
      ],
    } as any;
    const res1 = selectResponse(rule1, { a: 2 }, {});
    expect(res1.body).toEqual({ fb: 2 });

    // Match passes but no conditional 'when' matches -> fallback highest priority
    const rule2: RuleDoc = {
      match: { request: { a: 1 } },
      responses: [
        { when: { "request.b": 5 }, body: { id: "no" }, trailers: { "grpc-status": "0" }, priority: 100 },
        { body: { fb: 3 }, trailers: { "grpc-status": "0" }, priority: 2 },
        { body: { fb: 4 }, trailers: { "grpc-status": "0" }, priority: 7 },
      ],
    } as any;
    const res2 = selectResponse(rule2, { a: 1 }, {});
    expect(res2.body).toEqual({ fb: 4 });
  });
});
  it("supports exists operator", () => {
    const rule: RuleDoc = {
      match: { request: { "user.id": { exists: true } as any } },
      responses: [
        { when: { "request.optional": { exists: false } as any }, body: { hasOptional: false }, trailers: { "grpc-status": "0" } },
        { body: { hasOptional: true }, trailers: { "grpc-status": "0" } },
      ],
    } as any;
    const res = selectResponse(rule, { user: { id: 123 } }, {});
    expect(res.body).toEqual({ hasOptional: false });
  });

  it("supports not operator", () => {
    const rule: RuleDoc = {
      match: { request: { name: { not: { eq: "blocked" } } as any } },
      responses: [
        { when: { "request.name": { not: { contains: "test" } } as any }, body: { allowed: true }, trailers: { "grpc-status": "0" } },
        { body: { allowed: false }, trailers: { "grpc-status": "0" } },
      ],
    } as any;
    const res = selectResponse(rule, { name: "user" }, {});
    expect(res.body).toEqual({ allowed: true });
  });

  it("handles regex with invalid pattern gracefully", () => {
    const rule: RuleDoc = {
      match: { request: { name: { regex: "[invalid" } as any } },
      responses: [{ body: { message: "fallback" }, trailers: { "grpc-status": "0" } }],
    } as any;
    const res = selectResponse(rule, { name: "test" }, {});
    expect(res.body).toEqual({ message: "fallback" });
  });

  it("supports eq and ne operators", () => {
    const rule: RuleDoc = {
      match: { request: { status: { ne: "disabled" } as any } },
      responses: [
        { when: { "request.type": { eq: "premium" } as any }, body: { tier: "gold" }, trailers: { "grpc-status": "0" } },
        { body: { tier: "standard" }, trailers: { "grpc-status": "0" } },
      ],
    } as any;
    const res1 = selectResponse(rule, { status: "active", type: "premium" }, {});
    expect(res1.body).toEqual({ tier: "gold" });
    
    const res2 = selectResponse(rule, { status: "active", type: "basic" }, {});
    expect(res2.body).toEqual({ tier: "standard" });
  });

  it("handles numeric comparisons with undefined values", () => {
    const rule: RuleDoc = {
      match: { request: { age: { gt: "invalid" } as any } },
      responses: [{ body: { message: "fallback" }, trailers: { "grpc-status": "0" } }],
    } as any;
    const res = selectResponse(rule, { age: 25 }, {});
    expect(res.body).toEqual({ message: "fallback" });
  });

  it("handles unknown operator objects by falling back to string equality", () => {
    const rule: RuleDoc = {
      match: { request: { name: { unknownOp: "value" } as any } },
      responses: [{ body: { message: "matched" }, trailers: { "grpc-status": "0" } }],
    } as any;
    const res = selectResponse(rule, { name: "[object Object]" }, {});
    expect(res.body).toEqual({ message: "matched" });
  });

  it("returns first option when pickHighestPriority has no best match", () => {
    const rule: RuleDoc = {
      match: { request: { type: "test" } },
      responses: [],
    };
    const res = selectResponse(rule, { type: "test" }, {});
    expect(res.body).toEqual({});
    expect(res.trailers).toEqual({ "grpc-status": "0" });
  });
  it("covers all numeric comparison branches", () => {
    // Test lt operator with valid numbers
    const rule1: RuleDoc = {
      match: { request: { age: { lt: 18 } as any } },
      responses: [{ body: { minor: true }, trailers: { "grpc-status": "0" } }],
    } as any;
    const res1 = selectResponse(rule1, { age: 16 }, {});
    expect(res1.body).toEqual({ minor: true });

    // Test lte operator with valid numbers  
    const rule2: RuleDoc = {
      match: { request: { score: { lte: 100 } as any } },
      responses: [{ body: { valid: true }, trailers: { "grpc-status": "0" } }],
    } as any;
    const res2 = selectResponse(rule2, { score: 100 }, {});
    expect(res2.body).toEqual({ valid: true });
  });

  it("handles 'in' operator with non-array value", () => {
    const rule: RuleDoc = {
      match: { request: { role: { in: "not-an-array" } as any } },
      responses: [{ body: { message: "fallback" }, trailers: { "grpc-status": "0" } }],
    } as any;
    const res = selectResponse(rule, { role: "admin" }, {});
    expect(res.body).toEqual({ message: "fallback" });
  });
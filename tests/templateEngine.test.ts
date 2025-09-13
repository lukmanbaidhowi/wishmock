import { describe, it, expect } from "bun:test";
import { renderTemplate, createTemplateContext } from "../src/domain/usecases/templateEngine.js";

describe("Template Engine", () => {
  it("should render simple string templates", () => {
    const context = createTemplateContext(
      { name: "John", age: 30 },
      { authorization: "Bearer token123" }
    );

    const result = renderTemplate("Hello {{request.name}}!", context);
    expect(result).toBe("Hello John!");
  });

  it("should render nested object templates", () => {
    const context = createTemplateContext(
      { user: { name: "Alice", profile: { age: 25 } } },
      { "user-agent": "test-client" }
    );

    const template = {
      message: "Hello {{request.user.name}}!",
      age: "{{request.user.profile.age}}",
      client: "{{metadata.user-agent}}"
    };

    const result = renderTemplate(template, context);
    expect(result).toEqual({
      message: "Hello Alice!",
      age: "25",
      client: "test-client"
    });
  });

  it("should render array templates", () => {
    const context = createTemplateContext(
      { items: ["apple", "banana"] },
      {}
    );

    const template = ["Item: {{request.items.0}}", "Item: {{request.items.1}}"];
    const result = renderTemplate(template, context);
    expect(result).toEqual(["Item: apple", "Item: banana"]);
  });

  it("should handle utility functions", () => {
    const context = createTemplateContext({ name: "Bob" }, {});
    
    const template = {
      timestamp: "{{utils.now()}}",
      uuid: "{{utils.uuid()}}",
      random: "{{utils.random(1, 10)}}",
      formatted: "{{utils.format('Hello %s', request.name)}}"
    };

    const result = renderTemplate(template, context) as any;
    
    expect(typeof result.timestamp).toBe("string");
    expect(result.timestamp).toMatch(/^\d+$/);
    expect(typeof result.uuid).toBe("string");
    expect(result.uuid).toMatch(/^[0-9a-f-]+$/);
    expect(typeof result.random).toBe("string");
    expect(parseFloat(result.random)).toBeGreaterThanOrEqual(1);
    expect(parseFloat(result.random)).toBeLessThanOrEqual(10);
    expect(result.formatted).toBe("Hello Bob");
  });

  it("should handle stream context", () => {
    const context = createTemplateContext(
      { user_id: "test" },
      {},
      { index: 1, total: 3 }
    );

    const template = {
      message: "Message {{stream.index}} of {{stream.total}}",
      is_first: "{{stream.isFirst}}",
      is_last: "{{stream.isLast}}"
    };

    const result = renderTemplate(template, context);
    expect(result).toEqual({
      message: "Message 1 of 3",
      is_first: "false",
      is_last: "false"
    });
  });

  it("should handle missing values gracefully", () => {
    const context = createTemplateContext({}, {});
    
    const result = renderTemplate("Hello {{request.missing}}!", context);
    expect(result).toBe("Hello !");
  });

  it("should handle invalid expressions gracefully", () => {
    const context = createTemplateContext({ name: "Test" }, {});
    
    const result = renderTemplate("Hello {{invalid.expression.here}}!", context);
    expect(result).toBe("Hello !");
  });

  it("should not process non-template strings", () => {
    const context = createTemplateContext({ name: "Test" }, {});
    
    const result = renderTemplate("Hello world!", context);
    expect(result).toBe("Hello world!");
  });

  it("should handle complex nested templates", () => {
    const context = createTemplateContext(
      { 
        user: { 
          name: "Charlie", 
          preferences: { theme: "dark" } 
        } 
      },
      { 
        authorization: "Bearer abc123",
        "x-client-version": "1.0.0" 
      }
    );

    const template = {
      welcome: {
        message: "Welcome {{request.user.name}}!",
        theme: "Your theme is {{request.user.preferences.theme}}",
        auth: "Token: {{metadata.authorization}}",
        version: "Client: {{metadata.x-client-version}}"
      },
      timestamp: "{{utils.now()}}"
    };

    const result = renderTemplate(template, context) as any;
    expect(result.welcome.message).toBe("Welcome Charlie!");
    expect(result.welcome.theme).toBe("Your theme is dark");
    expect(result.welcome.auth).toBe("Token: Bearer abc123");
    expect(result.welcome.version).toBe("Client: 1.0.0");
    expect(typeof result.timestamp).toBe("string");
  });

  it("should allow deterministic utils via utilsOverrides", () => {
    const context = createTemplateContext(
      { name: "Dana" },
      { traceId: "abc" },
      undefined,
      {
        now: () => 1700000000000,
        uuid: () => "00000000-0000-4000-8000-000000000000",
        random: (min = 0, max = 1) => min + (max - min) * 0.5,
        format: (tpl: string, ...args: unknown[]) => `F:${tpl}|${args.join(',')}`,
      }
    );

    const template = {
      ts: "{{utils.now()}}",
      id: "{{utils.uuid()}}",
      rnd: "{{utils.random(10, 20)}}",
      msg: "{{utils.format('Hello %s', request.name)}}",
    } as const;

    const result = renderTemplate(template, context);
    expect(result).toEqual({
      ts: "1700000000000",
      id: "00000000-0000-4000-8000-000000000000",
      rnd: String(0.5 * (20 - 10) + 10),
      msg: "F:Hello %s|Dana",
    });
  });

  it("catches errors during expression evaluation and returns original token", () => {
    const context = createTemplateContext(
      {},
      {},
      undefined,
      {
        // Force a throw when called
        now: () => { throw new Error("boom"); },
      }
    );

    const result = renderTemplate("ts={{utils.now()}}", context);
    // Should keep the original token since evaluation threw
    expect(result).toBe("ts={{utils.now()}}");
  });

  it("parses boolean arguments in function calls", () => {
    const context = createTemplateContext(
      {},
      {},
      undefined,
      {
        // Echo the boolean as a string for assertion
        format: (_tpl: string, v: unknown) => String(v === true),
      }
    );

    const resultTrue = renderTemplate("{{utils.format('%s', true)}}", context);
    const resultFalse = renderTemplate("{{utils.format('%s', false)}}", context);
    expect(resultTrue).toBe("true");
    expect(resultFalse).toBe("false");
  });

  it("returns raw expression for unknown function paths", () => {
    const context = createTemplateContext({}, {});
    const result = renderTemplate("X {{utils.notExist(1)}} Y", context);
    // Since utils.notExist is not a function, expression is left as-is
    expect(result).toBe("X utils.notExist(1) Y");
  });

  it("returns raw expression when function syntax doesn't match", () => {
    const context = createTemplateContext({}, {});
    // Missing closing parenthesis -> includes('(') true, but regex won't match
    const result = renderTemplate("Z={{utils.random(1,2}}", context);
    expect(result).toBe("Z=utils.random(1,2");
  });

  it("supports direct property access fallback", () => {
    const context = createTemplateContext({}, { h: "v" });
    const result = renderTemplate("M={{metadata}}", context);
    // Stringifying the whole object
    expect(result).toBe("M=[object Object]");
  });

  it("returns non-string templates unchanged (number, null)", () => {
    const context = createTemplateContext({}, {});
    expect(renderTemplate(42, context)).toBe(42);
    expect(renderTemplate(null, context)).toBeNull();
  });

  it("stringifies function references when used without parentheses", () => {
    const context = createTemplateContext({}, {});
    const result = renderTemplate("F={{utils.format}}", context) as string;
    expect(result).toContain("F=");
    // In Bun/TS transpile, functions may stringify as arrow functions
    expect(result.includes("function") || result.includes("=>")).toBe(true);
  });
});

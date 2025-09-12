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
});
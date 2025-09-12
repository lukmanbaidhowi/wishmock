import get from "lodash.get";
import type { MetadataMap } from "../types.js";

export interface TemplateContext {
  request: unknown;
  metadata: MetadataMap;
  stream?: {
    index: number;
    total: number;
    isFirst: boolean;
    isLast: boolean;
  };
  utils: {
    now: () => number;
    uuid: () => string;
    random: (min?: number, max?: number) => number;
    format: (template: string, ...args: unknown[]) => string;
  };
}

export function renderTemplate(template: unknown, context: TemplateContext): unknown {
  if (typeof template === 'string') {
    return renderStringTemplate(template, context);
  }
  
  if (Array.isArray(template)) {
    return template.map(item => renderTemplate(item, context));
  }
  
  if (template && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = renderTemplate(value, context);
    }
    return result;
  }
  
  return template;
}

function renderStringTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
    try {
      const trimmed = expression.trim();
      const value = evaluateExpression(trimmed, context);
      return String(value ?? '');
    } catch {
      return match; // Return original if evaluation fails
    }
  });
}

function evaluateExpression(expr: string, context: TemplateContext): unknown {
  // Handle function calls
  if (expr.includes('(')) {
    return evaluateFunction(expr, context);
  }
  
  // Handle property access
  if (expr.startsWith('request.')) {
    return get(context.request, expr.slice(8));
  }
  
  if (expr.startsWith('metadata.')) {
    return get(context.metadata, expr.slice(9));
  }
  
  if (expr.startsWith('stream.')) {
    return get(context.stream, expr.slice(7));
  }
  
  if (expr.startsWith('utils.')) {
    return get(context.utils, expr.slice(6));
  }
  
  // Direct property access
  return get(context, expr);
}

function evaluateFunction(expr: string, context: TemplateContext): unknown {
  const funcMatch = expr.match(/^(\w+(?:\.\w+)*)\((.*)\)$/);
  if (!funcMatch) return expr;
  
  const [, funcPath, argsStr] = funcMatch;
  const func = get(context, funcPath);
  
  if (typeof func !== 'function') return expr;
  
  // Parse simple arguments (strings, numbers, booleans)
  const args = argsStr ? parseArguments(argsStr, context) : [];
  
  return func(...args);
}

function parseArguments(argsStr: string, context: TemplateContext): unknown[] {
  if (!argsStr.trim()) return [];
  
  const args: unknown[] = [];
  const parts = argsStr.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    
    // String literal
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || 
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      args.push(trimmed.slice(1, -1));
      continue;
    }
    
    // Number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      args.push(Number(trimmed));
      continue;
    }
    
    // Boolean
    if (trimmed === 'true' || trimmed === 'false') {
      args.push(trimmed === 'true');
      continue;
    }
    
    // Property access
    args.push(evaluateExpression(trimmed, context));
  }
  
  return args;
}

export function createTemplateContext(
  request: unknown, 
  metadata: MetadataMap, 
  streamInfo?: { index: number; total: number }
): TemplateContext {
  return {
    request,
    metadata,
    stream: streamInfo ? {
      ...streamInfo,
      isFirst: streamInfo.index === 0,
      isLast: streamInfo.index === streamInfo.total - 1
    } : undefined,
    utils: {
      now: () => Date.now(),
      uuid: () => crypto.randomUUID(),
      random: (min = 0, max = 1) => Math.random() * (max - min) + min,
      format: (template: string, ...args: unknown[]) => {
        return template.replace(/%s/g, () => String(args.shift() ?? ''));
      }
    }
  };
}
import protobuf from "protobufjs";
import type {
  ValidationIR,
  FieldConstraint,
  StringConstraintOps,
  NumberConstraintOps,
  RepeatedConstraintOps,
  ConstraintKind,
} from "./types.js";

function extractStringRulesFromFlat(options: Record<string, any>): StringConstraintOps | null {
  const ops: StringConstraintOps = {};
  const prefix = "(validate.rules).string.";
  
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(prefix)) continue;
    
    const ruleName = key.slice(prefix.length);
    
    switch (ruleName) {
      case "pattern":
        ops.pattern = String(value);
        break;
      case "email":
        if (value === true) ops.email = true;
        break;
      case "uuid":
        if (value === true) ops.uuid = true;
        break;
      case "hostname":
        if (value === true) ops.hostname = true;
        break;
      case "ipv4":
        if (value === true) ops.ipv4 = true;
        break;
      case "ipv6":
        if (value === true) ops.ipv6 = true;
        break;
      case "uri":
        if (value === true) ops.uri = true;
        break;
      case "min_len":
        ops.min_len = Number(value);
        break;
      case "max_len":
        ops.max_len = Number(value);
        break;
      case "min_bytes":
        ops.min_bytes = Number(value);
        break;
      case "max_bytes":
        ops.max_bytes = Number(value);
        break;
      case "prefix":
        ops.prefix = String(value);
        break;
      case "suffix":
        ops.suffix = String(value);
        break;
      case "contains":
        ops.contains = String(value);
        break;
      case "not_contains":
        ops.not_contains = String(value);
        break;
      case "in":
        if (Array.isArray(value)) ops.in = value.map(String);
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(String);
        break;
      case "ignore_empty":
        ops.ignore_empty = Boolean(value);
        break;
    }
  }

  return Object.keys(ops).length > 0 ? ops : null;
}

function extractNumberRulesFromFlat(options: Record<string, any>, fieldType: string): NumberConstraintOps | null {
  const ops: NumberConstraintOps = {};
  const prefix = `(validate.rules).${fieldType}.`;
  
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(prefix)) continue;
    
    const ruleName = key.slice(prefix.length);
    
    switch (ruleName) {
      case "const":
        ops.const = Number(value);
        break;
      case "gt":
        ops.gt = Number(value);
        break;
      case "gte":
        ops.gte = Number(value);
        break;
      case "lt":
        ops.lt = Number(value);
        break;
      case "lte":
        ops.lte = Number(value);
        break;
      case "in":
        if (Array.isArray(value)) ops.in = value.map(Number);
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(Number);
        break;
      case "ignore_empty":
        ops.ignore_empty = Boolean(value);
        break;
    }
  }

  return Object.keys(ops).length > 0 ? ops : null;
}

function extractRepeatedRulesFromFlat(options: Record<string, any>): RepeatedConstraintOps | null {
  const ops: RepeatedConstraintOps = {};
  const prefix = "(validate.rules).repeated.";
  
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(prefix)) continue;
    
    const ruleName = key.slice(prefix.length);
    
    switch (ruleName) {
      case "min_items":
        ops.min_items = Number(value);
        break;
      case "max_items":
        ops.max_items = Number(value);
        break;
      case "unique":
        ops.unique = Boolean(value);
        break;
      case "ignore_empty":
        ops.ignore_empty = Boolean(value);
        break;
    }
  }

  return Object.keys(ops).length > 0 ? ops : null;
}

export function extractFieldRules(field: protobuf.Field): FieldConstraint | null {
  if (!field.options) return null;

  const fieldPath = field.name;
  const fieldType = field.type;

  const ops = extractStringRulesFromFlat(field.options);
  if (ops) {
    return {
      kind: 'string',
      ops,
      fieldPath,
      fieldType,
      source: 'pgv',
    };
  }

  const numberTypes = ['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 
                       'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'];
  
  if (numberTypes.includes(fieldType)) {
    const numOps = extractNumberRulesFromFlat(field.options, fieldType);
    if (numOps) {
      return {
        kind: 'number',
        ops: numOps,
        fieldPath,
        fieldType,
        source: 'pgv',
      };
    }
  }

  if (field.repeated) {
    const repOps = extractRepeatedRulesFromFlat(field.options);
    if (repOps) {
      return {
        kind: 'repeated',
        ops: repOps,
        fieldPath,
        fieldType,
        source: 'pgv',
      };
    }
  }

  if ((field.options as any)["(validate.rules).message.required"] === true) {
    return {
      kind: 'presence',
      ops: { required: true },
      fieldPath,
      fieldType,
      source: 'pgv',
    };
  }

  return null;
}

export function extractMessageRules(messageType: protobuf.Type): ValidationIR {
  const typeName = messageType.fullName?.replace(/^\./, "") || messageType.name;
  const fields = new Map<string, FieldConstraint>();

  for (const field of messageType.fieldsArray) {
    const constraint = extractFieldRules(field);
    if (constraint) {
      fields.set(field.name, constraint);
    }
  }

  return {
    typeName,
    fields,
  };
}

export function extractAllRules(
  messages: Map<string, protobuf.Type>
): Map<string, ValidationIR> {
  const irMap = new Map<string, ValidationIR>();

  for (const [typeName, messageType] of messages) {
    const ir = extractMessageRules(messageType);
    if (ir.fields.size > 0) {
      irMap.set(typeName, ir);
    }
  }

  return irMap;
}


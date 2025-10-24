import protobuf from "protobufjs";
import type {
  ValidationIR,
  FieldConstraint,
  StringConstraintOps,
  NumberConstraintOps,
  RepeatedConstraintOps,
  ConstraintKind,
  PresenceConstraintOps,
  EnumConstraintOps,
} from "./types.js";

// Note: We keep proto field names as-is (snake_case) because
// proto-loader is configured with keepCase=true, so deserialized
// JS objects on the server use snake_case keys.

function extractStringRulesFromFlat(options: Record<string, any>): StringConstraintOps | null {
  const ops: StringConstraintOps = {};
  const prefix = "(validate.rules).string.";

  // Prefer nested representation if present
  const nestedRoot = options["(validate.rules)"];
  const nested = (nestedRoot && (nestedRoot.string || nestedRoot.bytes)) || undefined;
  // Also support flattened object form: (validate.rules).string = { ... }
  const flatObj = options["(validate.rules).string"];
  const src: Record<string, any> | undefined = nested ? (nestedRoot.string as any)
    : (typeof flatObj === 'object' && flatObj) || undefined;

  const assign = (key: string, value: any) => {
    switch (key) {
      case "pattern": ops.pattern = String(value); break;
      case "email": if (value === true) ops.email = true; break;
      case "uuid": if (value === true) ops.uuid = true; break;
      case "hostname": if (value === true) ops.hostname = true; break;
      case "ipv4": if (value === true) ops.ipv4 = true; break;
      case "ipv6": if (value === true) ops.ipv6 = true; break;
      case "uri": if (value === true) ops.uri = true; break;
      case "min_len": ops.min_len = Number(value); break;
      case "max_len": ops.max_len = Number(value); break;
      case "min_bytes": ops.min_bytes = Number(value); break;
      case "max_bytes": ops.max_bytes = Number(value); break;
      case "prefix": ops.prefix = String(value); break;
      case "suffix": ops.suffix = String(value); break;
      case "contains": ops.contains = String(value); break;
      case "not_contains": ops.not_contains = String(value); break;
      case "in":
        if (Array.isArray(value)) ops.in = value.map(String);
        else if (value !== undefined) ops.in = [String(value)];
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(String);
        else if (value !== undefined) ops.not_in = [String(value)];
        break;
      case "ignore_empty": ops.ignore_empty = Boolean(value); break;
    }
  };

  if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) assign(k, v);
  } else {
    // Fallback to flattened option keys
    for (const [key, value] of Object.entries(options)) {
      if (!key.startsWith(prefix)) continue;
      const ruleName = key.slice(prefix.length);
      assign(ruleName, value);
    }
  }

  return Object.keys(ops).length > 0 ? ops : null;
}

function extractNumberRulesFromFlat(options: Record<string, any>, fieldType: string): NumberConstraintOps | null {
  const ops: NumberConstraintOps = {};
  const prefix = `(validate.rules).${fieldType}.`;

  const nestedRoot = options["(validate.rules)"];
  const nested = nestedRoot && (nestedRoot[fieldType] as any);
  // Support flattened object form: (validate.rules).int32 = { ... }
  const flatObj = options[`(validate.rules).${fieldType}`];
  const src: Record<string, any> | undefined = (nested && typeof nested === 'object') ? nested
    : (typeof flatObj === 'object' && flatObj) || undefined;

  const assign = (key: string, value: any) => {
    switch (key) {
      case "const": ops.const = Number(value); break;
      case "gt": ops.gt = Number(value); break;
      case "gte": ops.gte = Number(value); break;
      case "lt": ops.lt = Number(value); break;
      case "lte": ops.lte = Number(value); break;
      case "in":
        if (Array.isArray(value)) ops.in = value.map(Number);
        else if (value !== undefined) ops.in = [Number(value)];
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(Number);
        else if (value !== undefined) ops.not_in = [Number(value)];
        break;
      case "ignore_empty": ops.ignore_empty = Boolean(value); break;
    }
  };

  if (src) {
    for (const [k, v] of Object.entries(src)) assign(k, v);
  } else {
    for (const [key, value] of Object.entries(options)) {
      if (!key.startsWith(prefix)) continue;
      const ruleName = key.slice(prefix.length);
      assign(ruleName, value);
    }
  }

  return Object.keys(ops).length > 0 ? ops : null;
}

function extractRepeatedRulesFromFlat(options: Record<string, any>): RepeatedConstraintOps | null {
  const ops: RepeatedConstraintOps = {};
  const prefix = "(validate.rules).repeated.";

  const nestedRoot = options["(validate.rules)"];
  const nested = nestedRoot && (nestedRoot.repeated as any);
  // Support flattened object form: (validate.rules).repeated = { ... }
  const flatObj = options["(validate.rules).repeated"];
  const src: Record<string, any> | undefined = (nested && typeof nested === 'object') ? nested
    : (typeof flatObj === 'object' && flatObj) || undefined;

  const assign = (key: string, value: any) => {
    switch (key) {
      case "min_items": ops.min_items = Number(value); break;
      case "max_items": ops.max_items = Number(value); break;
      case "unique": ops.unique = Boolean(value); break;
      case "ignore_empty": ops.ignore_empty = Boolean(value); break;
    }
  };

  if (src) {
    for (const [k, v] of Object.entries(src)) assign(k, v);
  } else {
    for (const [key, value] of Object.entries(options)) {
      if (!key.startsWith(prefix)) continue;
      const ruleName = key.slice(prefix.length);
      assign(ruleName, value);
    }
  }

  return Object.keys(ops).length > 0 ? ops : null;
}

// ============ Protovalidate Validation Extraction ============

function extractProtovalidateStringRules(options: Record<string, any>): StringConstraintOps | null {
  const ops: StringConstraintOps = {};
  const prefix = "(buf.validate.field).string_val.";
  
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(prefix)) continue;
    foundAny = true;
    
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "min_len": ops.min_len = Number(value); break;
      case "max_len": ops.max_len = Number(value); break;
      case "min_bytes": ops.min_bytes = Number(value); break;
      case "max_bytes": ops.max_bytes = Number(value); break;
      case "pattern": ops.pattern = String(value); break;
      case "prefix": ops.prefix = String(value); break;
      case "suffix": ops.suffix = String(value); break;
      case "contains": ops.contains = String(value); break;
      case "not_contains": ops.not_contains = String(value); break;
      case "email": if (value === true) ops.email = true; break;
      case "hostname": if (value === true) ops.hostname = true; break;
      case "ipv4": if (value === true) ops.ipv4 = true; break;
      case "ipv6": if (value === true) ops.ipv6 = true; break;
      case "uri": if (value === true) ops.uri = true; break;
      case "uuid": if (value === true) ops.uuid = true; break;
      case "ip": ops.ipv4 = true; ops.ipv6 = true; break;
    }
  }

  return foundAny ? ops : null;
}

function extractProtovalidateNumberRules(options: Record<string, any>, fieldType: string): NumberConstraintOps | null {
  const ops: NumberConstraintOps = {};
  
  const typeKey = fieldType.includes('int') ? 'int_val'
    : fieldType.includes('float') || fieldType.includes('double') ? 'double_val'
    : fieldType.includes('uint') ? 'uint_val'
    : null;

  if (!typeKey) return null;

  const prefix = `(buf.validate.field).${typeKey}.`;
  let foundAny = false;

  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(prefix)) continue;
    foundAny = true;
    
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "const": ops.const = Number(value); break;
      case "lt": ops.lt = Number(value); break;
      case "lte": ops.lte = Number(value); break;
      case "gt": ops.gt = Number(value); break;
      case "gte": ops.gte = Number(value); break;
    }
  }

  return foundAny ? ops : null;
}

function extractProtovalidateRepeatedRules(options: Record<string, any>): RepeatedConstraintOps | null {
  const ops: RepeatedConstraintOps = {};
  const prefix = "(buf.validate.field).repeated_val.";
  
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(prefix)) continue;
    foundAny = true;
    
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "min_items": ops.min_items = Number(value); break;
      case "max_items": ops.max_items = Number(value); break;
      case "unique": ops.unique = Boolean(value); break;
    }
  }

  return foundAny ? ops : null;
}

function extractProtovalidateRequiredRule(options: Record<string, any>): PresenceConstraintOps | null {
  const key = "(buf.validate.field).message_val.required";
  if (options[key] === true) {
    return { required: true };
  }
  return null;
}

// ============ CEL Expression Support ============

function extractCelExpression(options: Record<string, any>): FieldConstraint | null {
  // Check for Protovalidate CEL: (buf.validate.field).cel
  const protovaldateCelPrefix = "(buf.validate.field).cel.";
  let celExpression: string | undefined;
  let celMessage: string | undefined;

  for (const [key, value] of Object.entries(options)) {
    if (key.startsWith(protovaldateCelPrefix)) {
      const ruleName = key.slice(protovaldateCelPrefix.length);
      if (ruleName === "expression") {
        celExpression = String(value);
      } else if (ruleName === "message") {
        celMessage = String(value);
      }
    }
  }

  if (celExpression) {
    return {
      kind: 'cel',
      ops: { expression: celExpression, message: celMessage },
      fieldPath: '',
      fieldType: '',
      source: 'protovalidate',
    };
  }

  return null;
}

// ============ Enum Validation Extraction ============

function extractEnumRules(options: Record<string, any>): EnumConstraintOps | null {
  const ops: EnumConstraintOps = {};
  const prefix = "(buf.validate.field).enum_val.";
  
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(prefix)) continue;
    foundAny = true;
    
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "defined_only": ops.definedOnly = Boolean(value); break;
      case "in":
        if (Array.isArray(value)) ops.in = value.map(Number);
        else if (value !== undefined) ops.in = [Number(value)];
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(Number);
        else if (value !== undefined) ops.not_in = [Number(value)];
        break;
    }
  }

  return foundAny ? ops : null;
}

export function extractFieldRules(field: protobuf.Field): FieldConstraint | null {
  if (!field.options) return null;

  const fieldPath = field.name;
  const fieldType = field.type;

  // Try Protovalidate validation first
  const protovalidateStringOps = extractProtovalidateStringRules(field.options);
  if (protovalidateStringOps) {
    return {
      kind: 'string',
      ops: protovalidateStringOps,
      fieldPath,
      fieldType,
      source: 'protovalidate',
    };
  }

  const numberTypes = ['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 
                       'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'];
  
  if (numberTypes.includes(fieldType)) {
    const protovalidateNumberOps = extractProtovalidateNumberRules(field.options, fieldType);
    if (protovalidateNumberOps) {
      return {
        kind: 'number',
        ops: protovalidateNumberOps,
        fieldPath,
        fieldType,
        source: 'protovalidate',
      };
    }
  }

  if (field.repeated) {
    const protovalidateRepeatedOps = extractProtovalidateRepeatedRules(field.options);
    if (protovalidateRepeatedOps) {
      return {
        kind: 'repeated',
        ops: protovalidateRepeatedOps,
        fieldPath,
        fieldType,
        source: 'protovalidate',
      };
    }
  }

  const protovalidateRequiredOps = extractProtovalidateRequiredRule(field.options);
  if (protovalidateRequiredOps) {
    return {
      kind: 'presence',
      ops: protovalidateRequiredOps,
      fieldPath,
      fieldType,
      source: 'protovalidate',
    };
  }

  // Fall back to PGV validation
  // 1) String rules directly on field (including flattened/nested forms)
  const strOps = extractStringRulesFromFlat(field.options);
  if (strOps) {
    return {
      kind: 'string',
      ops: strOps,
      fieldPath,
      fieldType,
      source: 'pgv',
    };
  }

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
    // 2) Element rules via repeated.items.* (if present)
    const repRoot = (field.options as any)["(validate.rules)"]?.repeated || (field.options as any)["(validate.rules).repeated"];
    const items = repRoot?.items;
    if (items && typeof items === 'object') {
      const strItem = items.string as Record<string, any> | undefined;
      const numItem = (items as any)[fieldType] as Record<string, any> | undefined;
      if (strItem && typeof strItem === 'object') {
        const ops: StringConstraintOps = {};
        for (const [k, v] of Object.entries(strItem)) {
          // Reuse the assign mapping from extractStringRulesFromFlat by mirroring keys
          switch (k) {
            case 'pattern': ops.pattern = String(v); break;
            case 'email': if (v === true) ops.email = true; break;
            case 'uuid': if (v === true) ops.uuid = true; break;
            case 'hostname': if (v === true) ops.hostname = true; break;
            case 'ipv4': if (v === true) ops.ipv4 = true; break;
            case 'ipv6': if (v === true) ops.ipv6 = true; break;
            case 'uri': if (v === true) ops.uri = true; break;
            case 'min_len': ops.min_len = Number(v); break;
            case 'max_len': ops.max_len = Number(v); break;
            case 'min_bytes': ops.min_bytes = Number(v); break;
            case 'max_bytes': ops.max_bytes = Number(v); break;
            case 'prefix': ops.prefix = String(v); break;
            case 'suffix': ops.suffix = String(v); break;
            case 'contains': ops.contains = String(v); break;
            case 'not_contains': ops.not_contains = String(v); break;
            case 'in': if (Array.isArray(v)) ops.in = v.map(String); break;
            case 'not_in': if (Array.isArray(v)) ops.not_in = v.map(String); break;
            case 'ignore_empty': ops.ignore_empty = Boolean(v); break;
          }
        }
        if (Object.keys(ops).length > 0) {
          return {
            kind: 'string',
            ops,
            fieldPath,
            fieldType,
            source: 'pgv',
          };
        }
      }
      if (numItem && typeof numItem === 'object') {
        const ops: NumberConstraintOps = {} as NumberConstraintOps;
        for (const [k, v] of Object.entries(numItem)) {
          switch (k) {
            case 'const': ops.const = Number(v); break;
            case 'gt': ops.gt = Number(v); break;
            case 'gte': ops.gte = Number(v); break;
            case 'lt': ops.lt = Number(v); break;
            case 'lte': ops.lte = Number(v); break;
            case 'in': if (Array.isArray(v)) ops.in = v.map(Number); break;
            case 'not_in': if (Array.isArray(v)) ops.not_in = v.map(Number); break;
            case 'ignore_empty': ops.ignore_empty = Boolean(v); break;
          }
        }
        if (Object.keys(ops).length > 0) {
          return {
            kind: 'number',
            ops,
            fieldPath,
            fieldType,
            source: 'pgv',
          };
        }
      }
    }

    // 3) Repeated container rules (min_items, max_items, unique)
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

  const msgRequired = (field.options as any)["(validate.rules).message.required"] === true
    || ((field.options as any)["(validate.rules)"] && (field.options as any)["(validate.rules)"].message && (field.options as any)["(validate.rules)"].message.required === true);
  if (msgRequired) {
    return {
      kind: 'presence',
      ops: { required: true },
      fieldPath,
      fieldType,
      source: 'pgv',
    };
  }

  const celConstraint = extractCelExpression(field.options);
  if (celConstraint) {
    return celConstraint;
  }

  const enumOps = extractEnumRules(field.options);
  if (enumOps) {
    return {
      kind: 'enum',
      ops: enumOps,
      fieldPath,
      fieldType,
      source: 'protovalidate',
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

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
import type { OneofConstraint } from "./types.js";
import type { ValidationSource } from "./types.js";

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
  const prefixes = ["(buf.validate.field).string.", "(buf.validate.field).string_val."]; // support legacy *_val

  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find(p => key.startsWith(p));
    if (!prefix) continue;
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

  const numericTypes = ['int32','int64','uint32','uint64','sint32','sint64','fixed32','fixed64','sfixed32','sfixed64','float','double'];
  const prefixes: string[] = [];
  if (numericTypes.includes(fieldType)) prefixes.push(`(buf.validate.field).${fieldType}.`);
  // legacy fallbacks
  if (fieldType.includes('int')) prefixes.push('(buf.validate.field).int_val.');
  if (fieldType.includes('uint')) prefixes.push('(buf.validate.field).uint_val.');
  if (fieldType.includes('float') || fieldType.includes('double')) prefixes.push('(buf.validate.field).double_val.');

  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find(p => key.startsWith(p));
    if (!prefix) continue;
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
  const prefixes = ["(buf.validate.field).repeated.", "(buf.validate.field).repeated_val."]; // support legacy

  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find(p => key.startsWith(p));
    if (!prefix) continue;
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
  const keys = ["(buf.validate.field).required", "(buf.validate.field).message_val.required"]; // support legacy
  for (const key of keys) {
    if (options[key] === true) return { required: true };
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
  const prefixes = ["(buf.validate.field).enum.", "(buf.validate.field).enum_val."]; // support legacy

  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find(p => key.startsWith(p));
    if (!prefix) continue;
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

export function extractFieldRules(field: protobuf.Field, source: ValidationSource = 'auto'): FieldConstraint | null {
  if (!field.options) return null;

  const fieldPath = field.name;
  const fieldType = field.type;

  // Determine allowed sources
  const allowProtovalidate = source === 'auto' || source === 'protovalidate';
  const allowPGV = source === 'auto' || source === 'pgv';

  // Try Protovalidate validation first (when allowed)
  const protovalidateStringOps = allowProtovalidate ? extractProtovalidateStringRules(field.options) : null;
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
  
  if (allowProtovalidate && numberTypes.includes(fieldType)) {
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

  if (allowProtovalidate && field.repeated) {
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

  const protovalidateRequiredOps = allowProtovalidate ? extractProtovalidateRequiredRule(field.options) : null;
  if (protovalidateRequiredOps) {
    return {
      kind: 'presence',
      ops: protovalidateRequiredOps,
      fieldPath,
      fieldType,
      source: 'protovalidate',
    };
  }

  // Fall back to PGV validation (when allowed)
  // 1) String rules directly on field (including flattened/nested forms)
  const strOps = allowPGV ? extractStringRulesFromFlat(field.options) : null;
  if (strOps) {
    return {
      kind: 'string',
      ops: strOps,
      fieldPath,
      fieldType,
      source: 'pgv',
    };
  }

  if (allowPGV && numberTypes.includes(fieldType)) {
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

  if (allowPGV && field.repeated) {
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

  const msgRequired = allowPGV && ((field.options as any)["(validate.rules).message.required"] === true
    || ((field.options as any)["(validate.rules)"] && (field.options as any)["(validate.rules)"].message && (field.options as any)["(validate.rules)"].message.required === true));
  if (msgRequired) {
    return {
      kind: 'presence',
      ops: { required: true },
      fieldPath,
      fieldType,
      source: 'pgv',
    };
  }

  const celConstraint = allowProtovalidate ? extractCelExpression(field.options) : null;
  if (celConstraint) {
    return celConstraint;
  }

  const enumOps = allowProtovalidate ? extractEnumRules(field.options) : null;
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

export function extractMessageRules(messageType: protobuf.Type, source: ValidationSource = 'auto'): ValidationIR {
  const typeName = messageType.fullName?.replace(/^\./, "") || messageType.name;
  const fields = new Map<string, FieldConstraint>();
  const oneofs: OneofConstraint[] = [];
  const messageLevel: { cel?: { expression: string; message?: string }[]; skip?: boolean; source?: 'pgv' | 'protovalidate' } = {};

  for (const field of messageType.fieldsArray) {
    const constraint = extractFieldRules(field, source);
    if (constraint) {
      fields.set(field.name, constraint);
    }
  }

  // Message-level rules (Buf Protovalidate)
  if (messageType.options && typeof messageType.options === 'object') {
    const opts = messageType.options as Record<string, any>;
    // (buf.validate.message).cel.{expression,message}
    const celExprKey = '(buf.validate.message).cel.expression';
    const celMsgKey = '(buf.validate.message).cel.message';
    let celExpr: string | undefined;
    let celMsg: string | undefined;
    if (typeof opts[celExprKey] !== 'undefined') celExpr = String(opts[celExprKey]);
    if (typeof opts[celMsgKey] !== 'undefined') celMsg = String(opts[celMsgKey]);
    if (celExpr) {
      messageLevel.cel = [{ expression: celExpr, message: celMsg }];
      messageLevel.source = 'protovalidate';
    }
    // Best-effort support for a potential skip/disabled flag if present
    const skipKey = '(buf.validate.message).skip';
    if (opts[skipKey] === true) {
      messageLevel.skip = true;
      messageLevel.source = 'protovalidate';
    }
  }

  // Oneof groups: enforce proto semantics (at most one set) and required if annotated
  if (messageType.oneofs) {
    for (const [groupName, group] of Object.entries(messageType.oneofs)) {
      const oneofFields: string[] = (group as any).oneof || [];

      // Skip synthetic oneofs created for proto3 optional (single member with proto3_optional)
      const isSynthetic = (() => {
        if (oneofFields.length !== 1) return false;
        const f = messageType.fields[oneofFields[0]];
        const opt = (f && f.options) || {} as any;
        return Boolean(opt && opt.proto3_optional);
      })();
      if (isSynthetic) continue;

      // Detect required annotation from PGV / Protovalidate if present
      const opts = ((group as any).options || {}) as Record<string, any>;
      let required = false;
      let source: 'pgv' | 'protovalidate' | 'proto' = 'proto';
      if (opts["(validate.required)"] === true) {
        required = true;
        source = 'pgv';
      }
      // Best-effort support for protovalidate oneof annotations if available
      if (opts["(buf.validate.oneof).required"] === true) {
        required = true;
        source = 'protovalidate';
      }

      oneofs.push({ name: groupName, fields: oneofFields.slice(), required, source });
    }
  }

  return {
    typeName,
    fields,
    oneofs: oneofs.length > 0 ? oneofs : undefined,
    message: (messageLevel.cel || messageLevel.skip) ? messageLevel : undefined,
  };
}

export function extractAllRules(
  messages: Map<string, protobuf.Type>,
  source: ValidationSource = 'auto',
): Map<string, ValidationIR> {
  const irMap = new Map<string, ValidationIR>();

  for (const [typeName, messageType] of messages) {
    const ir = extractMessageRules(messageType, source);
    if (
      ir.fields.size > 0 ||
      (ir.oneofs && ir.oneofs.length > 0) ||
      (ir.message?.cel && ir.message.cel.length > 0)
    ) {
      irMap.set(typeName, ir);
    }
  }

  return irMap;
}

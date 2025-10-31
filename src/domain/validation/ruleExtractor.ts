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
import type {
  BytesConstraintOps,
  MapConstraintOps,
  TimestampConstraintOps,
  DurationConstraintOps,
  AnyConstraintOps,
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

// ============ Additional Protovalidate Field Extractors ============

function extractProtovalidateBytesRules(options: Record<string, any>): BytesConstraintOps | null {
  const ops: BytesConstraintOps = {};
  const prefixes = ["(buf.validate.field).bytes.", "(buf.validate.field).bytes_val."]; // support legacy

  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    foundAny = true;
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "const": ops.const = String(value); break;
      case "len": ops.len = Number(value); break;
      case "min_len": ops.min_len = Number(value); break;
      case "max_len": ops.max_len = Number(value); break;
      case "pattern": ops.pattern = String(value); break;
      case "prefix": ops.prefix = String(value); break;
      case "suffix": ops.suffix = String(value); break;
      case "contains": ops.contains = String(value); break;
      case "in":
        if (Array.isArray(value)) ops.in = value.map(String);
        else if (value !== undefined) ops.in = [String(value)];
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(String);
        else if (value !== undefined) ops.not_in = [String(value)];
        break;
      case "ip": if (value === true) ops.ip = true; break;
      case "ipv4": if (value === true) ops.ipv4 = true; break;
      case "ipv6": if (value === true) ops.ipv6 = true; break;
    }
  }
  return foundAny ? ops : null;
}

// Generic helpers to parse nested rules at custom bases
function extractProtovalidateStringRulesWithBase(options: Record<string, any>, basePrefixes: string[]): StringConstraintOps | null {
  const ops: StringConstraintOps = {};
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = basePrefixes.find((p) => key.startsWith(p));
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

function extractProtovalidateNumberRulesWithBase(options: Record<string, any>, fieldType: string, basePrefixes: string[]): NumberConstraintOps | null {
  const ops: NumberConstraintOps = {};
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = basePrefixes.find((p) => key.startsWith(p));
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

function extractEnumRulesWithBase(options: Record<string, any>, basePrefixes: string[]): EnumConstraintOps | null {
  const ops: EnumConstraintOps = {};
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = basePrefixes.find((p) => key.startsWith(p));
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

function extractProtovalidateBytesRulesWithBase(options: Record<string, any>, basePrefixes: string[]): BytesConstraintOps | null {
  const ops: BytesConstraintOps = {};
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = basePrefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    foundAny = true;
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "const": ops.const = String(value); break;
      case "len": ops.len = Number(value); break;
      case "min_len": ops.min_len = Number(value); break;
      case "max_len": ops.max_len = Number(value); break;
      case "pattern": ops.pattern = String(value); break;
      case "prefix": ops.prefix = String(value); break;
      case "suffix": ops.suffix = String(value); break;
      case "contains": ops.contains = String(value); break;
      case "in":
        if (Array.isArray(value)) ops.in = value.map(String);
        else if (value !== undefined) ops.in = [String(value)];
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(String);
        else if (value !== undefined) ops.not_in = [String(value)];
        break;
      case "ip": if (value === true) ops.ip = true; break;
      case "ipv4": if (value === true) ops.ipv4 = true; break;
      case "ipv6": if (value === true) ops.ipv6 = true; break;
    }
  }
  return foundAny ? ops : null;
}

function extractProtovalidateTimestampRulesWithBase(options: Record<string, any>, basePrefixes: string[]): TimestampConstraintOps | null {
  const ops: TimestampConstraintOps = {};
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = basePrefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    foundAny = true;
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "const": ops.const = value as any; break;
      case "lt": ops.lt = value as any; break;
      case "lte": ops.lte = value as any; break;
      case "gt": ops.gt = value as any; break;
      case "gte": ops.gte = value as any; break;
      case "lt_now": ops.lt_now = Boolean(value); break;
      case "gt_now": ops.gt_now = Boolean(value); break;
      case "within": ops.within = value as any; break;
    }
  }
  return foundAny ? ops : null;
}

function extractProtovalidateDurationRulesWithBase(options: Record<string, any>, basePrefixes: string[]): DurationConstraintOps | null {
  const ops: DurationConstraintOps = {};
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = basePrefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    foundAny = true;
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "const": ops.const = value as any; break;
      case "lt": ops.lt = value as any; break;
      case "lte": ops.lte = value as any; break;
      case "gt": ops.gt = value as any; break;
      case "gte": ops.gte = value as any; break;
      case "within": ops.within = value as any; break;
    }
  }
  return foundAny ? ops : null;
}

function extractProtovalidateAnyRulesWithBase(options: Record<string, any>, basePrefixes: string[]): AnyConstraintOps | null {
  const ops: AnyConstraintOps = {};
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = basePrefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    foundAny = true;
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "in":
        if (Array.isArray(value)) ops.in = value.map(String);
        else if (value !== undefined) ops.in = [String(value)];
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(String);
        else if (value !== undefined) ops.not_in = [String(value)];
        break;
    }
  }
  return foundAny ? ops : null;
}

function extractProtovalidateMapRules(options: Record<string, any>, field: protobuf.Field): MapConstraintOps | null {
  const ops: MapConstraintOps = {};
  const prefixes = ["(buf.validate.field).map.", "(buf.validate.field).map_val."]; // support legacy
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    foundAny = true;
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "min_pairs": ops.min_pairs = Number(value); break;
      case "max_pairs": ops.max_pairs = Number(value); break;
    }
  }

  // Nested key/value rules
  const keyPrefixes = ["(buf.validate.field).map.keys.", "(buf.validate.field).map_val.keys."];
  const valPrefixes = ["(buf.validate.field).map.values.", "(buf.validate.field).map_val.values."];

  const keyType = (field as any).keyType as string | undefined;
  const valType = field.type as string;
  const resolved = (field as any).resolvedType as any;

  // Keys (only string/numeric are valid key types in protobuf)
  if (keyType === 'string') {
    const kOps = extractProtovalidateStringRulesWithBase(options, keyPrefixes.map(p => p + 'string.'));
    if (kOps) {
      ops.keys = { kind: 'string', ops: kOps };
      foundAny = true;
    }
  } else if (typeof keyType === 'string') {
    const numPrefixes: string[] = keyPrefixes.map(p => p + keyType + '.');
    const kOps = extractProtovalidateNumberRulesWithBase(options, keyType, numPrefixes);
    if (kOps) {
      ops.keys = { kind: 'number', ops: kOps };
      foundAny = true;
    }
  }

  // Values (can be scalar, enum, or certain WKTs)
  if (valType === 'string') {
    const vOps = extractProtovalidateStringRulesWithBase(options, valPrefixes.map(p => p + 'string.'));
    if (vOps) { ops.values = { kind: 'string', ops: vOps }; foundAny = true; }
  } else if (valType === 'bytes') {
    const vOps = extractProtovalidateBytesRulesWithBase(options, valPrefixes.map(p => p + 'bytes.'));
    if (vOps) { ops.values = { kind: 'bytes', ops: vOps }; foundAny = true; }
  } else if ([
    'int32','int64','uint32','uint64','sint32','sint64','fixed32','fixed64','sfixed32','sfixed64','float','double'
  ].includes(valType)) {
    const vOps = extractProtovalidateNumberRulesWithBase(options, valType, valPrefixes.map(p => p + valType + '.'));
    if (vOps) { ops.values = { kind: 'number', ops: vOps }; foundAny = true; }
  } else if (valType === 'google.protobuf.Timestamp' || valType.endsWith('.Timestamp')) {
    const vOps = extractProtovalidateTimestampRulesWithBase(options, valPrefixes.map(p => p + 'timestamp.'));
    if (vOps) { ops.values = { kind: 'timestamp', ops: vOps }; foundAny = true; }
  } else if (valType === 'google.protobuf.Duration' || valType.endsWith('.Duration')) {
    const vOps = extractProtovalidateDurationRulesWithBase(options, valPrefixes.map(p => p + 'duration.'));
    if (vOps) { ops.values = { kind: 'duration', ops: vOps }; foundAny = true; }
  } else if (valType === 'google.protobuf.Any' || valType.endsWith('.Any')) {
    const vOps = extractProtovalidateAnyRulesWithBase(options, valPrefixes.map(p => p + 'any.'));
    if (vOps) { ops.values = { kind: 'any', ops: vOps }; foundAny = true; }
  } else if (resolved && resolved instanceof protobuf.Enum) {
    const vOps = extractEnumRulesWithBase(options, valPrefixes.map(p => p + 'enum.'));
    if (vOps) { ops.values = { kind: 'enum', ops: vOps }; foundAny = true; }
  }

  return foundAny ? ops : null;
}

function extractProtovalidateTimestampRules(options: Record<string, any>): TimestampConstraintOps | null {
  const ops: TimestampConstraintOps = {};
  const prefixes = ["(buf.validate.field).timestamp.", "(buf.validate.field).timestamp_val."]; // support legacy
  let foundAny = false;
  
  // Helper to reconstruct Duration messages from flattened keys
  const reconstructDuration = (baseKey: string): {seconds?: number, nanos?: number} | null => {
    const secs = options[baseKey + '.seconds'];
    const nanos = options[baseKey + '.nanos'];
    if (secs !== undefined || nanos !== undefined) {
      const dur: any = {};
      if (secs !== undefined) dur.seconds = Number(secs);
      if (nanos !== undefined) dur.nanos = Number(nanos);
      return dur;
    }
    return null;
  };
  
  // Helper to reconstruct Timestamp messages from flattened keys
  const reconstructTimestamp = (baseKey: string): {seconds?: number, nanos?: number} | null => {
    const secs = options[baseKey + '.seconds'];
    const nanos = options[baseKey + '.nanos'];
    if (secs !== undefined || nanos !== undefined) {
      const ts: any = {};
      if (secs !== undefined) ts.seconds = Number(secs);
      if (nanos !== undefined) ts.nanos = Number(nanos);
      return ts;
    }
    return null;
  };
  
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    
    const ruleName = key.slice(prefix.length);
    const dotPos = ruleName.indexOf('.');
    const baseRule = dotPos > 0 ? ruleName.slice(0, dotPos) : ruleName;
    
    switch (baseRule) {
      case "const":
        if (!ops.const) {
          ops.const = reconstructTimestamp(prefix + 'const') || value as any;
          foundAny = true;
        }
        break;
      case "lt":
        if (!ops.lt) {
          ops.lt = reconstructTimestamp(prefix + 'lt') || value as any;
          foundAny = true;
        }
        break;
      case "lte":
        if (!ops.lte) {
          ops.lte = reconstructTimestamp(prefix + 'lte') || value as any;
          foundAny = true;
        }
        break;
      case "gt":
        if (!ops.gt) {
          ops.gt = reconstructTimestamp(prefix + 'gt') || value as any;
          foundAny = true;
        }
        break;
      case "gte":
        if (!ops.gte) {
          ops.gte = reconstructTimestamp(prefix + 'gte') || value as any;
          foundAny = true;
        }
        break;
      case "lt_now":
        ops.lt_now = Boolean(value);
        foundAny = true;
        break;
      case "gt_now":
        ops.gt_now = Boolean(value);
        foundAny = true;
        break;
      case "within":
        if (!ops.within) {
          ops.within = reconstructDuration(prefix + 'within') || value as any;
          foundAny = true;
        }
        break;
    }
  }
  return foundAny ? ops : null;
}

function extractProtovalidateDurationRules(options: Record<string, any>): DurationConstraintOps | null {
  const ops: DurationConstraintOps = {};
  const prefixes = ["(buf.validate.field).duration.", "(buf.validate.field).duration_val."]; // support legacy
  let foundAny = false;
  
  // Helper to reconstruct Duration messages from flattened keys
  const reconstructDuration = (baseKey: string): {seconds?: number, nanos?: number} | null => {
    const secs = options[baseKey + '.seconds'];
    const nanos = options[baseKey + '.nanos'];
    if (secs !== undefined || nanos !== undefined) {
      const dur: any = {};
      if (secs !== undefined) dur.seconds = Number(secs);
      if (nanos !== undefined) dur.nanos = Number(nanos);
      return dur;
    }
    return null;
  };
  
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    
    const ruleName = key.slice(prefix.length);
    const dotPos = ruleName.indexOf('.');
    const baseRule = dotPos > 0 ? ruleName.slice(0, dotPos) : ruleName;
    
    switch (baseRule) {
      case "const":
        if (!ops.const) {
          ops.const = reconstructDuration(prefix + 'const') || value as any;
          foundAny = true;
        }
        break;
      case "lt":
        if (!ops.lt) {
          ops.lt = reconstructDuration(prefix + 'lt') || value as any;
          foundAny = true;
        }
        break;
      case "lte":
        if (!ops.lte) {
          ops.lte = reconstructDuration(prefix + 'lte') || value as any;
          foundAny = true;
        }
        break;
      case "gt":
        if (!ops.gt) {
          ops.gt = reconstructDuration(prefix + 'gt') || value as any;
          foundAny = true;
        }
        break;
      case "gte":
        if (!ops.gte) {
          ops.gte = reconstructDuration(prefix + 'gte') || value as any;
          foundAny = true;
        }
        break;
      case "within":
        if (!ops.within) {
          ops.within = reconstructDuration(prefix + 'within') || value as any;
          foundAny = true;
        }
        break;
    }
  }
  return foundAny ? ops : null;
}

function extractProtovalidateAnyRules(options: Record<string, any>): AnyConstraintOps | null {
  const ops: AnyConstraintOps = {};
  const prefixes = ["(buf.validate.field).any.", "(buf.validate.field).any_val."]; // support legacy
  let foundAny = false;
  for (const [key, value] of Object.entries(options)) {
    const prefix = prefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    foundAny = true;
    const ruleName = key.slice(prefix.length);
    switch (ruleName) {
      case "in":
        if (Array.isArray(value)) ops.in = value.map(String);
        else if (value !== undefined) ops.in = [String(value)];
        break;
      case "not_in":
        if (Array.isArray(value)) ops.not_in = value.map(String);
        else if (value !== undefined) ops.not_in = [String(value)];
        break;
    }
  }
  return foundAny ? ops : null;
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

  // Protovalidate: bytes
  if (allowProtovalidate && fieldType === 'bytes') {
    const bytesOps = extractProtovalidateBytesRules(field.options);
    if (bytesOps) {
      return {
        kind: 'bytes',
        ops: bytesOps,
        fieldPath,
        fieldType,
        source: 'protovalidate',
      };
    }
  }

  // Protovalidate: map<K,V>
  if (allowProtovalidate && (field as any).map) {
    const mapOps = extractProtovalidateMapRules(field.options, field);
    if (mapOps) {
      return {
        kind: 'map',
        ops: mapOps,
        fieldPath,
        fieldType,
        source: 'protovalidate',
      };
    }
  }

  // Protovalidate: Timestamp / Duration / Any
  if (allowProtovalidate) {
    if (fieldType === 'google.protobuf.Timestamp' || fieldType.endsWith('.Timestamp')) {
      const tsOps = extractProtovalidateTimestampRules(field.options);
      if (tsOps) {
        return {
          kind: 'timestamp',
          ops: tsOps,
          fieldPath,
          fieldType,
          source: 'protovalidate',
        };
      }
    } else if (fieldType === 'google.protobuf.Duration' || fieldType.endsWith('.Duration')) {
      const durOps = extractProtovalidateDurationRules(field.options);
      if (durOps) {
        return {
          kind: 'duration',
          ops: durOps,
          fieldPath,
          fieldType,
          source: 'protovalidate',
        };
      }
    } else if (fieldType === 'google.protobuf.Any' || fieldType.endsWith('.Any')) {
      const anyOps = extractProtovalidateAnyRules(field.options);
      if (anyOps) {
        return {
          kind: 'any',
          ops: anyOps,
          fieldPath,
          fieldType,
          source: 'protovalidate',
        };
      }
    }
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

    // (buf.validate.message).oneof — baseline parsing for flattened keys
    // Note: protobufjs flattens repeated options and we often only see the last value.
    // We support the common case where a single oneof rule is present.
    const oneofFieldsKey = '(buf.validate.message).oneof.fields';
    const oneofReqKey = '(buf.validate.message).oneof.required';
    if (typeof opts[oneofFieldsKey] !== 'undefined') {
      const raw = opts[oneofFieldsKey];
      const required = Boolean(opts[oneofReqKey]);
      let fields: string[] | undefined;
      if (Array.isArray(raw)) fields = raw.map(String);
      else if (typeof raw === 'string') fields = [raw];
      else if (raw && typeof raw === 'object' && Array.isArray((raw as any).fields)) fields = (raw as any).fields.map(String);
      if (fields && fields.length > 0) {
        oneofs.push({ name: 'message_oneof_1', fields, required, source: 'protovalidate' });
      }
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

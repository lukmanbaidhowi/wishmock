import type {
  ValidationIR,
  FieldConstraint,
  FieldViolation,
  ValidationResult,
  StringConstraintOps,
  NumberConstraintOps,
  RepeatedConstraintOps,
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

const regexCache = new Map<string, RegExp>();

function getOrCompileRegex(pattern: string, flags?: string): RegExp {
  const key = `${pattern}:${flags || ""}`;
  let regex = regexCache.get(key);
  if (!regex) {
    regex = new RegExp(pattern, flags);
    regexCache.set(key, regex);
  }
  return regex;
}

// Simple CEL expression evaluator
function evaluateCelExpression(expression: string, context: Record<string, any>): boolean {
  try {
    // Basic evaluator: expose fields as identifiers and allow `this.*` via binding.
    // Use `with` to scope lookups to the context object.
    const fn = new Function('ctx', `with (ctx) { return (${expression}); }`);
    return Boolean(fn.call(context, context));
  } catch (error) {
    return false;
  }
}

function validateString(
  value: unknown,
  ops: StringConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];

  if (value === undefined || value === null) {
    if (!ops.ignore_empty) return violations;
    return violations;
  }

  const str = String(value);
  
  if (ops.ignore_empty && str.length === 0) return violations;

  if (ops.min_len !== undefined && str.length < ops.min_len) {
    violations.push({
      field: fieldPath,
      description: `string length must be at least ${ops.min_len} characters`,
      rule: "min_len",
      value: str.length,
    });
  }

  if (ops.max_len !== undefined && str.length > ops.max_len) {
    violations.push({
      field: fieldPath,
      description: `string length must be at most ${ops.max_len} characters`,
      rule: "max_len",
      value: str.length,
    });
  }

  const byteLength = Buffer.byteLength(str, "utf8");
  if (ops.min_bytes !== undefined && byteLength < ops.min_bytes) {
    violations.push({
      field: fieldPath,
      description: `string byte length must be at least ${ops.min_bytes} bytes`,
      rule: "min_bytes",
      value: byteLength,
    });
  }

  if (ops.max_bytes !== undefined && byteLength > ops.max_bytes) {
    violations.push({
      field: fieldPath,
      description: `string byte length must be at most ${ops.max_bytes} bytes`,
      rule: "max_bytes",
      value: byteLength,
    });
  }

  if (ops.pattern !== undefined) {
    const regex = getOrCompileRegex(ops.pattern, ops.patternFlags);
    if (!regex.test(str)) {
      violations.push({
        field: fieldPath,
        description: `string must match pattern: ${ops.pattern}`,
        rule: "pattern",
        value: str,
      });
    }
  }

  if (ops.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(str)) {
      violations.push({
        field: fieldPath,
        description: "must be a valid email address",
        rule: "email",
        value: str,
      });
    }
  }

  if (ops.uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(str)) {
      violations.push({
        field: fieldPath,
        description: "must be a valid UUID",
        rule: "uuid",
        value: str,
      });
    }
  }

  if (ops.hostname) {
    const hostnameRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
    if (!hostnameRegex.test(str)) {
      violations.push({
        field: fieldPath,
        description: "must be a valid hostname",
        rule: "hostname",
        value: str,
      });
    }
  }

  if (ops.ipv4) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(str) || !str.split('.').every(n => parseInt(n) <= 255)) {
      violations.push({
        field: fieldPath,
        description: "must be a valid IPv4 address",
        rule: "ipv4",
        value: str,
      });
    }
  }

  if (ops.ipv6) {
    const ipv6Regex = /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i;
    if (!ipv6Regex.test(str)) {
      violations.push({
        field: fieldPath,
        description: "must be a valid IPv6 address",
        rule: "ipv6",
        value: str,
      });
    }
  }

  if (ops.uri) {
    try {
      new URL(str);
    } catch {
      violations.push({
        field: fieldPath,
        description: "must be a valid URI",
        rule: "uri",
        value: str,
      });
    }
  }

  if (ops.prefix !== undefined && !str.startsWith(ops.prefix)) {
    violations.push({
      field: fieldPath,
      description: `string must start with: ${ops.prefix}`,
      rule: "prefix",
      value: str,
    });
  }

  if (ops.suffix !== undefined && !str.endsWith(ops.suffix)) {
    violations.push({
      field: fieldPath,
      description: `string must end with: ${ops.suffix}`,
      rule: "suffix",
      value: str,
    });
  }

  if (ops.contains !== undefined && !str.includes(ops.contains)) {
    violations.push({
      field: fieldPath,
      description: `string must contain: ${ops.contains}`,
      rule: "contains",
      value: str,
    });
  }

  if (ops.not_contains !== undefined && str.includes(ops.not_contains)) {
    violations.push({
      field: fieldPath,
      description: `string must not contain: ${ops.not_contains}`,
      rule: "not_contains",
      value: str,
    });
  }

  if (ops.in && ops.in.length > 0 && !ops.in.includes(str)) {
    violations.push({
      field: fieldPath,
      description: `string must be one of: ${ops.in.join(", ")}`,
      rule: "in",
      value: str,
    });
  }

  if (ops.not_in && ops.not_in.length > 0 && ops.not_in.includes(str)) {
    violations.push({
      field: fieldPath,
      description: `string must not be one of: ${ops.not_in.join(", ")}`,
      rule: "not_in",
      value: str,
    });
  }

  return violations;
}

function validateNumber(
  value: unknown,
  ops: NumberConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];

  if (value === undefined || value === null) {
    if (!ops.ignore_empty) return violations;
    return violations;
  }

  const num = Number(value);
  
  if (isNaN(num)) {
    violations.push({
      field: fieldPath,
      description: "value must be a valid number",
      rule: "type",
      value,
    });
    return violations;
  }

  if (ops.ignore_empty && num === 0) return violations;

  if (ops.const !== undefined && num !== ops.const) {
    violations.push({
      field: fieldPath,
      description: `number must equal ${ops.const}`,
      rule: "const",
      value: num,
    });
  }

  if (ops.gt !== undefined && !(num > ops.gt)) {
    violations.push({
      field: fieldPath,
      description: `number must be greater than ${ops.gt}`,
      rule: "gt",
      value: num,
    });
  }

  if (ops.gte !== undefined && !(num >= ops.gte)) {
    violations.push({
      field: fieldPath,
      description: `number must be greater than or equal to ${ops.gte}`,
      rule: "gte",
      value: num,
    });
  }

  if (ops.lt !== undefined && !(num < ops.lt)) {
    violations.push({
      field: fieldPath,
      description: `number must be less than ${ops.lt}`,
      rule: "lt",
      value: num,
    });
  }

  if (ops.lte !== undefined && !(num <= ops.lte)) {
    violations.push({
      field: fieldPath,
      description: `number must be less than or equal to ${ops.lte}`,
      rule: "lte",
      value: num,
    });
  }

  if (ops.in && ops.in.length > 0 && !ops.in.includes(num)) {
    violations.push({
      field: fieldPath,
      description: `number must be one of: ${ops.in.join(", ")}`,
      rule: "in",
      value: num,
    });
  }

  if (ops.not_in && ops.not_in.length > 0 && ops.not_in.includes(num)) {
    violations.push({
      field: fieldPath,
      description: `number must not be one of: ${ops.not_in.join(", ")}`,
      rule: "not_in",
      value: num,
    });
  }

  return violations;
}

function validateRepeated(
  value: unknown,
  ops: RepeatedConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];

  // If the field is absent, skip repeated validations (treat as empty)
  if (value === undefined || value === null) {
    return violations;
  }

  if (!Array.isArray(value)) {
    violations.push({
      field: fieldPath,
      description: "value must be an array",
      rule: "type",
      value,
    });
    return violations;
  }

  if (ops.ignore_empty && value.length === 0) return violations;

  if (ops.min_items !== undefined && value.length < ops.min_items) {
    violations.push({
      field: fieldPath,
      description: `array must have at least ${ops.min_items} items`,
      rule: "min_items",
      value: value.length,
    });
  }

  if (ops.max_items !== undefined && value.length > ops.max_items) {
    violations.push({
      field: fieldPath,
      description: `array must have at most ${ops.max_items} items`,
      rule: "max_items",
      value: value.length,
    });
  }

  if (ops.unique) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const item of value) {
      const key = JSON.stringify(item);
      if (seen.has(key)) {
        duplicates.add(key);
      }
      seen.add(key);
    }
    if (duplicates.size > 0) {
      violations.push({
        field: fieldPath,
        description: "array items must be unique",
        rule: "unique",
        value: Array.from(duplicates),
      });
    }
  }

  return violations;
}

function validatePresence(
  value: unknown,
  ops: PresenceConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];

  if (ops.required && (value === undefined || value === null)) {
    violations.push({
      field: fieldPath,
      description: "field is required",
      rule: "required",
    });
  }

  return violations;
}

function validateCel(
  expression: string,
  message: any,
  celMessage?: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  
  const result = evaluateCelExpression(expression, message);
  if (!result) {
    violations.push({
      field: "",
      description: celMessage || `failed CEL validation: ${expression}`,
      rule: "cel",
    });
  }

  return violations;
}

function validateEnum(
  value: unknown,
  ops: EnumConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];

  if (value === undefined || value === null) {
    return violations;
  }

  const enumValue = Number(value);

  if (ops.definedOnly && !Number.isInteger(enumValue)) {
    violations.push({
      field: fieldPath,
      description: "enum value must be defined",
      rule: "defined_only",
      value,
    });
  }

  if (ops.in && ops.in.length > 0 && !ops.in.includes(enumValue)) {
    violations.push({
      field: fieldPath,
      description: `enum value must be one of: ${ops.in.join(", ")}`,
      rule: "in",
      value: enumValue,
    });
  }

  if (ops.not_in && ops.not_in.length > 0 && ops.not_in.includes(enumValue)) {
    violations.push({
      field: fieldPath,
      description: `enum value must not be one of: ${ops.not_in.join(", ")}`,
      rule: "not_in",
      value: enumValue,
    });
  }

  return violations;
}

function toBuffer(value: unknown): Buffer | null {
  if (value === undefined || value === null) return null;
  if (Buffer.isBuffer(value)) return value as Buffer;
  if (typeof value === 'string') {
    try {
      // Try base64 first; fallback to utf8
      const b64 = Buffer.from(value, 'base64');
      // Heuristic: if base64 decoding re-encodes to same, assume base64
      if (b64.length > 0 && b64.toString('base64') === value.replace(/\s+/g, '')) return b64;
    } catch {}
    return Buffer.from(value, 'utf8');
  }
  return null;
}

function bufferEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return a.compare(b) === 0;
}

function validateBytes(
  value: unknown,
  ops: BytesConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  if (value === undefined || value === null) return violations;
  const buf = toBuffer(value);
  if (!buf) {
    violations.push({ field: fieldPath, description: 'value must be bytes or base64 string', rule: 'type', value });
    return violations;
  }

  const len = buf.length;
  if (ops.len !== undefined && len !== ops.len) {
    violations.push({ field: fieldPath, description: `bytes length must be exactly ${ops.len}`, rule: 'len', value: len });
  }
  if (ops.min_len !== undefined && len < ops.min_len) {
    violations.push({ field: fieldPath, description: `bytes length must be at least ${ops.min_len}`, rule: 'min_len', value: len });
  }
  if (ops.max_len !== undefined && len > ops.max_len) {
    violations.push({ field: fieldPath, description: `bytes length must be at most ${ops.max_len}`, rule: 'max_len', value: len });
  }

  if (ops.const !== undefined) {
    const expected = toBuffer(ops.const);
    if (expected && !bufferEquals(buf, expected)) {
      violations.push({ field: fieldPath, description: 'bytes must equal const', rule: 'const' });
    }
  }

  const asString = buf.toString('utf8');
  if (ops.pattern) {
    const re = getOrCompileRegex(ops.pattern);
    if (!re.test(asString)) {
      violations.push({ field: fieldPath, description: `bytes must match pattern: ${ops.pattern}`, rule: 'pattern', value: asString });
    }
  }
  if (ops.prefix && !asString.startsWith(ops.prefix)) {
    violations.push({ field: fieldPath, description: `bytes must start with prefix: ${ops.prefix}`, rule: 'prefix', value: asString });
  }
  if (ops.suffix && !asString.endsWith(ops.suffix)) {
    violations.push({ field: fieldPath, description: `bytes must end with suffix: ${ops.suffix}`, rule: 'suffix', value: asString });
  }
  if (ops.contains && !asString.includes(ops.contains)) {
    violations.push({ field: fieldPath, description: `bytes must contain: ${ops.contains}`, rule: 'contains', value: asString });
  }
  if (ops.in && ops.in.length > 0) {
    const matches = ops.in.some((v) => {
      const eb = toBuffer(v);
      return eb ? bufferEquals(buf, eb) : false;
    });
    if (!matches) {
      violations.push({ field: fieldPath, description: 'bytes must be one of allowed values', rule: 'in' });
    }
  }
  if (ops.not_in && ops.not_in.length > 0) {
    const listed = ops.not_in.some((v) => {
      const eb = toBuffer(v);
      return eb ? bufferEquals(buf, eb) : false;
    });
    if (listed) {
      violations.push({ field: fieldPath, description: 'bytes must not be a disallowed value', rule: 'not_in' });
    }
  }
  if (ops.ip || ops.ipv4 || ops.ipv6) {
    const isIPv4 = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(asString);
    const isIPv6 = /^[0-9a-f:]+$/i.test(asString) && asString.includes(':');
    if (ops.ip && !(isIPv4 || isIPv6)) violations.push({ field: fieldPath, description: 'must be a valid IP address', rule: 'ip', value: asString });
    if (ops.ipv4 && !isIPv4) violations.push({ field: fieldPath, description: 'must be a valid IPv4 address', rule: 'ipv4', value: asString });
    if (ops.ipv6 && !isIPv6) violations.push({ field: fieldPath, description: 'must be a valid IPv6 address', rule: 'ipv6', value: asString });
  }

  return violations;
}

function validateMap(
  value: unknown,
  ops: MapConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  if (value === undefined || value === null) return violations;
  if (typeof value !== 'object' || Array.isArray(value)) {
    violations.push({ field: fieldPath, description: 'value must be an object/map', rule: 'type', value });
    return violations;
  }
  const size = Object.keys(value as any).length;
  if (ops.min_pairs !== undefined && size < ops.min_pairs) {
    violations.push({ field: fieldPath, description: `map must have at least ${ops.min_pairs} pairs`, rule: 'min_pairs', value: size });
  }
  if (ops.max_pairs !== undefined && size > ops.max_pairs) {
    violations.push({ field: fieldPath, description: `map must have at most ${ops.max_pairs} pairs`, rule: 'max_pairs', value: size });
  }
  // Nested key/value validation
  const obj = value as Record<string, unknown>;
  if (ops.keys) {
    const { kind, ops: kops } = ops.keys as any;
    for (const k of Object.keys(obj)) {
      if (kind === 'string') {
        violations.push(...validateString(k, kops as StringConstraintOps, `${fieldPath}{${k}}`));
      } else if (kind === 'number') {
        const num = Number(k);
        violations.push(...validateNumber(num, kops as NumberConstraintOps, `${fieldPath}{${k}}`));
      }
    }
  }
  if (ops.values) {
    const { kind, ops: vops } = ops.values as any;
    for (const [k, v] of Object.entries(obj)) {
      const path = `${fieldPath}.${k}`;
      switch (kind) {
        case 'string': violations.push(...validateString(v, vops as StringConstraintOps, path)); break;
        case 'number': violations.push(...validateNumber(v, vops as NumberConstraintOps, path)); break;
        case 'bytes': violations.push(...validateBytes(v, vops as BytesConstraintOps, path)); break;
        case 'enum': violations.push(...validateEnum(v, vops as EnumConstraintOps, path)); break;
        case 'timestamp': violations.push(...validateTimestamp(v, vops as TimestampConstraintOps, path)); break;
        case 'duration': violations.push(...validateDuration(v, vops as DurationConstraintOps, path)); break;
        case 'any': violations.push(...validateAny(v, vops as AnyConstraintOps, path)); break;
        default: break;
      }
    }
  }
  return violations;
}

function parseDurationToMillis(input: string | number | undefined): number | null {
  if (input === undefined) return null;
  if (typeof input === 'number') return input;
  const s = String(input).trim();
  const re = /^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)$/i;
  const m = s.match(re);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const factor: Record<string, number> = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60000, h: 3600000 };
  return Math.round(num * (factor[unit] ?? 0));
}

function timestampToMillis(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  if (typeof v === 'object' && ('seconds' in v || 'nanos' in v)) {
    const sec = Number((v as any).seconds || 0);
    const nanos = Number((v as any).nanos || 0);
    return Math.round(sec * 1000 + nanos / 1e6);
  }
  return null;
}

function validateTimestamp(
  value: unknown,
  ops: TimestampConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  if (value === undefined || value === null) return violations;
  const ts = timestampToMillis(value);
  if (ts === null) {
    violations.push({ field: fieldPath, description: 'invalid timestamp value', rule: 'type', value });
    return violations;
  }
  const now = Date.now();
  const toMs = (v: any) => timestampToMillis(v);

  if (ops.const !== undefined) {
    const expected = toMs(ops.const);
    if (expected !== null && ts !== expected) violations.push({ field: fieldPath, description: 'timestamp must equal const', rule: 'const' });
  }
  if (ops.lt !== undefined) {
    const lim = toMs(ops.lt);
    if (lim !== null && !(ts < lim)) violations.push({ field: fieldPath, description: `timestamp must be less than ${lim}`, rule: 'lt', value: ts });
  }
  if (ops.lte !== undefined) {
    const lim = toMs(ops.lte);
    if (lim !== null && !(ts <= lim)) violations.push({ field: fieldPath, description: `timestamp must be <= ${lim}`, rule: 'lte', value: ts });
  }
  if (ops.gt !== undefined) {
    const lim = toMs(ops.gt);
    if (lim !== null && !(ts > lim)) violations.push({ field: fieldPath, description: `timestamp must be greater than ${lim}`, rule: 'gt', value: ts });
  }
  if (ops.gte !== undefined) {
    const lim = toMs(ops.gte);
    if (lim !== null && !(ts >= lim)) violations.push({ field: fieldPath, description: `timestamp must be >= ${lim}`, rule: 'gte', value: ts });
  }
  if (ops.lt_now && !(ts < now)) {
    violations.push({ field: fieldPath, description: 'timestamp must be in the past', rule: 'lt_now', value: ts });
  }
  if (ops.gt_now && !(ts > now)) {
    violations.push({ field: fieldPath, description: 'timestamp must be in the future', rule: 'gt_now', value: ts });
  }
  if (ops.within) {
    const dur = parseDurationToMillis(ops.within);
    if (dur !== null) {
      const delta = Math.abs(now - ts);
      if (delta > dur) violations.push({ field: fieldPath, description: `timestamp must be within ${ops.within} of now`, rule: 'within', value: delta });
    }
  }
  return violations;
}

function durationToMillis(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseDurationToMillis(v);
  if (typeof v === 'object' && ('seconds' in v || 'nanos' in v)) {
    const sec = Number((v as any).seconds || 0);
    const nanos = Number((v as any).nanos || 0);
    return Math.round(sec * 1000 + nanos / 1e6);
  }
  return null;
}

function validateDuration(
  value: unknown,
  ops: DurationConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  if (value === undefined || value === null) return violations;
  const d = durationToMillis(value);
  if (d === null) {
    violations.push({ field: fieldPath, description: 'invalid duration value', rule: 'type', value });
    return violations;
  }
  const toMs = (v: any) => durationToMillis(v);
  if (ops.const !== undefined) {
    const expected = toMs(ops.const);
    if (expected !== null && d !== expected) violations.push({ field: fieldPath, description: 'duration must equal const', rule: 'const' });
  }
  if (ops.lt !== undefined) {
    const lim = toMs(ops.lt);
    if (lim !== null && !(d < lim)) violations.push({ field: fieldPath, description: `duration must be < ${lim}ms`, rule: 'lt', value: d });
  }
  if (ops.lte !== undefined) {
    const lim = toMs(ops.lte);
    if (lim !== null && !(d <= lim)) violations.push({ field: fieldPath, description: `duration must be <= ${lim}ms`, rule: 'lte', value: d });
  }
  if (ops.gt !== undefined) {
    const lim = toMs(ops.gt);
    if (lim !== null && !(d > lim)) violations.push({ field: fieldPath, description: `duration must be > ${lim}ms`, rule: 'gt', value: d });
  }
  if (ops.gte !== undefined) {
    const lim = toMs(ops.gte);
    if (lim !== null && !(d >= lim)) violations.push({ field: fieldPath, description: `duration must be >= ${lim}ms`, rule: 'gte', value: d });
  }
  if (ops.within) {
    const lim = parseDurationToMillis(ops.within);
    if (lim !== null && d > lim) violations.push({ field: fieldPath, description: `duration must be within ${ops.within}`, rule: 'within', value: d });
  }
  return violations;
}

function validateAny(
  value: unknown,
  ops: AnyConstraintOps,
  fieldPath: string
): FieldViolation[] {
  const violations: FieldViolation[] = [];
  if (value === undefined || value === null) return violations;
  if (typeof value !== 'object' || value === null || !('type_url' in (value as any))) {
    violations.push({ field: fieldPath, description: 'invalid Any value', rule: 'type', value });
    return violations;
  }
  const typeUrl = String((value as any).type_url || '');
  if (ops.in && ops.in.length > 0 && !ops.in.includes(typeUrl)) {
    violations.push({ field: fieldPath, description: `type_url must be one of: ${ops.in.join(', ')}`, rule: 'in', value: typeUrl });
  }
  if (ops.not_in && ops.not_in.length > 0 && ops.not_in.includes(typeUrl)) {
    violations.push({ field: fieldPath, description: `type_url must not be one of: ${ops.not_in.join(', ')}`, rule: 'not_in', value: typeUrl });
  }
  return violations;
}

function validateField(
  message: any,
  constraint: FieldConstraint
): FieldViolation[] {
  // Prefer the fieldPath as stored (protobufjs often uses camelCase for names),
  // then try a snake_case variant to match proto-loader keepCase=true objects.
  const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  let value = message[constraint.fieldPath];
  if (value === undefined) {
    const snake = toSnake(constraint.fieldPath);
    value = message[snake];
  }

  switch (constraint.kind) {
    case "string":
      if (Array.isArray(value)) {
        const ops = constraint.ops as StringConstraintOps;
        const all: FieldViolation[] = [];
        value.forEach((elem, idx) => {
          all.push(...validateString(elem, ops, `${constraint.fieldPath}[${idx}]`));
        });
        return all;
      }
      return validateString(value, constraint.ops as StringConstraintOps, constraint.fieldPath);
    case "number":
      if (Array.isArray(value)) {
        const ops = constraint.ops as NumberConstraintOps;
        const all: FieldViolation[] = [];
        value.forEach((elem, idx) => {
          all.push(...validateNumber(elem, ops, `${constraint.fieldPath}[${idx}]`));
        });
        return all;
      }
      return validateNumber(value, constraint.ops as NumberConstraintOps, constraint.fieldPath);
    case "repeated":
      return validateRepeated(value, constraint.ops as RepeatedConstraintOps, constraint.fieldPath);
    case "presence":
      return validatePresence(value, constraint.ops as PresenceConstraintOps, constraint.fieldPath);
    case "cel":
      const celOps = constraint.ops as any;
      return validateCel(celOps.expression, message, celOps.message);
    case "enum":
      const enumOps = constraint.ops as EnumConstraintOps;
      return validateEnum(value, enumOps, constraint.fieldPath);
    case "bytes":
      const bytesOps = constraint.ops as BytesConstraintOps;
      if (Array.isArray(value)) {
        const all: FieldViolation[] = [];
        value.forEach((elem, idx) => {
          all.push(...validateBytes(elem, bytesOps, `${constraint.fieldPath}[${idx}]`));
        });
        return all;
      }
      return validateBytes(value, bytesOps, constraint.fieldPath);
    case "map":
      const mapOps = constraint.ops as MapConstraintOps;
      return validateMap(value, mapOps, constraint.fieldPath);
    case "timestamp":
      const tsOps = constraint.ops as TimestampConstraintOps;
      return validateTimestamp(value, tsOps, constraint.fieldPath);
    case "duration":
      const durOps = constraint.ops as DurationConstraintOps;
      return validateDuration(value, durOps, constraint.fieldPath);
    case "any":
      const anyOps = constraint.ops as AnyConstraintOps;
      return validateAny(value, anyOps, constraint.fieldPath);
    default:
      return [];
  }
}

export function validate(ir: ValidationIR, message: unknown, opts?: { enforceMessageCel?: boolean }): ValidationResult {
  if (!message || typeof message !== "object") {
    return {
      ok: false,
      violations: [
        {
          field: "",
          description: "message must be an object",
          rule: "type",
        },
      ],
    };
  }

  const violations: FieldViolation[] = [];

  for (const [fieldName, constraint] of ir.fields) {
    const fieldViolations = validateField(message, constraint);
    violations.push(...fieldViolations);
  }

  // Message-level CEL (basic)
  if (opts?.enforceMessageCel && ir.message?.cel && ir.message.cel.length > 0) {
    for (const celRule of ir.message.cel) {
      const v = validateCel(celRule.expression, message as any, celRule.message);
      if (v.length) violations.push(...v);
    }
  }

  // Oneof group validation (proto semantics + optional required annotation)
  if (ir.oneofs && ir.oneofs.length > 0) {
    const obj = message as any;
    const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const hasField = (o: any, name: string) => {
      if (name in o) return o[name] !== undefined && o[name] !== null;
      const snake = toSnake(name);
      if (snake in o) return o[snake] !== undefined && o[snake] !== null;
      return false;
    };

    for (const grp of ir.oneofs) {
      const present: string[] = [];
      for (const f of grp.fields) {
        if (hasField(obj, f)) present.push(f);
      }
      if (present.length > 1) {
        violations.push({
          field: "",
          description: `oneof group "${grp.name}" has multiple fields set: ${present.join(", ")}`,
          rule: "oneof_multiple",
        });
      } else if ((grp.required === true) && present.length === 0) {
        violations.push({
          field: "",
          description: `oneof group "${grp.name}" must have exactly one field set`,
          rule: "oneof_required",
        });
      }
    }
  }

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  return { ok: true };
}

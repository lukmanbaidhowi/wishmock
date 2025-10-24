import type {
  ValidationIR,
  FieldConstraint,
  FieldViolation,
  ValidationResult,
  StringConstraintOps,
  NumberConstraintOps,
  RepeatedConstraintOps,
  PresenceConstraintOps,
} from "./types.js";

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

  if (!Array.isArray(value)) {
    if (ops.ignore_empty && (value === undefined || value === null)) return violations;
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

function validateField(
  message: any,
  constraint: FieldConstraint
): FieldViolation[] {
  const value = message[constraint.fieldPath];

  switch (constraint.kind) {
    case "string":
      return validateString(value, constraint.ops as StringConstraintOps, constraint.fieldPath);
    case "number":
      return validateNumber(value, constraint.ops as NumberConstraintOps, constraint.fieldPath);
    case "repeated":
      return validateRepeated(value, constraint.ops as RepeatedConstraintOps, constraint.fieldPath);
    case "presence":
      return validatePresence(value, constraint.ops as PresenceConstraintOps, constraint.fieldPath);
    default:
      return [];
  }
}

export function validate(ir: ValidationIR, message: unknown): ValidationResult {
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

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  return { ok: true };
}


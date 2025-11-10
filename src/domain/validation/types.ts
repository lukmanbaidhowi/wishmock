export type ValidationSource = 'auto' | 'pgv' | 'protovalidate';
export type ValidationMode = 'per_message' | 'aggregate';

export interface StringConstraintOps {
  pattern?: string;
  patternFlags?: string;
  email?: boolean;
  uuid?: boolean;
  hostname?: boolean;
  ipv4?: boolean;
  ipv6?: boolean;
  uri?: boolean;
  min_len?: number;
  max_len?: number;
  min_bytes?: number;
  max_bytes?: number;
  prefix?: string;
  suffix?: string;
  contains?: string;
  not_contains?: string;
  in?: string[];
  not_in?: string[];
  ignore_empty?: boolean;
}

export interface NumberConstraintOps {
  const?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: number[];
  not_in?: number[];
  ignore_empty?: boolean;
}

export interface RepeatedConstraintOps {
  min_items?: number;
  max_items?: number;
  unique?: boolean;
  ignore_empty?: boolean;
}

export interface PresenceConstraintOps {
  required?: boolean;
}

export interface BoolConstraintOps {
  const?: boolean;
}

export interface CelConstraintOps {
  expression: string;
  message?: string;
}

export interface EnumConstraintOps {
  definedOnly?: boolean;
  in?: number[];
  not_in?: number[];
}

// Protovalidate Bytes constraints
export interface BytesConstraintOps {
  const?: string; // expected bytes literal (UTF-8 string or base64)
  len?: number;
  min_len?: number;
  max_len?: number;
  pattern?: string; // applied to UTF-8 string representation
  prefix?: string;  // UTF-8 string prefix
  suffix?: string;  // UTF-8 string suffix
  contains?: string; // UTF-8 substring
  in?: string[];
  not_in?: string[];
  ip?: boolean;
  ipv4?: boolean;
  ipv6?: boolean;
}

// Protovalidate Map constraints (pair count; nested keys/values not modeled yet)
export interface NestedConstraint {
  kind: ConstraintKind;
  ops: ConstraintOps;
}

export interface MapConstraintOps {
  min_pairs?: number;
  max_pairs?: number;
  keys?: NestedConstraint;
  values?: NestedConstraint;
}

// Protovalidate Timestamp constraints
export interface TimestampConstraintOps {
  const?: string | number; // RFC3339 string or epoch millis
  lt?: string | number;
  lte?: string | number;
  gt?: string | number;
  gte?: string | number;
  lt_now?: boolean;
  gt_now?: boolean;
  within?: string; // duration like 5s, 2m, 1h
}

// Protovalidate Duration constraints
export interface DurationConstraintOps {
  const?: string | number; // duration string or millis
  lt?: string | number;
  lte?: string | number;
  gt?: string | number;
  gte?: string | number;
  within?: string; // duration string
}

// Protovalidate Any constraints
export interface AnyConstraintOps {
  in?: string[]; // allowed type_url values
  not_in?: string[]; // disallowed type_url values
}

export type ConstraintOps =
  | StringConstraintOps
  | NumberConstraintOps
  | RepeatedConstraintOps
  | PresenceConstraintOps
  | BoolConstraintOps
  | CelConstraintOps
  | EnumConstraintOps
  | BytesConstraintOps
  | MapConstraintOps
  | TimestampConstraintOps
  | DurationConstraintOps
  | AnyConstraintOps;

export type ConstraintKind =
  | 'string'
  | 'number'
  | 'repeated'
  | 'presence'
  | 'bool'
  | 'cel'
  | 'enum'
  | 'bytes'
  | 'map'
  | 'timestamp'
  | 'duration'
  | 'any';

export interface FieldConstraint {
  kind: ConstraintKind;
  ops: ConstraintOps;
  fieldPath: string;
  fieldType: string;
  source: 'pgv' | 'protovalidate';
}

export interface ValidationIR {
  typeName: string;
  fields: Map<string, FieldConstraint>;
  oneofs?: OneofConstraint[];
  message?: {
    // Parsed from (buf.validate.message).cel; enforcement gated elsewhere
    cel?: CelConstraintOps[];
    // Reserved for potential upstream support; not enforced here
    skip?: boolean;
    source?: 'pgv' | 'protovalidate';
  };
}

export interface FieldViolation {
  field: string;
  description: string;
  rule: string;
  value?: unknown;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; violations: FieldViolation[] };

export interface ValidatorFunction {
  (message: unknown): ValidationResult;
}

export interface ValidationConfig {
  enabled: boolean;
  source: ValidationSource;
  mode: ValidationMode;
}

export interface OneofConstraint {
  name: string;
  fields: string[];
  required?: boolean;
  source?: 'pgv' | 'protovalidate' | 'proto';
}

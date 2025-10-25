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

export type ConstraintOps =
  | StringConstraintOps
  | NumberConstraintOps
  | RepeatedConstraintOps
  | PresenceConstraintOps
  | BoolConstraintOps
  | CelConstraintOps
  | EnumConstraintOps;

export type ConstraintKind = 'string' | 'number' | 'repeated' | 'presence' | 'bool' | 'cel' | 'enum';

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

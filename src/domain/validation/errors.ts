import * as grpc from "@grpc/grpc-js";
import type { FieldViolation } from "./types.js";

export function makeInvalidArgError(violations: FieldViolation[]) {
  // Minimal V1: return INVALID_ARGUMENT with JSON summary in message.
  // Future: pack google.rpc.BadRequest FieldViolation details into grpc-status-details-bin.
  const summary = {
    reason: 'validation_failed',
    field_violations: violations.map(v => ({
      field: v.field,
      description: v.description,
      rule: v.rule,
    })),
  };
  const err: any = {
    code: grpc.status.INVALID_ARGUMENT,
    message: JSON.stringify(summary),
  };
  return err;
}


# Oneof Validation

This document explains how oneof constraints are validated and what to expect when testing via gRPC tools and clients.

## Summary

- Proto semantics (at‑most‑one): Protobuf decoding preserves only the last oneof field sent (last‑wins). In practice, a server will see 0 or 1 field set for any oneof group.
- Required oneof (exactly one): When annotated as required, the server enforces that exactly one member of the group is set; empty is rejected with INVALID_ARGUMENT.
- Multiple set: Although the engine includes a defensive check for “multiple set”, standard Protobuf marshalling/decoding prevents this from appearing at runtime: the last member wins and earlier ones are overwritten.

## What We Enforce

- At‑most‑one (proto): Enforced by Protobuf semantics; the validator includes a check for completeness but it won’t be triggered by normal gRPC traffic.
- Exactly‑one (required): Enforced by the validator using PGV oneof annotation `(validate.required) = true`. Requests with zero members set are rejected.

### Protovalidate message‑level oneof (baseline)

- The official annotation `(buf.validate.message).oneof = { fields: [..], required: bool }` is parsed in a baseline form.
- Due to protobufjs option flattening, only a single rule and the last field value may be visible at runtime. We therefore:
  - Support a single message‑level oneof rule when present.
  - Extract the visible `fields` value; if a single string is exposed by the loader, it becomes a single‑field group (semantically equivalent to a required presence check when `required=true`).
- This limitation is documented; PGV oneof on actual proto `oneof` groups remains the recommended approach for multi‑field groups until descriptor‑based parsing is integrated.

## Error Format

On validation failure, the server returns gRPC `InvalidArgument` with a JSON body:

```
{
  "reason": "validation_failed",
  "field_violations": [
    { "field": "", "description": "oneof group \"contact_req\" must have exactly one field set", "rule": "oneof_required" }
  ]
}
```

When a “multiple set” is detected (e.g., in unit tests or non‑Protobuf input):

```
{ "field": "", "description": "oneof group \"contact\" has multiple fields set: email, phone", "rule": "oneof_multiple" }
```

## Annotations

- PGV: `extend google.protobuf.OneofOptions { optional bool required = 1071; }`
  - Usage in .proto: `oneof contact_req { option (validate.required) = true; string email_req = 3; string phone_req = 4; }`
- Protovalidate (baseline): `option (buf.validate.message).oneof = { fields: ["a", "b"], required: true }` — parsed with the loader’s flattened view; see notes above.

## Example

`protos/helloworld.proto` includes:

```
message OneofValidationRequest {
  // Non‑required oneof (proto semantics only)
  oneof contact {
    string email = 1;
    string phone = 2;
  }

  // Required oneof (exactly one)
  oneof contact_req {
    option (validate.required) = true;
    string email_req = 3;
    string phone_req = 4;
  }
}

service Greeter {
  rpc ValidateOneof (OneofValidationRequest) returns (HelloReply);
}
```

Rule example: `rules/grpc/helloworld.greeter.validateoneof.yaml`

```
responses:
  - body:
      message: "ok"
```

## Testing Notes

- grpcurl and standard Protobuf clients use last‑wins encoding: if two oneof fields are present in JSON/objects, only the last is actually sent/decoded. As a result, E2E tests cannot reproduce a “multiple set” failure.
- Required oneof is fully testable E2E: sending a payload without any member of the required group triggers `oneof_required`.
- A helper script is available: `scripts/test-validation-oneof.sh`.

## Streaming

- Validation runs per message by default (`VALIDATION_MODE=per_message`). Required oneof constraints apply to each incoming message the same way they do for unary requests.

## FAQs

- Why keep an engine check for “multiple set” if Protobuf prevents it?
  - It’s a defensive guard that keeps behavior explicit and covers non‑Protobuf entry points or internal uses of the validator.
- How do I make a oneof required?
  - Use PGV’s oneof `required` option on the group in your .proto, as shown above.

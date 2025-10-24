# Wishmock Rule Examples

This page collects example rules you can reuse when building Wishmock responses. Each example mirrors the patterns used in the rule files under `rules/grpc/` and the snippets previously embedded in the README.

## Basic Hello Rule

The simplest rule matches on a field and returns a templated response:

```yaml
match:
  request:
    name: "Tom"
responses:
  - when:
      request.name: "Tom"
    body:
      message: "Hi {{request.name}} (from mock)"
    trailers:
      grpc-status: "0"
    delay_ms: 0
    priority: 10
  - body:
      message: "Hello, stranger"
    trailers:
      grpc-status: "0"
    priority: 0
```

## Metadata and Priority Example

Use metadata and numeric comparisons to route between multiple responses:

```yaml
match:
  metadata:
    authorization: { regex: "^Bearer \\w+", flags: "i" }
  request:
    user.age: { gte: 18 }
responses:
  - when:
      metadata.role: { in: [admin, root] }
    body: { allow: true }
    trailers:
      grpc-status: "0"
    priority: 10
  - body: { allow: false }
    trailers:
      grpc-status: "0"
    priority: 0
```

## Error Simulation Examples

The file `rules/grpc/calendar.events.getevent.yaml` demonstrates a range of gRPC errors keyed by `request.id` values:

- UNAUTHENTICATED: `request.id = "err-unauth"`
- PERMISSION_DENIED: `request.id = "err-forbidden"`
- NOT_FOUND: `request.id = "err-notfound"`
- ALREADY_EXISTS: `request.id = "err-already-exists"`
- FAILED_PRECONDITION: `request.id = "err-precondition"`
- OUT_OF_RANGE: `request.id = "err-out-of-range"`
- CANCELLED: `request.id = "err-cancelled"`
- DEADLINE_EXCEEDED (with delay): `request.id = "err-deadline"`
- UNAVAILABLE (with retry hint): `request.id = "err-unavailable"`
- INTERNAL: `request.id = "err-internal"`
- DATA_LOSS: `request.id = "err-data-loss"`
- UNIMPLEMENTED: `request.id = "err-unimplemented"`
- RESOURCE_EXHAUSTED (rate limit): `request.id = "err-resource-exhausted"`
- UNKNOWN: `request.id = "err-unknown"`

```

## Response Body Templating

Use `{{...}}` expressions in response bodies to inject request fields, metadata, and utility values. See the README for the full syntax; below are concise, copy‑pasteable examples.

### Unary templated response

```yaml
match:
  request:
    name: { exists: true }
responses:
  - when:
      request.name: { regex: "^template", flags: "i" }
    body:
      message: "Hello {{request.name}}! Now: {{utils.now()}}"
      timestamp: "{{utils.now()}}"
      request_echo:
        name: "{{request.name}}"
        user_agent: "{{metadata.user-agent}}"
        trace_id: "{{metadata.x-trace-id}}"
        random: "{{utils.random(1, 9999)}}"
    trailers:
      grpc-status: "0"
  - body:
      message: "Hello, stranger"
    trailers:
      grpc-status: "0"
```



### Streaming templated response

```yaml
match:
  request:
    user_id: "templ_stream"
responses:
  - when:
      request.user_id: "templ_stream"
    stream_items:
      - id: "msg_{{stream.index}}"
        content: "{{request.user_id}}: #{{stream.index + 1}} of {{stream.total}}"
        ts: "{{utils.now()}}"
        first: "{{stream.isFirst}}"
        last: "{{stream.isLast}}"
        uuid: "{{utils.uuid()}}"
    stream_delay_ms: 500
    trailers:
      grpc-status: "0"
```

Tip: `match` and `when` are evaluated statically (no templating) for deterministic routing; `body` and `stream_items` are fully templatable.

## Tips

- Name rule files using `package.service.method.yaml`, for example `helloworld.greeter.sayhello.yaml`.
- Keep at least one fallback response (`when` omitted) to guarantee a reply when no condition matches.
- Use the templating features described in `README.md` to customize response bodies without duplicating rules.

## See Also

- [PGV Validation Documentation](./pgv-validation.md)
- [Buf Validation Documentation](./buf-validation.md)

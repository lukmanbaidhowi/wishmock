# wishmock

This project is a simple gRPC mock server built with Bun 1.x (tested with 1.2.20), `@grpc/grpc-js`, and `protobufjs`.  
It allows you to load `.proto` files directly (no conversion needed) and define mock rules in YAML/JSON.  
Supports hot reload for both proto files and rules.

## Features
- **Proto Loading** - Load `.proto` files directly using protobufjs
- **Hot Reload** - Proto files (soft restart) and rules (no restart needed)
- **Request Matching** - Match request fields & metadata for conditional responses
- **YAML/JSON Rules** - Define responses in YAML/JSON rules
- **Advanced Operators** - Regex, contains, in, exists, numeric matching
- **Priority Selection** - Highest numeric `priority` wins (default 0; order as tiebreaker)
- **TLS/mTLS Support** - Secure connections with client certificate validation
- **Server Streaming** - Stream multiple responses with configurable delays
- **Infinite Loop Streaming** - Continuous streaming with random order support
- **Server Reflection** - grpcurl auto-discovery on plaintext and TLS ports

## Project Structure
```
wishmock/
├─ protos/                 # put your proto files here
│  └─ helloworld.proto
├─ rules/                  # put your rule files here
│  └─ helloworld.greeter.sayhello.yaml
├─ src/
│  ├─ app.ts               # app bootstrap (watchers + admin HTTP)
│  ├─ domain/
│  │  ├─ types.ts
│  │  └─ usecases/selectResponse.ts
│  ├─ infrastructure/
│  │  ├─ protoLoader.ts
│  │  ├─ ruleLoader.ts
│  │  └─ grpcServer.ts
│  └─ interfaces/httpAdmin.ts
├─ dist/                   # compiled JS output
├─ package.json
├─ tsconfig.json
```

## Usage (Bun 1.x)
1) Install dependencies
```bash
bun install
```

2) Start (auto-builds via prestart)
```bash
bun run start
```

The `prestart` script runs `build`, which now also bundles the frontend TypeScript (`frontend/app.ts`) into `frontend/dist/app.js`.

3) Develop with watch
```bash
# tsc watch + run dist with watcher
bun run start:develop

# OR run TS directly (no tsc) with Bun watcher
  bun run start:develop:ts
```

Optional (frontend watch in another terminal):
```bash
bun run dev:frontend
```

- gRPC servers:
  - Plaintext: `localhost:50050` (always on)
  - TLS: `localhost:50051` (if enabled)
- Admin HTTP server: `localhost:3000`

Note: Requires Bun >= 1.0. The provided Dockerfile uses `oven/bun:1.2.20-alpine`.

### Enable TLS locally with .env
You can enable TLS for the local Bun run by providing certificate paths via environment variables. Place them in a dotenv file (for example `.env.tls`) and load it with Bun.

1) Generate local certs (once):
```bash
bash scripts/generate-web-auth-cert.sh
```

2) Create `.env.tls` (example):
```dotenv
GRPC_PORT_PLAINTEXT=50050
GRPC_PORT_TLS=50051
GRPC_TLS_ENABLED=true
GRPC_TLS_CERT_PATH=certs/server.crt
GRPC_TLS_KEY_PATH=certs/server.key
GRPC_TLS_CA_PATH=certs/ca.crt
GRPC_TLS_REQUIRE_CLIENT_CERT=false
```

3) Start the server with the env file:
```bash
# Important: pass --env-file before "run"
bun --env-file= .env.tls run start
```

4) Verify TLS is active:
- Logs include: `gRPC (TLS) listening on 50051`
- `curl http://localhost:3000/admin/status` shows `grpc_ports.tls_enabled: true` and `grpc_ports.tls: 50051`

## Usage (Node / npx)
If you prefer Node, you can run the server with Node or npx.

1) Run directly via npx (after publish)
```bash
npx wishmock
# or if published under a scope/name variant:
# npx @your-scope/wishmock
```

2) Local Node run (without Bun)
```bash
npm i   # or: pnpm i / yarn
npm run start:node
```

3) Develop with watch (two terminals)
```bash
# Terminal A (TypeScript compile in watch mode)
npm run build:watch

# Terminal B (Node >= 20 for --watch)
npm run start:node:watch
```

- gRPC servers:
  - Plaintext: `localhost:50050`
  - TLS: `localhost:50051` (if enabled)
- Admin HTTP server: `localhost:3000`

## Quick Test
```bash
grpcurl -import-path protos -proto helloworld.proto -plaintext -d '{"name":"Tom"}' localhost:50050 helloworld.Greeter/SayHello
```

## Hot Reload
- Change/add `.proto` in `protos/` → server auto rebuilds and restarts
- Change/add rules in `rules/` → rules reload immediately (no restart)
- Upload proto/rules via Admin API

### Admin UI (Web)
- Open `http://localhost:3000/app/` to:
  - Upload `.proto` and rule files (YAML/JSON) via Admin API
  - View status: gRPC ports, loaded services, and loaded rules (stubs)
- The UI is served statically from `frontend/`. The source is TypeScript (`frontend/app.ts`) bundled to `frontend/dist/app.js`.

### Docker
Default (with TLS enabled):
```bash
# Generate certs first
bash scripts/generate-web-auth-cert.sh

# Start with TLS enabled
docker compose up --build
```

- Exposes: gRPC plaintext on `50050`, gRPC TLS on `50051`, Admin HTTP on `3000`.
- TLS is enabled by default in docker-compose.yml with certificates from `./certs/`.

Healthcheck:
- The container includes a healthcheck that hits `http://localhost:3000/liveness` inside the container.
- View health: `docker ps` (look for `healthy`), or `docker inspect --format='{{json .State.Health}}' wishmock | jq .`

To disable TLS, comment out the TLS environment variables and port mapping in `docker-compose.yml`:
```bash
# Comment out in docker-compose.yml:
# - "50051:50051"   # gRPC TLS
# - GRPC_TLS_ENABLED=true
# - GRPC_TLS_CERT_PATH=/app/certs/server.crt
# - GRPC_TLS_KEY_PATH=/app/certs/server.key
# - GRPC_TLS_CA_PATH=/app/certs/ca.crt
```

grpcurl with TLS/mTLS (Docker TLS enabled by default):
```bash
# TLS (server-auth only) — uses server cert signed by local CA
grpcurl -import-path protos -proto helloworld.proto -d '{"name":"Tom"}' \
  -cacert certs/ca.crt \
  localhost:50051 helloworld.Greeter/SayHello

# mTLS (client-auth) — set GRPC_TLS_REQUIRE_CLIENT_CERT=true in docker-compose.yml
# and restart the stack; then call with client cert/key
grpcurl -import-path protos -proto helloworld.proto -d '{"name":"Tom"}' \
  -cacert certs/ca.crt \
  -cert certs/client.crt \
  -key certs/client.key \
  localhost:50051 helloworld.Greeter/SayHello
```

### Error Simulation Examples
- The file `rules/calendar.events.getevent.yaml:1` includes realistic error cases keyed by `request.id` values. Examples:
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

Quick tests with grpcurl (plaintext):
```bash
grpcurl -import-path protos -proto calendar.proto -plaintext -d '{"id":"err-unauth"}' localhost:50050 calendar.Events/GetEvent
grpcurl -import-path protos -proto calendar.proto -plaintext -d '{"id":"err-forbidden"}' localhost:50050 calendar.Events/GetEvent
grpcurl -import-path protos -proto calendar.proto -plaintext -d '{"id":"err-unavailable"}' localhost:50050 calendar.Events/GetEvent
grpcurl -import-path protos -proto calendar.proto -plaintext -d '{"id":"err-deadline"}' localhost:50050 calendar.Events/GetEvent
```

Note: On Bun, file watching uses polling for stability.

## Server Reflection

The server exposes gRPC Server Reflection on both plaintext and TLS ports for tools like grpcurl to auto-discover services and message types.

- How it works:
  - The server wraps `@grpc/grpc-js` with `grpc-node-server-reflection` and unions descriptor files harvested from `@grpc/proto-loader` across all registered services.
  - It preserves original `.proto` file names and canonicalizes common vendor imports (google/*) so dependency names match what grpcurl expects.
  - When `.proto` files omit dependency lists, the server infers them from field type references and from service method input/output types to make the descriptor set dependency‑closed.
  - If some dependencies are still unresolved, it safely falls back to returning the full descriptor pool so grpcurl can continue working.

- Quick usage (no `-proto` flag required):
  - List services: `grpcurl -plaintext localhost:50050 list`
  - Describe service/method: `grpcurl -plaintext localhost:50050 describe helloworld.Greeter`
  - TLS reflection: `grpcurl -cacert certs/ca.crt localhost:50051 list`

- Import paths in your `.proto` files:
  - Place your files under `protos/` and import using include‑root paths, e.g. `import "imports/common.proto";`.
  - Avoid path traversal imports like `"../common.proto"` — `@grpc/proto-loader` resolves using include directories, not the importing file's directory.
  - Use the provided third‑party fetch script for common vendor protos: `bun run protos:fetch` (adds `protos/google/...`, `protos/validate/...`, etc.).

- Debugging reflection:
  - Set `DEBUG_REFLECTION=1` to log descriptor names, dependencies, and resolution details.
  - Check `GET /admin/status` for `loaded_services` and `protos.loaded`/`protos.skipped`.

- Fallback to explicit protos (when desired):
  - You can always call with explicit proto flags instead of reflection:
    `grpcurl -import-path protos -proto helloworld.proto -plaintext ...`

Run the example tests:
- With reflection (default): `bun run test:readme-examples`
- With explicit `-proto` imports: `bun run test:readme-examples:import-proto`

## TLS / mTLS

Enable TLS by providing certificate paths (and optionally a CA) via environment variables. When enabled, the server listens on both plaintext and TLS ports.

Environment variables:
- `GRPC_PORT_PLAINTEXT` (default `50050`)
- `GRPC_PORT_TLS` (default `50051`)
- `GRPC_TLS_ENABLED` = `true|false` (optional; enabled automatically if both cert and key paths are provided)
- `GRPC_TLS_CERT_PATH` = path to server certificate (PEM)
- `GRPC_TLS_KEY_PATH` = path to server private key (PEM)
- `GRPC_TLS_CA_PATH` = path to CA bundle (PEM). If provided, client certs are validated (mTLS)
- `GRPC_TLS_REQUIRE_CLIENT_CERT` = `true|false` (defaults to true when `GRPC_TLS_CA_PATH` is set)

Behavior:
- Plaintext server always binds on `GRPC_PORT_PLAINTEXT` (exposed by default in Docker).
- If TLS is enabled and cert/key are valid, a TLS server also binds on `GRPC_PORT_TLS`.
- If TLS is enabled but certificate loading fails, plaintext still runs; Admin status shows `tls_error`.
- Server gracefully falls back to plaintext-only mode when TLS certificates are missing or misconfigured.

Admin UI (`/app/`) shows:
- Plaintext and TLS port values
- Whether TLS is enabled and a TLS error when misconfigured

### Generate Local Self-Signed Certs
Choose one of the available certificate generation scripts:

**Option 1: Web Authentication certificates (recommended for mTLS)**
```bash
bash scripts/generate-web-auth-cert.sh
```
Generates certificates with TLS Web Server/Client Authentication extensions.

**Option 2: System-trusted certificates**
```bash
bash scripts/generate-trusted-cert.sh
```
Generates CA-signed certificates that can be installed system-wide for trust.

Both scripts output files in `./certs/` (gitignored):
- `ca.crt` — local CA certificate
- `server.crt`, `server.key` — server TLS cert/key (SAN includes localhost and 127.0.0.1)
- `client.crt`, `client.key` — client certificate for mTLS testing (web-auth script only)

grpcurl examples using generated certs:
```bash
# TLS (server-auth only)
grpcurl -import-path protos -proto helloworld.proto -d '{"name":"Tom"}' -cacert certs/ca.crt localhost:50051 helloworld.Greeter/SayHello

# mTLS (client-auth)
grpcurl -import-path protos -proto helloworld.proto -d '{"name":"Tom"}' -cacert certs/ca.crt -cert certs/client.crt -key certs/client.key \
  localhost:50051 helloworld.Greeter/SayHello
```

## Example Rule (YAML)
```yaml
match:
  request:
    name: "Tom"
responses:
  - when:
      request.name: "Tom"
    body:
      message: "Hi Tom (from mock)"
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

## Matching & Operators
- Equality: default for literal values in `match` and `when`.
- Metadata headers: use `match.metadata` or `when: { "metadata.<key>": ... }`.
- Supported operator objects (instead of a literal value):
  - `regex`: `{ regex: "^Bearer \\w+$", flags: "i" }`
  - `contains`: substring for strings, member for arrays: `{ contains: "gold" }`
  - `in`: allowed set: `{ in: ["admin", "root"] }`
  - `exists`: `{ exists: true }`
  - Numeric: `{ gt: 0 }`, `{ gte: 18 }`, `{ lt: 100 }`, `{ lte: 5 }`
  - Equality explicit: `{ eq: "a" }`, `{ ne: "b" }`
  - Negation: `{ not: { regex: "foo" } }`

Selection order and priority:
- Top-level `match` must pass for conditional evaluation; otherwise a fallback (entries without `when`) is chosen by highest `priority` (default 0), or an empty OK if no fallback exists.
- When `match` passes, all entries with `when` that match are considered; pick the one with the highest `priority`. For ties, earlier in the list wins.
- If no conditional entries match, fall back to entries without `when`, again choosing the highest `priority` (tie → earlier).

Example combining request and metadata:
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
    priority: 10
  - body: { allow: false }
    priority: 0
```

grpcurl example with Authorization header:
```bash
grpcurl -import-path protos -proto helloworld.proto -plaintext \
  -H 'authorization: Bearer token123' \
  -d '{"name":"Tom"}' localhost:50050 helloworld.Greeter/SayHello
```

### In Proto
- Define request/response messages as usual in `.proto`.
- Use dotted paths in rules to target nested fields, matching the structure in your proto.
- Example proto showcasing nested and repeated fields: `protos/advanced.proto:1`.
 - Third-party import example (Google types): `protos/calendar.proto:1` imports `google/type/datetime.proto` and uses `google.type.DateTime` in messages.

### In Rules
- File naming: `package.service.method.yaml` (lowercase, `/` → `.`), e.g., `demo.matcher.eval.yaml`.
- Example with operators: `rules/demo.matcher.eval.yaml:1`.
- Header matching example added to hello world rule: `rules/helloworld.greeter.sayhello.yaml:1`.
 - Third-party import example rule for `calendar.Events/GetEvent`: `rules/calendar.events.getevent.yaml:1`.

### Third-Party Protos
- Common Google/Validate/OpenTelemetry protos can be placed under `protos/google/...`, `protos/validate/...`, etc. If they are not present, fetch with your project’s script (see `AGENTS.md`).
- The loader resolves imports relative to the importing file and from the `protos/` root, so imports like `import "google/type/datetime.proto";` work when the files exist under `protos/google/type/`.

Quick test with grpcurl:
```bash
grpcurl -import-path protos -proto calendar.proto -plaintext -d '{"id":"next"}' localhost:50050 calendar.Events/GetEvent
```

## Error Simulation (gRPC Status)
- Set `trailers.grpc-status` to a non-zero code to return an error.
- Optional: set `trailers.grpc-message` for error details; other keys become trailing metadata.
- Example:
  ```yaml
  match:
    request:
      user.age: { lt: 18 }
  responses:
    - body: {}
      trailers:
        grpc-status: 7           # PERMISSION_DENIED
        grpc-message: "Underage"
        error-id: "E123"        # custom trailing metadata
  ```
- On success, custom trailer keys (excluding `grpc-status`/`grpc-message`) are sent as trailing metadata.

## Health Checks
- Endpoints: `/` (health), `/liveness`, `/readiness`
- Examples:
  ```bash
  curl -f http://localhost:3000/
  curl -f http://localhost:3000/liveness
  curl -f http://localhost:3000/readiness
  ```

## Testing
- Run tests with Bun:
  ```bash
  bun test
  ```
  Or watch mode:
  ```bash
  bun test --watch
  ```
  Focus of unit tests: pure domain use cases like `src/domain/usecases/selectResponse.ts`.

## Server Streaming Support

The server now supports gRPC server streaming methods using `stream_items` in rule responses.

### Stream Configuration
- `stream_items`: Array of response objects to stream sequentially
- `stream_delay_ms`: Delay between stream items in milliseconds (default: 100ms)
- `stream_loop`: Loop stream_items forever while connection is alive (default: false)
- `stream_random_order`: Randomize order of stream_items in each loop iteration (default: false)
- If `stream_items` is not provided, falls back to single `body` response

### Example Proto (Server Streaming)
```proto
service StreamService {
  rpc GetMessages (MessageRequest) returns (stream MessageResponse);
}
```

### Example Rule (Server Streaming)
```yaml
match:
  request:
    user_id: "user123"
responses:
  - when:
      request.user_id: "user123"
    stream_items:
      - id: "msg1"
        content: "Hello!"
        timestamp: 1640995200
      - id: "msg2"
        content: "How are you?"
        timestamp: 1640995260
    stream_delay_ms: 500
    trailers:
      grpc-status: "0"
```

### Infinite Loop Streaming
```yaml
# Loop forever with random order
responses:
  - when:
      request.user_id: "live_user"
    stream_items:
      - id: "msg1"
        content: "Message 1"
      - id: "msg2" 
        content: "Message 2"
      - id: "msg3"
        content: "Message 3"
    stream_delay_ms: 1000
    stream_loop: true
    stream_random_order: true
    trailers:
      grpc-status: "0"
```

### Error Handling in Streaming
For streaming methods, errors are handled the same way as unary methods:
- Set `trailers.grpc-status` to a non-zero code
- Optional `trailers.grpc-message` for error details
- When an error status is set, no stream items are sent

```yaml
# Error example for streaming
responses:
  - when:
      request.user_id: "forbidden_user"
    trailers:
      grpc-status: "7"  # PERMISSION_DENIED
      grpc-message: "Access denied"
```

### Testing Server Streaming
```bash
# Test streaming messages
grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"user_id":"user123"}' localhost:50050 streaming.StreamService/GetMessages

# Test streaming events
grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"topic":"orders"}' localhost:50050 streaming.StreamService/WatchEvents

# Test with limit parameter
grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"user_id":"test","limit":2}' localhost:50050 streaming.StreamService/GetMessages

# Test error cases
grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"user_id":"error_user"}' localhost:50050 streaming.StreamService/GetMessages

# Test infinite loop with random order (Ctrl+C to stop)
grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"user_id":"live_user"}' localhost:50050 streaming.StreamService/GetMessages

# Test live monitoring events (Ctrl+C to stop)
grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"topic":"live_monitoring"}' localhost:50050 streaming.StreamService/WatchEvents
```

## Response Body Templating

The server supports dynamic response templating using data from requests, metadata, headers, and stream context. Templates use `{{expression}}` syntax and can access various data sources.

### Template Syntax
- `{{request.field}}` - Access request fields (supports nested paths like `request.user.name`)
- `{{metadata.header}}` - Access gRPC metadata/headers
- `{{stream.index}}` - Current stream item index (0-based)
- `{{stream.total}}` - Total number of stream items
- `{{stream.isFirst}}` - Boolean indicating first stream item
- `{{stream.isLast}}` - Boolean indicating last stream item
- `{{utils.now()}}` - Current timestamp in milliseconds
- `{{utils.uuid()}}` - Generate random UUID
- `{{utils.random(min, max)}}` - Generate random number between min and max
- `{{utils.format(template, ...args)}}` - Format string with %s placeholders

### Example Template Rule
```yaml
match:
  request:
    name: { exists: true }
responses:
  - when:
      request.name: "template"
    body:
      message: "Hello {{request.name}}! Current time: {{utils.now()}}"
      timestamp: "{{utils.now()}}"
      user_info:
        name: "{{request.name}}"
        greeting: "Welcome {{request.name}}"
        random_number: "{{utils.random(1, 100)}}"
        user_agent: "{{metadata.user-agent}}"
    trailers:
      grpc-status: "0"
```

### Streaming Template Example
```yaml
match:
  request:
    user_id: "template_user"
responses:
  - when:
      request.user_id: "template_user"
    stream_items:
      - id: "msg_{{stream.index}}"
        content: "Message #{{stream.index + 1}} of {{stream.total}} for {{request.user_id}}"
        timestamp: "{{utils.now()}}"
        is_first: "{{stream.isFirst}}"
        is_last: "{{stream.isLast}}"
        random_id: "{{utils.uuid()}}"
    stream_delay_ms: 1000
    trailers:
      grpc-status: "0"
```

### Testing Templates
```bash
# Test basic templating
grpcurl -import-path protos -proto helloworld.proto -plaintext -d '{"name":"template"}' localhost:50050 helloworld.Greeter/SayHello

# Test with metadata
grpcurl -import-path protos -proto helloworld.proto -plaintext \
  -H 'authorization: Bearer token123' \
  -H 'user-agent: test-client' \
  -d '{"name":"metadata"}' localhost:50050 helloworld.Greeter/SayHello

# Test streaming templates
grpcurl -import-path protos -proto streaming.proto -plaintext -d '{"user_id":"template_user"}' localhost:50050 streaming.StreamService/GetMessages
```

### Template Features
- **Input Static**: Match conditions (`match` and `when`) remain static for predictable routing
- **Output Dynamic**: Response bodies (`body` and `stream_items`) support full templating
- **Flexible Access**: Access request fields, metadata, stream context, and utility functions
- **Safe Evaluation**: Invalid expressions gracefully fall back to empty strings
- **Nested Support**: Templates work in nested objects and arrays

## Roadmap
- Create, edit, and validate rule bodies inline with schema validation.
- Preview matched response given sample request and metadata.

## Development
This project was developed with AI assistance to accelerate development and ensure comprehensive feature coverage.

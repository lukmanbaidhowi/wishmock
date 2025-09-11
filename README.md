# Mock gRPC Server with protobufjs & Hot Reload

This project is a simple gRPC mock server built with Bun 1.x (tested with 1.2.20), `@grpc/grpc-js`, and `protobufjs`.  
It allows you to load `.proto` files directly (no conversion needed) and define mock rules in YAML/JSON.  
Supports hot reload for both proto files and rules.

## Features
- Load `.proto` files directly using protobufjs
- Hot reload proto (soft restart server when proto changes)
- Hot reload rules (no restart needed)
- Match request fields & metadata for conditional responses
- Define responses in YAML/JSON rules
- Advanced operators for matching (regex, contains, in, exists, numeric)
- Priority-aware selection: among matched responses, the highest numeric `priority` wins (default 0; order as tiebreaker). Fallbacks (no `when`) also respect priority.

## Project Structure
```
grpc-server-mock/
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

3) Develop with watch
```bash
# tsc watch + run dist with watcher
bun run start:develop

# OR run TS directly (no tsc) with Bun watcher
  bun run start:develop:ts
```

- gRPC servers:
  - Plaintext: `localhost:50050` (always on)
  - TLS: `localhost:50051` (if enabled)
- Admin HTTP server: `localhost:3000`

Note: Requires Bun >= 1.0. The provided Dockerfile uses `oven/bun:1.2.20-alpine`.

## Usage (Node / npx)
If you prefer Node, you can run the server with Node or npx.

1) Run directly via npx (after publish)
```bash
npx grpc-server-mock
# alias still available:
# npx mock-grpc
# or if published under a scope/name variant:
# npx @your-scope/grpc-server-mock
```

2) Local Node run (without Bun)
```bash
npm i   # or: pnpm i / yarn
npm run start:node
```

3) Develop with watch (two terminals)
```bash
# Terminal A (TypeScript compile in watch mode)
npm run build:watch:node

# Terminal B (Node >= 20 for --watch)
npm run start:node:watch
```

- gRPC servers:
  - Plaintext: `localhost:50050`
  - TLS: `localhost:50051` (if enabled)
- Admin HTTP server: `localhost:3000`

### Admin UI (Web)
- Open `http://localhost:3000/app/` to:
  - Upload `.proto` and rule files (YAML/JSON) via Admin API
  - View status: gRPC ports, loaded services, and loaded rules (stubs)
- This UI is static (no build tools) and is served by Express from `frontend/`.

### Docker
Default (plaintext only):
```bash
docker compose up --build
```

- Exposes: gRPC plaintext on `50050`, Admin HTTP on `3000`.
- TLS port `50051` is not exposed by default to avoid confusion.

Healthcheck:
- The container includes a healthcheck that hits `http://localhost:3000/liveness` inside the container.
- View health: `docker ps` (look for `healthy`), or `docker inspect --format='{{json .State.Health}}' grpc-server-mock | jq .`

Enable TLS by uncommenting the TLS lines in `docker-compose.yml` after generating certs:
```bash
# Generate certs under ./certs
bash scripts/generate-local-certs.sh

# In docker-compose.yml, uncomment the 50051 port mapping and TLS env vars
# Then start the stack
docker compose up --build
```

grpcurl with TLS/mTLS (Docker TLS enabled):
```bash
# TLS (server-auth only) — uses server cert signed by local CA
grpcurl -d '{"name":"Tom"}' \
  -cacert certs/ca.crt \
  localhost:50051 helloworld.Greeter/SayHello

# mTLS (client-auth) — uncomment GRPC_TLS_CA_PATH in docker-compose.yml
# and restart the stack; then call with client cert/key
grpcurl -d '{"name":"Tom"}' \
  -cacert certs/ca.crt \
  -cert certs/client.crt \
  -key certs/client.key \
  localhost:50051 helloworld.Greeter/SayHello
```

3. Test with grpcurl (plaintext):
   ```bash
   grpcurl -plaintext -d '{"name":"Tom"}' localhost:50050 helloworld.Greeter/SayHello
   ```

4. Hot reload:
   - Change/add `.proto` in `protos/` → server auto rebuilds and restarts
   - Change/add rules in `rules/` → rules reload immediately (no restart)
  - Upload proto/rules via Admin API

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
grpcurl -plaintext -d '{"id":"err-unauth"}' localhost:50050 calendar.Events/GetEvent
grpcurl -plaintext -d '{"id":"err-forbidden"}' localhost:50050 calendar.Events/GetEvent
grpcurl -plaintext -d '{"id":"err-unavailable"}' localhost:50050 calendar.Events/GetEvent
grpcurl -plaintext -d '{"id":"err-deadline"}' localhost:50050 calendar.Events/GetEvent
```

Note: On Bun, file watching uses polling for stability.

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
- In Docker, TLS port `50051` is exposed only if you uncomment its mapping in `docker-compose.yml`.
- If TLS is enabled but certificate loading fails, plaintext still runs; Admin status shows `tls_error`.

Admin UI (`/app/`) shows:
- Plaintext and TLS port values
- Whether TLS is enabled and a TLS error when misconfigured

### Generate Local Self-Signed Certs
Use the helper script to create a local CA, server cert (CN=localhost), and client cert for mTLS testing:
```bash
bash scripts/generate-local-certs.sh
```
Outputs files in `./certs/` (gitignored):
- `ca.crt` — local CA certificate
- `server.crt`, `server.key` — server TLS cert/key (SAN includes localhost and 127.0.0.1)
- `client.crt`, `client.key` — client certificate for mTLS testing

grpcurl examples using generated certs:
```bash
# TLS (server-auth only)
grpcurl -d '{"name":"Tom"}' -cacert certs/ca.crt localhost:50051 helloworld.Greeter/SayHello

# mTLS (client-auth)
grpcurl -d '{"name":"Tom"}' -cacert certs/ca.crt -cert certs/client.crt -key certs/client.key \
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
grpcurl -plaintext \
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
grpcurl -plaintext -d '{"id":"next"}' localhost:50050 calendar.Events/GetEvent
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

## Roadmap
- Response body templating with variables from request/metadata.
- Array streaming for server streaming methods.
- Create, edit, and validate rule bodies inline with schema validation.
- Preview matched response given sample request and metadata.

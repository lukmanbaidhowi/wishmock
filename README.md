# wishmock

[![npm version](https://img.shields.io/npm/v/wishmock.svg)](https://www.npmjs.com/package/wishmock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Wishmock is a gRPC and Connect RPC mock platform that bundles the server, admin HTTP API, and lightweight web UI in one package. Load `.proto` files directly, define rule-based responses in YAML/JSON, and iterate quickly with hot reload on Bun or zero‑downtime rolling restarts on Node cluster. The project ships with MCP servers, server reflection support, validation engine, and is container-ready. Native gRPC-Web support is built-in via Connect RPC without requiring an additional proxy layer.

## Table of Contents
- [Features](#features)
- [Quick Start (Global Install)](#quick-start-global-install)
- [Project Structure](#project-structure)
- [Usage (Bun 1.x)](#usage-bun-1x)
  - [Environment (.env.example)](#environment-envexample)
  - [Enable TLS locally with .env](#enable-tls-locally-with-env)
- [Usage (Node / npx)](#usage-node--npx)
- [Quick Test](#quick-test)
- [Available Commands](#available-commands)
- [Hot Reload](#hot-reload)
  - [Zero-downtime proto updates (Node cluster)](#zero-downtime-proto-updates-node-cluster)
  - [Admin UI (Web)](#admin-ui-web)
  - [Docker](#docker)
  - [Error Simulation Examples](#error-simulation-examples)
- [Server Reflection](#server-reflection)
- [TLS / mTLS](#tls--mtls)
  - [Generate Local Self-Signed Certs](#generate-local-self-signed-certs)
- [Connect RPC Support](#connect-rpc-support)
  - [Quick Start](#quick-start)
  - [Configuration](#configuration)
  - [Testing Connect RPC](#testing-connect-rpc)
- [Rule Examples](#rule-examples)
- [Matching & Operators](#matching--operators)
  - [In Proto](#in-proto)
  - [In Rules](#in-rules)
  - [Third-Party Protos](#third-party-protos)
- [Error Simulation (gRPC Status)](#error-simulation-grpc-status)
- [Health Checks](#health-checks)
- [Validation](#validation)
  - [Source Selection](#source-selection)
  - [Oneof Validation](#oneof-validation)
- [Testing](#testing)
- [Server Streaming Support](#server-streaming-support)
  - [Stream Configuration](#stream-configuration)
  - [Example Proto (Server Streaming)](#example-proto-server-streaming)
  - [Example Rule (Server Streaming)](#example-rule-server-streaming)
  - [Infinite Loop Streaming](#infinite-loop-streaming)
  - [Error Handling in Streaming](#error-handling-in-streaming)
  - [Testing Server Streaming](#testing-server-streaming)
- [Response Body Templating](#response-body-templating)
  - [Template Syntax](#template-syntax)
  - [Example Template Rule](#example-template-rule)
  - [Streaming Template Example](#streaming-template-example)
  - [Testing Templates](#testing-templates)
  - [Template Features](#template-features)
- [MCP Server (Model Context Protocol)](#mcp-server-model-context-protocol)
  - [MCP Client Config Examples](#mcp-client-config-examples)
  - [Start Both (Server + MCP) with Bun and env file](#start-both-server--mcp-with-bun-and-env-file)
- [Docker Compose Validation](#docker-compose-validation)
- [Roadmap](#roadmap)
- [Development](#development)

## Features
- **Proto loading + protoc descriptors** — Load protos at runtime and serve reflection using prebuilt `protoc` descriptor sets for grpcurl parity
- **Rule engine + templating** — YAML/JSON rules with request/metadata matching, rich operators, and body/stream templating
- **Validation (Protovalidate + PGV)** — Field-level constraints, per-message/aggregate modes, optional message-level CEL
- **Streaming modes** — Unary, server, client, and bidirectional with delays, loops, and random ordering
- **Hot reload + zero-downtime** — Watch protos/rules in dev; rolling restarts in Node cluster
- **TLS/mTLS + reflection** — Plaintext and TLS ports; first-class grpcurl support via server reflection
- **Connect RPC support** — Native browser support with Connect, gRPC-Web, and gRPC protocols without requiring an additional proxy layer
- **Unified architecture** — Shared request handling ensures consistent behavior across all protocols
- **Admin API + Web UI + MCP** — REST admin endpoints, static console, and MCP (SDK + SSE) for automation
- **Docker + compose validation** — Multi-stage image, healthchecks, and scripts for lint/dry-run/smoke with artifacts
- **Observability & health** — `/`, `/liveness`, `/readiness`, and `/admin/status` with detailed metrics
- **Asset workflows** — Upload protos/rules via Admin API; auto-regenerate reflection descriptors on changes

## Architecture

Wishmock uses a unified architecture where both native gRPC and Connect RPC servers share the same core logic, ensuring consistent behavior across all protocols.

### Shared Core Design

```
┌─────────────────────────────────────────────────────────────────┐
│                      Wishmock Application                       │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   Shared Core Logic                        │ │
│  │                                                            │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │ │
│  │  │ Rule Matcher │  │  Validation  │  │ Response        │   │ │
│  │  │              │  │  Engine      │  │ Selector        │   │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘   │ │
│  │                                                            │ │
│  │  ┌──────────────┐  ┌──────────────┐                        │ │
│  │  │ Proto Root   │  │ Rules Index  │                        │ │
│  │  │ (Shared)     │  │ (Shared)     │                        │ │
│  │  └──────────────┘  └──────────────┘                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                          │                                      │
│           ┌──────────────┴──────────────┐                       │
│           │                             │                       │
│  ┌────────▼────────┐          ┌─────────▼────────┐              │
│  │ gRPC Protocol   │          │ Connect Protocol │              │
│  │ Adapter         │          │ Adapter          │              │
│  │                 │          │                  │              │
│  │ - Metadata      │          │ - Metadata       │              │
│  │   extraction    │          │   extraction     │              │
│  │ - Error mapping │          │ - Error mapping  │              │
│  │ - Streaming     │          │ - Streaming      │              │
│  └─────────────────┘          └──────────────────┘              │
│           │                             │                       │
│  ┌────────▼────────┐          ┌─────────▼────────┐              │
│  │ Native gRPC     │          │ Connect RPC      │              │
│  │ Server          │          │ Server           │              │
│  │ (port 50050)    │          │ (port 50052)     │              │
│  └─────────────────┘          └──────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Benefits

- **Single Source of Truth**: Rule matching, validation, and response selection logic is shared
- **Protocol Consistency**: Identical behavior across gRPC, Connect, and gRPC-Web protocols
- **Coordinated Lifecycle**: Servers start, reload, and shutdown together with shared state
- **Easier Testing**: Core logic can be tested independently of protocol specifics
- **Maintainability**: Changes to business logic automatically apply to all protocols

### How It Works

1. **Request Normalization**: Protocol adapters convert incoming requests (gRPC or Connect) to a normalized format
2. **Shared Processing**: The normalized request flows through shared rule matching, validation, and response selection
3. **Response Conversion**: The normalized response is converted back to the appropriate protocol format
4. **Consistent Errors**: Error codes and messages are mapped consistently across protocols

For detailed architecture documentation, see [docs/architecture.md](docs/architecture.md).

## Quick Start (Global Install)

Install Wishmock globally and run anywhere:

```bash
# Install
npm install -g wishmock

# Create project folder
mkdir my-grpc-mock && cd my-grpc-mock

# Start server (auto-creates protos/, rules/grpc/, uploads/ in current directory)
wishmock
```

Server runs on:
- Connect RPC: `http://localhost:50052` (HTTP/1.1 and HTTP/2, enabled by default)
- gRPC (plaintext): `localhost:50050`
- HTTP Admin API: `localhost:4319`
- Web UI: `http://localhost:4319/app/`

**Add your proto via Web UI:**

1. Open `http://localhost:4319/app/`
2. Upload your `.proto` file
3. Optionally upload rule files (`.yaml` or `.json`)

**Or create proto file manually:**

```bash
cat > protos/helloworld.proto << 'EOF'
syntax = "proto3";
package helloworld;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply) {}
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
EOF
```

Test it:
```bash
grpcurl -plaintext -d '{"name":"World"}' localhost:50050 helloworld.Greeter/SayHello
```

**Note:** `protoc` is optional and auto-detected. If not installed, the server runs normally with full validation support, but `grpcurl list/describe` may not work. Install protoc for reflection: https://protobuf.dev/installation/

For detailed global installation guide, see [docs/global-installation.md](docs/global-installation.md).

## Project Structure
```
wishmock/
├─ protos/                 # put your proto files here
│  └─ helloworld.proto
├─ rules/                  # rule roots (gRPC rules live in rules/grpc/)
│  └─ grpc/                # gRPC YAML/JSON rule files
│     └─ helloworld.greeter.sayhello.yaml
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
- Admin HTTP server: `localhost:4319`

Note: Requires Bun >= 1.0. The provided Dockerfile uses `oven/bun:1.2.20-alpine`.

### Environment (.env.example)
- Copy `.env.example` to `.env` and adjust values as needed.
- `.env` is already ignored by git (see `.gitignore`).
- With Bun, load it using `--env-file`:

```bash
cp .env.example .env
bun --env-file=.env run start
```

Common variables:
- `HTTP_PORT` (default `3000`)
- `GRPC_PORT_PLAINTEXT` (default `50050`; fallback `GRPC_PORT` is also supported)
- `GRPC_PORT_TLS` (default `50051`)
- TLS/mTLS: `GRPC_TLS_ENABLED`, `GRPC_TLS_CERT_PATH`, `GRPC_TLS_KEY_PATH`, `GRPC_TLS_CA_PATH`, `GRPC_TLS_REQUIRE_CLIENT_CERT`
- Connect RPC: `CONNECT_ENABLED`, `CONNECT_PORT`, `CONNECT_CORS_ENABLED`, `CONNECT_CORS_ORIGINS`, `CONNECT_TLS_ENABLED`
- MCP (optional): `ENABLE_MCP`, `ENABLE_MCP_SSE`, `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_TRANSPORT`
- Validation (optional):
  - `VALIDATION_ENABLED` — enable request validation based on `.proto` annotations (default `false`)
  - `VALIDATION_SOURCE` — `auto|pgv|protovalidate` rule source selection (default `auto`)
  - `VALIDATION_MODE` — streaming mode `per_message|aggregate` (default `per_message`)
  - `VALIDATION_CEL_MESSAGE` — gate message-level CEL enforcement: `experimental|off` (default `off`)

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
- `curl http://localhost:4319/admin/status` shows `grpc_ports.tls_enabled: true` and `grpc_ports.tls: 50051`

## Usage (Node / npx)
If you prefer Node, you can run the server with Node or npx.

1) Run directly via npx (after publish)
```bash
npx wishmock
# or if published under a scope/name variant:
# npx @your-scope/wishmock
# When protoc isn't available, disable regeneration:
REFLECTION_DISABLE_REGEN=1 npx wishmock
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
- Admin HTTP server: `localhost:4319`

MCP (SSE for npx flows)

- Start SSE MCP with npx (separate terminal):
```bash
npx -p wishmock node node_modules/wishmock/dist/mcp/server.sse.js
# Overrides:
#   HTTP_PORT=3000 npx -p wishmock node node_modules/wishmock/dist/mcp/server.sse.js
# or explicitly:
#   ADMIN_BASE_URL=http://localhost:3000 npx -p wishmock node node_modules/wishmock/dist/mcp/server.sse.js
```

## Quick Test

With reflection (recommended):
```bash
# List services
grpcurl -plaintext localhost:50050 list

# Describe a service
grpcurl -plaintext localhost:50050 describe helloworld.Greeter

# Invoke a method
grpcurl -plaintext -d '{"name":"Tom"}' localhost:50050 helloworld.Greeter/SayHello
```

Alternatively, call with explicit proto flags:
```bash
grpcurl -import-path protos -proto helloworld.proto -plaintext -d '{"name":"Tom"}' \
  localhost:50050 helloworld.Greeter/SayHello
```

## Available Commands

| Command | Description |
|---------|-------------|
| `bun run start` | Start server (builds first via prestart) |
| `bun run start:develop` | Development with watch (tsc + Bun watcher) |
| `bun run start:develop:ts` | Development with Bun TS watcher (no tsc) |
| `bun run build` | Build TypeScript to dist/ |
| `bun run dev:frontend` | Watch and rebuild frontend |
| `bun run descriptors:generate` | Regenerate protobuf descriptor set for reflection |
| `bun test` | Run all unit tests |
| `bun run test:examples` | E2E tests using reflection |
| `bun run test:examples:import-proto` | E2E tests with explicit -import-path |
| `bun run test:e2e` | Full E2E test suite |
| `bun run validation:e2e:protovalidate:bytes` | E2E tests for bytes validation |
| `bun run validation:e2e:protovalidate:maps` | E2E tests for map validation |
| `bun run validation:e2e:protovalidate:wkt:timestamp-duration` | E2E tests for Timestamp/Duration |
| `bun run validation:e2e:protovalidate:wkt:any` | E2E tests for Any type validation |
| `bun run protos:fetch` | Fetch third-party protos (google, buf, envoy, etc.) |

**Testing Workflow:**
1. Generate descriptors: `bun run descriptors:generate`
2. Run unit tests: `bun test --filter validation`
3. Run E2E validation: `bun run validation:e2e:protovalidate:bytes`
4. Check coverage: `curl http://localhost:4319/admin/status | jq '.validation'`

## Hot Reload

### Zero-downtime proto updates (Node cluster)
- Enable cluster: set `START_CLUSTER=true` (see `node-docker-compose.yaml`).
- Default in Node cluster:
  - Proto hot-reload is disabled to avoid in-worker restarts.
  - Uploading proto via Admin API requests a rolling restart of workers (zero downtime).
- Env toggles:
  - `HOT_RELOAD_PROTOS=true|false` — force enable/disable proto watchers. Default is `false` when `START_CLUSTER=true`, otherwise `true`.
  - `HOT_RELOAD_RULES=true|false` — rule watcher (default `true`).
  - `ON_UPLOAD_PROTO_ACTION=rolling-restart|noop` — action after proto upload. Default `rolling-restart` under cluster, `noop` otherwise.
- Manual rolling restart: send `SIGHUP` or `SIGUSR2` to the cluster master (PID 1 in Docker).

In Bun or single-process Node (no cluster), proto hot-reload remains enabled by default.

**Note**: Proto hot-reload includes automatic reflection descriptor regeneration. When you upload or modify `.proto` files, the server will:
1. Regenerate the reflection descriptor set (`bin/.descriptors.bin`) using `protoc`
2. Reload proto definitions for validation and request handling
3. Restart gRPC server with updated reflection metadata

This works both in local development and Docker containers. See [Server Reflection](#server-reflection) for details.
- Change/add `.proto` in `protos/` → server auto rebuilds and restarts
- Change/add rules in `rules/grpc/` → rules reload immediately (no restart)
- Upload proto/rules via Admin API

### Admin UI (Web)
- Open `http://localhost:4319/app/` to:
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

- Exposes: Connect RPC on `50052`, gRPC plaintext on `50050`, gRPC TLS on `50051`, Admin HTTP on `3000`.
- Connect RPC is enabled by default on port `50052`.
- TLS is enabled by default in docker-compose.yml with certificates from `./certs/`.

Healthcheck:
- The container includes a healthcheck that hits `http://localhost:4319/liveness` inside the container.
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

**Note:** Connect RPC is enabled by default. To disable it, set `CONNECT_ENABLED=false` in the environment variables.

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
- The file `rules/grpc/calendar.events.getevent.yaml:1` includes realistic error cases keyed by `request.id` values. Examples:
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
  - The server uses `protoc`-generated descriptor sets (`bin/.descriptors.bin`) to ensure map fields, WKT types, and validation annotations are properly represented in reflection
  - At build time (or via `bun run descriptors:generate`), `protoc --descriptor_set_out` creates a complete descriptor set with proper map entry structures
  - On hot-reload, when proto files change, the descriptor set is automatically regenerated before the server restarts
  - The server wraps `@grpc/grpc-js` with `grpc-node-server-reflection` and unions these descriptors for complete service discovery
  - It preserves original `.proto` file names and canonicalizes common vendor imports (google/*) so dependency names match what grpcurl expects.

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
- With reflection (default): `bun run test:examples`
- With explicit `-proto` imports: `bun run test:examples:import-proto`

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

## Connect RPC Support

Wishmock supports Connect RPC, providing native browser support for three protocols without requiring an additional proxy layer:
- **Connect protocol** - Modern RPC with JSON and binary formats
- **gRPC-Web** - Browser-compatible gRPC over HTTP/1.1
- **gRPC** - Standard gRPC protocol compatibility

All three protocols work with the same rule files and validation engine, giving you maximum flexibility for client implementations.

### Quick Start

Enable Connect RPC with environment variables:

```bash
# Enable Connect RPC (default: true)
CONNECT_ENABLED=true

# Set Connect port (default: 50052)
CONNECT_PORT=50052

# Enable CORS for browser clients (default: true)
CONNECT_CORS_ENABLED=true
CONNECT_CORS_ORIGINS=*

# Start server
bun run start
```

Server runs on:
- Connect RPC: `http://localhost:50052` (HTTP/1.1 and HTTP/2, enabled by default)
- gRPC (plaintext): `localhost:50050`
- gRPC (TLS): `localhost:50051` (if enabled)
- HTTP Admin API: `localhost:4319`

### Configuration

**Environment Variables:**

```bash
# Connect RPC
CONNECT_ENABLED=true              # Enable Connect RPC server (default: true)
CONNECT_PORT=50052                # Connect RPC HTTP port (default: 50052)

# CORS (for browser clients)
CONNECT_CORS_ENABLED=true         # Enable CORS (default: true)
CONNECT_CORS_ORIGINS=*            # Allowed origins (default: *)

# TLS (optional)
CONNECT_TLS_ENABLED=false         # Enable TLS for Connect (default: false)
CONNECT_TLS_CERT_PATH=certs/server.crt
CONNECT_TLS_KEY_PATH=certs/server.key
```

**Check Status:**

```bash
curl http://localhost:4319/admin/status | jq '.connect_rpc'
```

Response includes:
```json
{
  "enabled": true,
  "port": 50052,
  "cors_enabled": true,
  "cors_origins": ["*"],
  "tls_enabled": false,
  "services": ["helloworld.Greeter"],
  "metrics": {
    "requests_total": 100,
    "requests_by_protocol": {
      "connect": 50,
      "grpc_web": 30,
      "grpc": 20
    },
    "errors_total": 5
  }
}
```

### Protocols Supported

**Connect Protocol:**
- Native browser support with fetch API
- JSON and binary formats
- HTTP/1.1 and HTTP/2 compatible
- Endpoint: `POST http://localhost:50052/package.Service/Method`

**gRPC-Web Protocol:**
- Browser-compatible without requiring an additional proxy layer
- Binary protocol (base64 in HTTP/1.1)
- Works with existing gRPC-Web clients
- Endpoint: `POST http://localhost:50052/package.Service/Method`

**Native gRPC Protocol:**
- Full gRPC compatibility over HTTP/2
- Works with standard gRPC clients
- Endpoint: `POST http://localhost:50052/package.Service/Method`

### Testing Connect RPC

**Browser Examples:**

The repository includes ready-to-use browser examples:

```bash
# Start server
bun run start

# Open browser examples
open examples/connect-client/browser.html
open examples/grpc-web-connect/browser.html
```

**Node.js Examples:**

```bash
# Install dependencies
cd examples/connect-client
npm install

# Run Connect client
node node.mjs

# Run gRPC-Web client
cd ../grpc-web-connect
npm install
node node.mjs
```

**Integration Test:**

Run the full integration test to verify all three protocols:

```bash
# Tests Connect, gRPC-Web, and native gRPC
bun run test:connect:integration
```

**Manual Testing:**

```bash
# Using curl with Connect protocol (JSON)
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name":"World"}'

# Using grpcurl with native gRPC (still works)
grpcurl -plaintext -d '{"name":"World"}' localhost:50050 helloworld.Greeter/SayHello
```

### Key Features

- **No Additional Proxy Layer Required** - Direct browser-to-server communication
- **Protocol Flexibility** - One endpoint supports three protocols
- **Rule Compatibility** - Same rules work across all protocols
- **Validation Support** - Full validation engine integration
- **Streaming Support** - All four streaming patterns supported
- **CORS Built-in** - Configurable CORS for browser clients
- **TLS Support** - Optional TLS encryption
- **Reflection** - Service discovery via reflection API

### Migration Notes

**Note:** Connect RPC provides built-in gRPC-Web support without requiring an additional proxy layer. If you're currently using a separate proxy:

1. **Immediate:** Connect RPC is available now - no breaking changes to existing gRPC setup
2. **Recommended:** New projects should use Connect RPC's built-in gRPC-Web support
3. **Migration:** Existing proxy setups can migrate at your convenience
4. **Support:** Configuration examples remain available for existing users

For complete documentation including streaming examples, error handling, client setup, and migration guides, see [docs/connect-rpc-support.md](docs/connect-rpc-support.md).

## Rule Examples
See `docs/rule-examples.md` for complete YAML samples, metadata matching patterns, and gRPC error simulations. The examples in that document back the quick-start walkthroughs referenced throughout this README.

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
- Example with operators: `rules/grpc/demo.matcher.eval.yaml:1`.
- Header matching example added to hello world rule: `rules/grpc/helloworld.greeter.sayhello.yaml:1`.
- Third-party import example rule for `calendar.Events/GetEvent`: `rules/grpc/calendar.events.getevent.yaml:1`.

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
  curl -f http://localhost:4319/
  curl -f http://localhost:4319/liveness
  curl -f http://localhost:4319/readiness
  ```

## Validation

The validation engine supports both **PGV** (protoc-gen-validate) and **Protovalidate** (Buf) annotations, plus CEL expressions.

- Enable validation: set `VALIDATION_ENABLED=true`.
- Select source: `VALIDATION_SOURCE=auto|pgv|protovalidate`.
- Streaming mode: `VALIDATION_MODE=per_message|aggregate` (default `per_message`).
- Message-level CEL gate: `VALIDATION_CEL_MESSAGE=experimental|off` (default `off`).
- Validation applies to unary and streaming requests.

### Source Selection
- `VALIDATION_SOURCE=pgv`: enforce only PGV annotations (`(validate.rules).*`). Protovalidate annotations are ignored.
- `VALIDATION_SOURCE=protovalidate`: enforce only Protovalidate annotations (`(buf.validate.field).*`). PGV annotations are ignored.
- `VALIDATION_SOURCE=auto` (default): Protovalidate takes precedence; if no Protovalidate rule is present for a field, PGV is used as a fallback.

Examples:
```bash
# PGV only
VALIDATION_ENABLED=true VALIDATION_SOURCE=pgv bun run start

# Protovalidate only
VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate bun run start

# Auto (Protovalidate preferred, PGV fallback)
VALIDATION_ENABLED=true VALIDATION_SOURCE=auto bun run start
```

Note: The `buf/validate/validate.proto` vendored in `protos/` is fetched from the official Buf Protovalidate repository and pinned to a release tag for determinism. Use `bun run protos:fetch` to refresh. See `scripts/fetch-third-party-protos.sh`.

Guides:
- PGV: `docs/pgv-validation.md`
- Protovalidate (Buf): `docs/protovalidate-validation.md`
- Oneof: `docs/oneof-validation.md`

### Oneof Validation

- At‑most‑one: enforced by Protobuf (last‑wins). The validator includes a defensive check for “multiple set”, but standard clients will not surface this at runtime.
- Exactly‑one (required): enforced by validator using PGV oneof option `(validate.required) = true`. Requests with zero set are rejected with `InvalidArgument` and a clear error message.
- E2E limitation: “multiple set” cannot be reproduced via grpcurl or normal clients because marshalling/decoding collapses to the last field. See `docs/oneof-validation.md` for details.
- Example RPC: `helloworld.Greeter/ValidateOneof`
- Test script: `bash scripts/test-validation-oneof.sh`

## Testing
- Run unit and integration tests with Bun:
  ```bash
  bun test
  ```
  Or watch mode:
  ```bash
  bun test --watch
  ```
  Focus of unit tests: pure domain use cases like `src/domain/usecases/selectResponse.ts`.

- Run E2E tests (requires server startup, skipped by default):
  ```bash
  E2E=true bun test tests/e2e/
  ```

- Run performance benchmarks (skipped by default):
  ```bash
  bun run benchmark
  # or with environment variable
  BENCHMARK=true bun test tests/performance.benchmark.test.ts
  # or
  bun run benchmark
  ```
  See [Performance Benchmarks](docs/performance-benchmarks.md) for detailed results and methodology.

- Profile shared handler performance:
  ```bash
  # Quick profile (10,000 iterations)
  bun run profile:handler
  
  # Comprehensive profile (multiple scenarios)
  bun run profile:handler:comprehensive
  ```
  See [Performance Optimization](docs/performance-optimization.md) for profiling results and analysis.

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

## MCP Server (Model Context Protocol)
- MCP stdio server lets MCP clients read/write `rules/grpc/`, `protos/`, and query status via Admin API.
- Run locally:
  - Build: `bun run build`
  - Start: `bun run start:mcp`
  - CLI: `wishmock-mcp` (after build)
- Docker: toggle MCP inside the container
  - Stdio MCP: set `ENABLE_MCP=true`
  - SSE MCP: set `ENABLE_MCP_SSE=true` (port `9797` by default)
  - Example: `ENABLE_MCP_SSE=true docker compose up --build`
- Tools:
  - `listRules`, `readRule`, `writeRule`
  - `listProtos`, `readProto`, `writeProto`
  - `getStatus` (Admin HTTP or filesystem fallback)
  - `uploadProto`, `uploadRule` (Admin API POST)
  - `listServices`, `describeSchema` (Admin API GET)
  - `ruleExamples` – reads `docs/rule-examples.md` (override path with `WISHMOCK_RULES_EXAMPLES_PATH`)
- Resources:
  - `wishmock://rules/<filename>` (YAML/JSON under rules/grpc)
  - `wishmock://protos/<filename>` (text/x-proto)
- Notes:
  - Uses `@modelcontextprotocol/sdk` (stdio). For SSE-based clients, use the HTTP SSE server and point them to `/sse`.
  - Path resolution: the MCP server locates `rules/grpc/` and `protos/` via env overrides (`WISHMOCK_BASE_DIR`, `WISHMOCK_RULES_DIR`, `WISHMOCK_PROTOS_DIR`) or automatically relative to the server module path.
  - Both transports (stdio and SSE) surface the same tools/resources set, so the `ruleExamples` tool works identically for `wishmock-mcp` and the HTTP SSE endpoint.

### MCP Client Config Examples

SSE (URL-based clients)

```
{
  "mcpServers": {
    "wishmock": {
    "url": "http://127.0.0.1:9797/sse",
      "transport": "sse"
    }
  }
}
```

TOML equivalent:

```
[mcpServers.wishmock]
url = "http://127.0.0.1:9797/sse"
transport = "sse"
```

Stdio (process-spawning clients)

```
{
  "mcpServers": {
    "wishmock": {
      "command": "node",
      "args": ["/path/to/wishmock/dist/mcp/server.sdk.js"],
      "transport": "stdio"
    }
  }
}
```

TOML equivalent:

```
[mcpServers.wishmock]
command = "node"
args = ["/path/to/wishmock/dist/mcp/server.sdk.js"]
transport = "stdio"
```

Docker exec stdio (attach to container)

JSON:

```
{
  "mcpServers": {
    "wishmock": {
      "command": "docker",
      "args": ["exec", "-i", "wishmock", "bun", "/app/dist/mcp/server.sdk.js"],
      "transport": "stdio",
      "env": { "WISHMOCK_BASE_DIR": "/app" }
    }
  }
}
```

TOML equivalent:

```
[mcpServers.wishmock]
command = "docker"
args = ["exec", "-i", "wishmock", "bun", "/app/dist/mcp/server.sdk.js"]
transport = "stdio"

[mcpServers.wishmock.env]
WISHMOCK_BASE_DIR = "/app"
```

Notes:
- Build once: `bun install && bun run build`
- Start SSE server: `bun run start:mcp:http` (default `http://127.0.0.1:9797/sse`)
- Start stdio server: `bun run start:mcp` or `wishmock-mcp`
- Docker: set `ENABLE_MCP_SSE=true` to expose `http://127.0.0.1:9797/sse`

Quick test SSE without an MCP client:
```
# Terminal A: listen to SSE
curl -N http://127.0.0.1:9797/sse

# Terminal B: send a JSON-RPC request (response comes back in HTTP body)
curl -s -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://127.0.0.1:9797/message

# Send a raw SSE event (JSON-RPC notification over SSE stream)
curl -s -X POST -H 'content-type: application/json' \
  -d '{"method":"notifications/resources/list_changed"}' \
  http://127.0.0.1:9797/event

# Convenience endpoint to signal resources changed
curl -s -X POST http://127.0.0.1:9797/notify/resources-changed
```

### Start Both (Server + MCP) with Bun and env file
- Prepare env: copy or edit `.env.tls.mcp` (TLS + MCP SSE defaults)
- Run both with one command (builds first):
  - `bun --env-file=.env.tls.mcp run start:both:mcp`
- Switch transport to stdio (optional):
  - `MCP_TRANSPORT=stdio bun --env-file=.env.tls.mcp run start:both:mcp`

## Docker Compose Validation

The project includes automated validation scripts for both `docker-compose.yml` (Bun stack) and `node-docker-compose.yaml` (Node cluster), plus a grpcurl smoke test for end-to-end validation.

**Prerequisites:**
- Docker Engine with Compose plugin v2.24.x
- grpcurl 1.8+ (for smoke test)
- Run `scripts/compose/check-version.sh` to verify version

**Validation Scripts:**
- `scripts/compose/lint.sh --file <compose-file>` - Validate syntax and configuration
- `scripts/compose/dry-run.sh --file <compose-file>` - Preview planned container actions
- `scripts/compose/smoke.sh --file <compose-file>` - Boot services and verify health
- `scripts/docker/grpcurl-smoke.sh` - Full E2E test with grpcurl

**TDD-First Workflow:**
```bash
# 1. Run tests first (should fail if not implemented)
bun test tests/docker.grpcurl.test.ts
bun test tests/e2e/docker-grpcurl.test.ts

# 2. Pull latest assets (if needed)
bun run tools:assets:pull-latest

# 3. Run grpcurl smoke test
bun run compose:grpcurl

# 4. Validate compose files
bun run compose:validate
```

**Quick validation:**
```bash
# Lint both compose files
scripts/compose/lint.sh --file docker-compose.yml
scripts/compose/lint.sh --file node-docker-compose.yaml

# Run full validation suite
bun run compose:validate

# Run grpcurl smoke test (E2E)
bun run compose:grpcurl
```

**Artifacts:**
- Validation results are stored in `artifacts/compose/<timestamp>/`
- Grpcurl test results in `artifacts/grpcurl/<run-id>/`
- Logs, container states, and health check results are captured for troubleshooting

For a guided workflow and CI integration pointers, see the scripts under `scripts/compose/`, the grpcurl smoke test at `scripts/docker/grpcurl-smoke.sh`, and artifact examples in `artifacts/compose/examples/README.md`.

## Roadmap
- Create, edit, and validate rule bodies inline with schema validation.
- Preview matched response given sample request and metadata.

## Documentation

- **[Quick Reference](docs/quick-reference.md)** - Command cheatsheet and common patterns
- **[Global Installation Guide](docs/global-installation.md)** - Complete guide for npm global install
- **[Connect RPC Support](docs/connect-rpc-support.md)** - Connect, gRPC-Web, and browser client guide
- **[Admin API Reference](API.md)** - REST API endpoints documentation
- **[Rule Examples](docs/rule-examples.md)** - Comprehensive rule patterns and examples
- **[Validation Guide](docs/pgv-validation.md)** - Protovalidate and PGV validation setup
- **[Protovalidate Guide](docs/protovalidate-validation.md)** - Buf Protovalidate integration

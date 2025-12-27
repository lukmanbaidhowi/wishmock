# Connect RPC Support

## Overview

Wishmock supports **Connect RPC**, a modern protocol that provides native browser support and eliminates the need for proxy servers like Envoy. With Connect RPC, Wishmock can handle three different protocols through a single HTTP endpoint:

- **Connect Protocol** - Modern RPC with JSON and binary formats
- **gRPC-Web** - Browser-compatible gRPC without a proxy
- **gRPC** - Full compatibility with standard gRPC clients

This unified approach simplifies your development setup while maintaining all Wishmock features including rule matching, validation, streaming, and reflection.

### Shared Infrastructure

Connect RPC and native gRPC servers share the same core infrastructure, ensuring consistent behavior across all protocols:

- **Shared Rule Matching**: Both servers use identical rule matching logic - rules defined once work across all protocols
- **Shared Validation Engine**: Request validation (Protovalidate/PGV) behaves identically regardless of protocol
- **Shared Proto Root**: Both servers use the same protobuf definitions and service registry
- **Shared Rules Index**: Rule updates are immediately reflected across all protocols
- **Coordinated Lifecycle**: Servers start, reload, and shutdown together with synchronized state

This architecture guarantees that a request sent via gRPC will produce the same response as the identical request sent via Connect or gRPC-Web. See [docs/architecture.md](../docs/architecture.md) for detailed design documentation.

## Quick Start

### 1. Enable Connect RPC

**Connect RPC is enabled by default** and requires no configuration to start using it. The default port is `50052`.

To customize the port:

```bash
CONNECT_PORT=8080
```

To disable Connect RPC if not needed:

```bash
CONNECT_ENABLED=false
```

### 2. Start Wishmock

```bash
bun run start
```

The server will start three endpoints:
- **Connect RPC**: `http://localhost:50052` (HTTP/1.1 and HTTP/2, enabled by default)
- **gRPC Plaintext**: `localhost:50050` (HTTP/2 only)
- **gRPC TLS**: `localhost:50051` (HTTP/2 only, if TLS enabled)

### 3. Test with a Client

**Browser (Connect Protocol)**:
```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Greeter } from "./gen/helloworld_connect";

const transport = createConnectTransport({
  baseUrl: "http://localhost:8080",
});

const client = createPromiseClient(Greeter, transport);
const response = await client.sayHello({ name: "World" });
console.log(response.message);
```

**Node.js (Connect Protocol)**:
```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { Greeter } from "./gen/helloworld_connect";

const transport = createConnectTransport({
  baseUrl: "http://localhost:50052",
  httpVersion: "2",
});

const client = createPromiseClient(Greeter, transport);
const response = await client.sayHello({ name: "World" });
console.log(response.message);
```

## Supported Protocols

### Connect Protocol

The Connect protocol is a modern RPC protocol that supports both JSON and binary formats.

**Features**:
- Native browser support (no proxy required)
- HTTP/1.1 and HTTP/2 compatible
- JSON and binary encoding
- Streaming support
- Standard HTTP semantics

**Client Libraries**:
- `@connectrpc/connect` - Core library
- `@connectrpc/connect-web` - Browser transport
- `@connectrpc/connect-node` - Node.js transport

**Example Request**:
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name": "World"}'
```

### gRPC-Web Protocol

gRPC-Web allows browser clients to communicate with gRPC services without requiring a proxy.

**Features**:
- Browser compatible
- HTTP/1.1 and HTTP/2 support
- Binary protocol (base64 encoded in HTTP/1.1)
- Compatible with existing gRPC-Web clients

**Client Libraries**:
- `@connectrpc/connect-web` with gRPC-Web protocol
- `grpc-web` (Google's official library)

**Example with Connect**:
```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

const transport = createGrpcWebTransport({
  baseUrl: "http://localhost:50052",
});

const client = createPromiseClient(Greeter, transport);
```

### Native gRPC Protocol

Standard gRPC clients work seamlessly with Wishmock's Connect RPC endpoint.

**Features**:
- Full gRPC compatibility
- HTTP/2 required
- Binary protocol
- All streaming patterns supported

**Client Libraries**:
- `@grpc/grpc-js` (Node.js)
- `grpc` (Python)
- `grpc-go` (Go)
- Any standard gRPC client

**Example**:
```javascript
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const packageDefinition = protoLoader.loadSync("helloworld.proto");
const proto = grpc.loadPackageDefinition(packageDefinition);

const client = new proto.helloworld.Greeter(
  "localhost:50052",
  grpc.credentials.createInsecure()
);

client.sayHello({ name: "World" }, (err, response) => {
  console.log(response.message);
});
```

## Configuration

Connect RPC is **enabled by default** and requires no configuration to start using it.

### Environment Variables

```bash
# Connect RPC Server
CONNECT_ENABLED=true              # Enable/disable Connect RPC (default: true)
CONNECT_PORT=50052                # HTTP port for Connect RPC (default: 50052)

# CORS Configuration
CONNECT_CORS_ENABLED=true         # Enable CORS (default: true)
CONNECT_CORS_ORIGINS=*            # Allowed origins (default: *)
CONNECT_CORS_METHODS=GET,POST     # Allowed HTTP methods
CONNECT_CORS_HEADERS=*            # Allowed request headers
CONNECT_CORS_CREDENTIALS=true     # Allow credentials (default: true)

# Native gRPC (unchanged)
GRPC_PORT_PLAINTEXT=50050         # Native gRPC plaintext port
GRPC_PORT_TLS=50051               # Native gRPC TLS port

# TLS Configuration (applies to Connect RPC when enabled)
CONNECT_TLS_ENABLED=false         # Enable TLS for Connect RPC
CONNECT_TLS_CERT_PATH=            # Path to TLS certificate
CONNECT_TLS_KEY_PATH=             # Path to TLS private key
CONNECT_TLS_CA_PATH=              # Path to CA certificate (optional)
```

### Configuration Examples

**Development (CORS enabled, no TLS)** - Default configuration:
```bash
CONNECT_ENABLED=true              # Default: true
CONNECT_PORT=50052                # Default: 50052
CONNECT_CORS_ENABLED=true         # Default: true
CONNECT_CORS_ORIGINS=*            # Default: *
CONNECT_TLS_ENABLED=false         # Default: false
```

**Production (restricted CORS, TLS enabled)**:
```bash
CONNECT_ENABLED=true
CONNECT_PORT=443
CONNECT_CORS_ENABLED=true
CONNECT_CORS_ORIGINS=https://app.example.com,https://admin.example.com
CONNECT_TLS_ENABLED=true
CONNECT_TLS_CERT_PATH=/etc/certs/server.crt
CONNECT_TLS_KEY_PATH=/etc/certs/server.key
```

**Disable Connect RPC (use native gRPC only)**:

If you don't need Connect RPC, you can disable it:

```bash
CONNECT_ENABLED=false
GRPC_PORT_PLAINTEXT=50050
GRPC_PORT_TLS=50051
```

Or in Docker:

```yaml
environment:
  - CONNECT_ENABLED=false
```

### Docker Configuration

Connect RPC is enabled by default in Docker. The port is exposed in both `docker-compose.yml` and `node-docker-compose.yaml`.

**Run with Docker**:
```bash
# Port 50052 is exposed by default
docker run -p 50050:50050 -p 50052:50052 -p 4319:4319 wishmock

# Test Connect RPC
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name":"Docker"}'
```

**Docker Compose**:
```yaml
services:
  wishmock:
    image: wishmock
    ports:
      - "50050:50050"   # gRPC plaintext
      - "50051:50051"   # gRPC TLS
      - "50052:50052"   # Connect RPC (enabled by default)
      - "4319:4319"     # Admin API
    environment:
      - CONNECT_ENABLED=true
      - CONNECT_PORT=50052
      - CONNECT_TLS_ENABLED=false
```

**Disable Connect RPC in Docker**:
```yaml
environment:
  - CONNECT_ENABLED=false
```

## CORS Configuration

Cross-Origin Resource Sharing (CORS) is essential for browser clients to communicate with Wishmock from different origins.

### Default CORS Settings

By default, Wishmock enables permissive CORS for development:

```javascript
{
  origins: ["*"],
  methods: ["GET", "POST", "OPTIONS"],
  headers: ["*"],
  credentials: true,
  exposedHeaders: [
    "Connect-Protocol-Version",
    "Connect-Timeout-Ms",
    "Grpc-Status",
    "Grpc-Message"
  ]
}
```

### Production CORS Configuration

For production, restrict origins to your application domains:

```bash
CONNECT_CORS_ENABLED=true
CONNECT_CORS_ORIGINS=https://app.example.com,https://admin.example.com
CONNECT_CORS_METHODS=GET,POST
CONNECT_CORS_HEADERS=Content-Type,Authorization,Connect-Protocol-Version
CONNECT_CORS_CREDENTIALS=true
```

### CORS Headers

Wishmock automatically handles these CORS headers:

**Request Headers**:
- `Content-Type` - Request content type
- `Connect-Protocol-Version` - Connect protocol version
- `Connect-Timeout-Ms` - Request timeout
- `X-User-Agent` - Client user agent
- `X-Grpc-Web` - gRPC-Web indicator
- `Authorization` - Authentication token

**Response Headers**:
- `Access-Control-Allow-Origin` - Allowed origin
- `Access-Control-Allow-Methods` - Allowed methods
- `Access-Control-Allow-Headers` - Allowed headers
- `Access-Control-Expose-Headers` - Exposed headers
- `Access-Control-Allow-Credentials` - Credentials allowed

### Preflight Requests

Wishmock automatically handles OPTIONS preflight requests for CORS:

```bash
curl -X OPTIONS http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"
```

Response:
```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
```

## TLS Configuration

### Enable TLS for Connect RPC

To secure Connect RPC with TLS:

```bash
CONNECT_TLS_ENABLED=true
CONNECT_TLS_CERT_PATH=./certs/server.crt
CONNECT_TLS_KEY_PATH=./certs/server.key
CONNECT_TLS_CA_PATH=./certs/ca.crt  # Optional, for mutual TLS
```

### Generate Self-Signed Certificates

For development, generate self-signed certificates:

```bash
# Generate CA
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 365 -key ca.key -out ca.crt \
  -subj "/CN=Wishmock CA"

# Generate server certificate
openssl genrsa -out server.key 4096
openssl req -new -key server.key -out server.csr \
  -subj "/CN=localhost"
openssl x509 -req -days 365 -in server.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt
```

Or use the provided script:

```bash
bun run scripts/generate-trusted-cert.sh
```

### Client Configuration with TLS

**Browser (with self-signed cert)**:
```javascript
const transport = createConnectTransport({
  baseUrl: "https://localhost:50052",
  // Browser will show security warning for self-signed certs
});
```

**Node.js (with self-signed cert)**:
```javascript
import { createConnectTransport } from "@connectrpc/connect-node";
import https from "https";
import fs from "fs";

const agent = new https.Agent({
  ca: fs.readFileSync("./certs/ca.crt"),
  rejectUnauthorized: true,
});

const transport = createConnectTransport({
  baseUrl: "https://localhost:50052",
  httpVersion: "2",
  nodeOptions: { agent },
});
```

**Development (skip verification)**:
```javascript
const agent = new https.Agent({
  rejectUnauthorized: false, // Only for development!
});
```

### Mutual TLS (mTLS)

For mutual TLS authentication:

```bash
CONNECT_TLS_ENABLED=true
CONNECT_TLS_CERT_PATH=./certs/server.crt
CONNECT_TLS_KEY_PATH=./certs/server.key
CONNECT_TLS_CA_PATH=./certs/ca.crt
CONNECT_TLS_REQUEST_CERT=true
CONNECT_TLS_REJECT_UNAUTHORIZED=true
```

Client configuration:
```javascript
const agent = new https.Agent({
  ca: fs.readFileSync("./certs/ca.crt"),
  cert: fs.readFileSync("./certs/client.crt"),
  key: fs.readFileSync("./certs/client.key"),
});
```

## Streaming Support

Connect RPC supports all four streaming patterns with the same rule-based mocking as unary RPCs.

### Unary RPC

Single request, single response.

**Client**:
```javascript
const response = await client.sayHello({ name: "World" });
```

**Rule** (`helloworld.greeter.sayhello.yaml`):
```yaml
match:
  request: {}
responses:
  - when:
      request.name: "World"
    body:
      message: "Hello, World!"
```

### Server Streaming

Single request, stream of responses.

**Client**:
```javascript
for await (const event of client.watchEvents({ topic: "news" })) {
  console.log(event.message);
}
```

**Rule** (`streaming.streamservice.watchevents.yaml`):
```yaml
match:
  request: {}
responses:
  - when:
      request.topic: "news"
    stream_items:
      - event: "Breaking news 1"
        timestamp: "2024-01-01T00:00:00Z"
      - event: "Breaking news 2"
        timestamp: "2024-01-01T00:01:00Z"
      - event: "Breaking news 3"
        timestamp: "2024-01-01T00:02:00Z"
```

### Client Streaming

Stream of requests, single response.

**Client**:
```javascript
async function* generateMessages() {
  yield { content: "Message 1" };
  yield { content: "Message 2" };
  yield { content: "Message 3" };
}

const response = await client.uploadMessages(generateMessages());
console.log(response.count); // 3
```

**Rule** (`streaming.streamservice.uploadmessages.yaml`):
```yaml
match:
  request: {}
responses:
  - body:
      count: 3
      status: "Received all messages"
```

### Bidirectional Streaming

Stream of requests and responses.

**Client**:
```javascript
async function* generateRequests() {
  yield { query: "Hello" };
  yield { query: "How are you?" };
}

for await (const response of client.chat(generateRequests())) {
  console.log(response.reply);
}
```

**Rule** (`streaming.streamservice.chat.yaml`):
```yaml
match:
  request: {}
responses:
  - stream_items:
      - reply: "Hi there!"
      - reply: "I'm doing great, thanks!"
```

## Rule Matching

Rules work identically across all three protocols (Connect, gRPC-Web, gRPC) because both servers use the same shared rule matching logic. When you define a rule, it automatically works for all protocols without any protocol-specific configuration.

### Field Access Syntax

**In `match` block** (nested object format):
```yaml
match:
  metadata:
    authorization: "Bearer token"  # Direct key (no "metadata." prefix)
  request:
    user.age: { gte: 18 }  # Dot notation for nested fields
```

**In `when` block** (dot notation format):
```yaml
responses:
  - when:
      metadata.authorization: "Bearer token"  # With "metadata." prefix
      request.user.id: 123  # With "request." prefix
```

### Rule File Naming

```
rules/grpc/{package}.{service}.{method}.yaml
```

Example: `helloworld.greeter.sayhello.yaml`

### Rule Structure

```yaml
- when:
    metadata:
      authorization: "Bearer token123"
    request:
      name: "Alice"
  response:
    message: "Hello, Alice!"
  priority: 10

- when:
    request:
      name:
        $regex: "^B.*"
  response:
    message: "Hello, B-person!"
  priority: 5

- response:
    message: "Hello, stranger!"
  priority: 1
```

### Metadata Extraction

Connect RPC extracts metadata from HTTP headers:

**Connect Protocol**:
- Standard headers: `authorization`, `user-agent`, etc.
- Custom headers: Any header is available in metadata

**gRPC-Web**:
- Headers prefixed with `x-grpc-`: `x-grpc-authorization`
- Standard gRPC metadata conventions

**Native gRPC**:
- Standard gRPC metadata

### Request Matching

All request fields are available for matching:

```yaml
match:
  request: {}
responses:
  - when:
      request.user.id: 123
      request.user.name: "Alice"
      request.filters.status: "active"
    body:
      results: [...]
```

Operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$regex`, `$exists`

See `README.md` for complete rule syntax.

## Validation

Validation works seamlessly with Connect RPC using the same shared validation engine. Both native gRPC and Connect RPC servers validate requests using identical logic, ensuring consistent validation behavior across all protocols.

### Enable Validation

```bash
VALIDATION_ENABLED=true
VALIDATION_SOURCE=auto  # auto, pgv, or protovalidate
```

### Validation Errors

Invalid requests return appropriate error codes:

**Connect Protocol**:
```json
{
  "code": "invalid_argument",
  "message": "Validation failed: name is required"
}
```

**gRPC-Web**:
```
grpc-status: 3
grpc-message: Validation failed: name is required
```

**Native gRPC**:
```
Status: INVALID_ARGUMENT
Message: Validation failed: name is required
```

### Example

**Proto with validation**:
```protobuf
message SayHelloRequest {
  string name = 1 [(validate.rules).string = {
    min_len: 1
    max_len: 100
  }];
}
```

**Invalid request**:
```bash
curl -X POST http://localhost:8080/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name": ""}'
```

**Response**:
```json
{
  "code": "invalid_argument",
  "message": "Validation failed",
  "details": [
    {
      "field": "name",
      "message": "value length must be at least 1 characters"
    }
  ]
}
```

## Reflection

Connect RPC supports service reflection for dynamic service discovery.

### Query Available Services

**Using grpcurl**:
```bash
grpcurl -plaintext localhost:8080 list
```

**Using Connect client**:
```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { ServerReflection } from "@connectrpc/connect/protocol";

const transport = createConnectTransport({
  baseUrl: "http://localhost:8080",
});

const client = createPromiseClient(ServerReflection, transport);
const response = await client.serverReflectionInfo();
```

### Describe Service

```bash
grpcurl -plaintext localhost:50052 describe helloworld.Greeter
```

Output:
```
helloworld.Greeter is a service:
service Greeter {
  rpc SayHello ( .helloworld.HelloRequest ) returns ( .helloworld.HelloReply );
}
```

## Monitoring

### Admin API Status

Check Connect RPC status via Admin API:

```bash
curl http://localhost:4319/admin/status
```

Response includes Connect RPC metrics alongside native gRPC metrics and shared metrics (validation, rule matching):
```json
{
  "connect_rpc": {
    "enabled": true,
    "port": 50052,
    "cors_enabled": true,
    "tls_enabled": false,
    "requests_total": 1234,
    "requests_by_protocol": {
      "connect": 800,
      "grpc_web": 300,
      "grpc": 134
    },
    "errors_total": 5
  },
  "grpc": {
    "plaintext_port": 50050,
    "tls_port": 50051,
    "requests_total": 2000,
    "errors_total": 10
  },
  "shared_metrics": {
    "validation_checks": 3234,
    "validation_failures": 15,
    "rule_matches": 3219,
    "rule_misses": 0
  }
}
```

The `shared_metrics` section shows metrics that apply to both servers, reflecting the unified architecture where validation and rule matching are shared across all protocols.

### Health Check

```bash
curl http://localhost:50052/connect/health
```

Response:
```json
{
  "status": "serving"
}
```

## Error Handling

### Error Codes

Connect RPC uses standard error codes that map to gRPC status codes:

| Connect Code | gRPC Status | HTTP Status | Description |
|--------------|-------------|-------------|-------------|
| `canceled` | CANCELLED | 499 | Request cancelled |
| `unknown` | UNKNOWN | 500 | Unknown error |
| `invalid_argument` | INVALID_ARGUMENT | 400 | Invalid request |
| `deadline_exceeded` | DEADLINE_EXCEEDED | 504 | Timeout |
| `not_found` | NOT_FOUND | 404 | Not found |
| `already_exists` | ALREADY_EXISTS | 409 | Already exists |
| `permission_denied` | PERMISSION_DENIED | 403 | Permission denied |
| `resource_exhausted` | RESOURCE_EXHAUSTED | 429 | Rate limited |
| `failed_precondition` | FAILED_PRECONDITION | 400 | Precondition failed |
| `aborted` | ABORTED | 409 | Aborted |
| `out_of_range` | OUT_OF_RANGE | 400 | Out of range |
| `unimplemented` | UNIMPLEMENTED | 501 | Not implemented |
| `internal` | INTERNAL | 500 | Internal error |
| `unavailable` | UNAVAILABLE | 503 | Service unavailable |
| `data_loss` | DATA_LOSS | 500 | Data loss |
| `unauthenticated` | UNAUTHENTICATED | 401 | Unauthenticated |

### Common Errors

**No rule matched**:
```json
{
  "code": "unimplemented",
  "message": "No rule matched for helloworld.Greeter/SayHello"
}
```

**Validation failed**:
```json
{
  "code": "invalid_argument",
  "message": "Validation failed: name is required"
}
```

**Service not found**:
```json
{
  "code": "unimplemented",
  "message": "Service helloworld.Unknown not found"
}
```

## Performance

### Benchmarks

Connect RPC performance is comparable to native gRPC:

| Protocol | Throughput | Latency (p50) | Latency (p99) |
|----------|------------|---------------|---------------|
| Connect (binary) | ~95% of gRPC | +0.5ms | +1ms |
| Connect (JSON) | ~70% of gRPC | +2ms | +5ms |
| gRPC-Web | ~90% of gRPC | +1ms | +2ms |
| Native gRPC | Baseline | Baseline | Baseline |

### Optimization Tips

1. **Use HTTP/2** - Better multiplexing and connection reuse
2. **Use binary format** - Smaller payloads than JSON
3. **Enable compression** - Reduce bandwidth usage
4. **Connection pooling** - Reuse connections across requests
5. **Batch requests** - Use streaming for multiple operations

## Troubleshooting

### Connect RPC not starting

**Check configuration**:
```bash
curl http://localhost:4319/admin/status | jq '.connect'
```

**Verify environment**:
```bash
echo $CONNECT_ENABLED
echo $CONNECT_PORT
```

### CORS errors in browser

**Check CORS configuration**:
```bash
curl -I -X OPTIONS http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Origin: http://localhost:3000"
```

**Enable CORS**:
```bash
CONNECT_CORS_ENABLED=true
CONNECT_CORS_ORIGINS=http://localhost:3000
```

### TLS certificate errors

**Verify certificate**:
```bash
openssl s_client -connect localhost:50052 -showcerts
```

**Check paths**:
```bash
ls -la $CONNECT_TLS_CERT_PATH
ls -la $CONNECT_TLS_KEY_PATH
```

### Service not found

**List available services**:
```bash
grpcurl -plaintext localhost:50052 list
```

**Check proto loading**:
```bash
curl http://localhost:4319/admin/status | jq '.protos'
```

### No rule matched

**Verify rule file exists**:
```bash
ls -la rules/grpc/helloworld.greeter.sayhello.yaml
```

**Check rule syntax**:
```bash
cat rules/grpc/helloworld.greeter.sayhello.yaml
```

**Test rule matching**:
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name": "World"}' -v
```

## Examples

Complete examples are available in the repository:

### Connect Client Examples

**Location**: `examples/connect-client/`

- `browser.html` - Browser-based Connect client
- `node.mjs` - Node.js Connect client
- `README.md` - Setup instructions

**Run**:
```bash
cd examples/connect-client
./setup.sh
open browser.html
```

### gRPC-Web Examples

**Location**: `examples/grpc-web-connect/`

- `browser.html` - Browser-based gRPC-Web client
- `node.mjs` - Node.js gRPC-Web client
- `README.md` - Setup instructions

**Run**:
```bash
cd examples/grpc-web-connect
./setup.sh
open browser.html
```

### Integration Tests

**Location**: `scripts/test-connect-integration.sh`

Tests all three protocols:
```bash
bun run scripts/test-connect-integration.sh
```

## Migration from Envoy

If you're currently using Envoy proxy for gRPC-Web support, see the [Connect Migration Guide](./connect-migration-guide.md) for detailed migration instructions.

## Additional Resources

- [Wishmock Architecture](./architecture.md) - Detailed design of shared infrastructure
- [Connect RPC Documentation](https://connectrpc.com/docs/)
- [Connect Protocol Specification](https://connectrpc.com/docs/protocol)
- [Wishmock README](../README.md)
- [Wishmock API Documentation](../API.md)
- [Validation Documentation](./protovalidate-validation.md)

## Support

For issues or questions:
- GitHub Issues: [wishmock/issues](https://github.com/your-org/wishmock/issues)
- Documentation: [docs/](../docs/)
- Examples: [examples/](../examples/)

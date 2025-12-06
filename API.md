# Admin API Endpoints

## Proto Files

### List Proto Files
```
GET /admin/protos
```
Returns list of available proto files.

Response:
```json
{
  "files": [
    { "filename": "helloworld.proto", "path": "/path/to/protos/helloworld.proto" }
  ]
}
```

### Get Proto File Content
```
GET /admin/proto/:filename
```
Returns content of a specific proto file.

Response:
```json
{
  "filename": "helloworld.proto",
  "content": "syntax = \"proto3\";\n..."
}
```

### Update Proto File
```
PUT /admin/proto/:filename
Content-Type: application/json

{
  "content": "syntax = \"proto3\";\n..."
}
```

### Upload Proto File To Path
```
POST /admin/upload/proto/path
Content-Type: application/json

{
  "path": "common/types.proto",
  "content": "syntax = \"proto3\";\n..."
}
```
Saves the file under `protos/common/types.proto`. The `path` must be relative to the `protos/` root and must not contain path traversal ("..") or be absolute.

## Rule Files (gRPC)

### List Rule Files
```
GET /admin/rules/grpc
```
Returns list of available rule files.

Response:
```json
{
  "files": [
    { "filename": "helloworld.greeter.sayhello.yaml", "path": "/path/to/rules/grpc/..." }
  ]
}
```

### Get Rule File Content
```
GET /admin/rule/grpc/:filename
```
Returns content of a specific rule file.

Response:
```json
{
  "filename": "helloworld.greeter.sayhello.yaml",
  "content": "responses:\n  - body:\n..."
}
```

### Update Rule File
```
PUT /admin/rule/grpc/:filename
Content-Type: application/json

{
  "content": "responses:\n  - body:\n..."
}
```

## Server Status and Services

### Get Server Status
```
GET /admin/status
```
Returns comprehensive server status including gRPC ports, Connect RPC status, loaded services, and rules.

Response:
```json
{
  "grpc_port": 50050,
  "grpc_ports": {
    "plaintext": 50050,
    "tls": 50051,
    "tls_enabled": true,
    "mtls": false,
    "tls_error": null
  },
  "connect_rpc": {
    "enabled": true,
    "port": 50052,
    "cors_enabled": true,
    "cors_origins": ["*"],
    "tls_enabled": false,
    "error": null,
    "services": ["helloworld.Greeter", "calendar.CalendarService"],
    "metrics": {
      "requests_total": 100,
      "requests_by_protocol": {
        "connect": 50,
        "grpc_web": 30,
        "grpc": 20
      },
      "errors_total": 5
    }
  },
  "loaded_services": ["helloworld.Greeter", "calendar.CalendarService"],
  "rules": ["helloworld.greeter.sayhello"],
  "protos": {
    "loaded": ["helloworld.proto", "calendar.proto"],
    "skipped": []
  }
}
```

**Connect RPC Status Fields:**
- `enabled` - Whether Connect RPC server is running
- `port` - Port number for Connect RPC (only present when enabled)
- `cors_enabled` - Whether CORS is enabled for browser clients
- `cors_origins` - List of allowed CORS origins (only present when CORS enabled)
- `tls_enabled` - Whether TLS is enabled for Connect RPC
- `error` - Error message if Connect RPC failed to start (null if no error)
- `services` - List of services registered with Connect RPC
- `metrics` - Request metrics (only present when server is running)
  - `requests_total` - Total number of RPC requests processed
  - `requests_by_protocol` - Breakdown by protocol (connect, grpc_web, grpc)
  - `errors_total` - Total number of errors

## Connect RPC Endpoints

Connect RPC provides HTTP endpoints for all loaded gRPC services. The server supports three protocols simultaneously on the same port (default: 50052):

### Protocol Support

**1. Connect Protocol**
- Content-Type: `application/json` or `application/proto`
- Endpoint format: `POST http://localhost:50052/package.Service/Method`
- Native browser support with fetch API
- HTTP/1.1 and HTTP/2 compatible

**2. gRPC-Web Protocol**
- Content-Type: `application/grpc-web+proto` or `application/grpc-web-text`
- Endpoint format: `POST http://localhost:50052/package.Service/Method`
- Compatible with gRPC-Web clients
- Browser-compatible without proxy

**3. gRPC Protocol**
- Content-Type: `application/grpc+proto`
- Endpoint format: `POST http://localhost:50052/package.Service/Method`
- Full gRPC compatibility over HTTP/2
- Works with standard gRPC clients

### Configuration

Enable and configure Connect RPC via environment variables:

```bash
CONNECT_ENABLED=true              # Enable Connect RPC (default: true)
CONNECT_PORT=50052                # HTTP port (default: 50052)
CONNECT_CORS_ENABLED=true         # Enable CORS (default: true)
CONNECT_CORS_ORIGINS=*            # Allowed origins (default: *)
CONNECT_TLS_ENABLED=false         # Enable TLS (default: false)
```

### Example Requests

**Connect Protocol (JSON):**
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name":"World"}'
```

Response:
```json
{
  "message": "Hello, World!"
}
```

**Connect Protocol (Binary):**
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/proto" \
  --data-binary @request.bin \
  -o response.bin
```

**With Metadata Headers:**
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token123" \
  -H "X-User-Id: user456" \
  -d '{"name":"World"}'
```

**Server Streaming:**
```bash
curl -X POST http://localhost:50052/streaming.StreamService/GetMessages \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user123"}' \
  --no-buffer
```

### CORS Support

When `CONNECT_CORS_ENABLED=true`, the server handles preflight requests:

```bash
# Preflight request
curl -X OPTIONS http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v
```

Response includes:
- `Access-Control-Allow-Origin: http://localhost:3000`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, ...`
- `Access-Control-Expose-Headers: Connect-Protocol-Version, Grpc-Status, ...`
- `Access-Control-Max-Age: 86400`

**Allowed Headers:**
- `Content-Type`, `Authorization`
- `Connect-Protocol-Version`, `Connect-Timeout-Ms`
- `X-User-Agent`, `X-Grpc-Web`
- Custom headers (when CORS origins configured)

**Exposed Headers:**
- `Connect-Protocol-Version`, `Connect-Timeout-Ms`
- `Grpc-Status`, `Grpc-Message`
- Custom trailing metadata

### Error Responses

Connect RPC errors follow the Connect protocol specification:

**Validation Error:**
```json
{
  "code": "invalid_argument",
  "message": "Validation failed: name is required",
  "details": [
    {
      "type": "buf.validate.Violation",
      "value": {
        "field": "name",
        "message": "value is required"
      }
    }
  ]
}
```

**No Rule Matched:**
```json
{
  "code": "unimplemented",
  "message": "No rule matched for helloworld.Greeter/SayHello"
}
```

**Service Not Found:**
```json
{
  "code": "unimplemented",
  "message": "Service helloworld.Unknown not found"
}
```

**Error Code Mapping:**

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

### Streaming Support

Connect RPC supports all four streaming patterns:

**Unary:** Single request → Single response
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name":"World"}'
```

**Server Streaming:** Single request → Stream of responses
```bash
curl -X POST http://localhost:50052/streaming.StreamService/GetMessages \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user123"}' \
  --no-buffer
```

**Client Streaming:** Stream of requests → Single response
- Requires streaming client library (not supported via curl)

**Bidirectional Streaming:** Stream of requests ↔ Stream of responses
- Requires streaming client library (not supported via curl)

For streaming examples with client libraries, see [docs/connect-rpc-support.md](docs/connect-rpc-support.md).

### Client Examples

**Browser (Connect Protocol):**
```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

const transport = createConnectTransport({
  baseUrl: "http://localhost:50052",
});

const client = createPromiseClient(Greeter, transport);
const response = await client.sayHello({ name: "World" });
```

**Node.js (Connect Protocol):**
```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

const transport = createConnectTransport({
  baseUrl: "http://localhost:50052",
  httpVersion: "2",
});

const client = createPromiseClient(Greeter, transport);
const response = await client.sayHello({ name: "World" });
```

**Browser (gRPC-Web):**
```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

const transport = createGrpcWebTransport({
  baseUrl: "http://localhost:50052",
});

const client = createPromiseClient(Greeter, transport);
const response = await client.sayHello({ name: "World" });
```

For complete Connect RPC documentation including TLS configuration, validation, reflection, and migration guides, see [docs/connect-rpc-support.md](docs/connect-rpc-support.md).

### List Services
```
GET /admin/services
```
Returns list of all loaded gRPC services with their methods.

Response:
```json
{
  "services": [
    {
      "name": "helloworld.Greeter",
      "package": "helloworld",
      "service": "Greeter",
      "methods": [
        {
          "name": "SayHello",
          "full_method": "helloworld.Greeter/SayHello",
          "rule_key": "helloworld.greeter.sayhello",
          "request_type": "HelloRequest",
          "response_type": "HelloReply",
          "request_stream": false,
          "response_stream": false
        }
      ]
    }
  ]
}
```
- `GET /admin/schema/:typeName` - Get message schema
- `POST /admin/upload/proto` - Upload proto file
- `POST /admin/upload/rule/grpc` - Upload gRPC rule file

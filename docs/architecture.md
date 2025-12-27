# Wishmock Architecture

## Overview

Wishmock is a protocol-agnostic mock server for gRPC and Connect RPC that provides rule-based response mocking with validation support. The architecture is designed around a shared core that ensures consistent behavior across all supported protocols (native gRPC, Connect RPC, gRPC-Web).

### Key Design Principles

1. **Protocol Agnostic Core**: Business logic (validation, rule matching, response selection) is independent of protocol specifics
2. **Shared State**: Single source of truth for protobuf definitions, rules, and validation runtime
3. **Coordinated Lifecycle**: Synchronized startup, reload, and shutdown across all servers
4. **Clear Separation**: Protocol-specific code isolated in adapters, core logic remains protocol-free
5. **Backward Compatibility**: No breaking changes to existing gRPC functionality

### Supported Protocols

- **Native gRPC** (via @grpc/grpc-js): Traditional gRPC over HTTP/2
- **Connect RPC**: Modern RPC protocol with JSON and binary support
- **gRPC-Web**: Browser-compatible gRPC protocol
- **gRPC over HTTP/1.1**: Connect's gRPC compatibility mode

All protocols share the same rule matching, validation, and response selection logic, ensuring consistent behavior regardless of how clients connect.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Wishmock Application                       │
│                          (src/app.ts)                           │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   Shared Core Logic                        │ │
│  │                  (src/domain/usecases/)                    │ │
│  │                                                            │ │
│  │  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐   │ │
│  │  │ Request      │  │  Validation     │  │  Response    │   │ │
│  │  │ Handlers     │  │  Runtime        │  │  Selector    │   │ │
│  │  │              │  │                 │  │              │   │ │
│  │  │ - Unary      │  │ - PGV           │  │ - Rule Match │   │ │
│  │  │ - Server     │  │ - Protovalidate │  │ - Template   │   │ │
│  │  │   Streaming  │  │ - CEL           │  │   Engine     │   │ │
│  │  │ - Client     │  │                 │  │              │   │ │
│  │  │   Streaming  │  │                 │  │              │   │ │
│  │  │ - Bidi       │  │                 │  │              │   │ │
│  │  │   Streaming  │  │                 │  │              │   │ │
│  │  └──────────────┘  └─────────────────┘  └──────────────┘   │ │
│  │                                                            │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │ │
│  │  │ Proto Root   │  │ Rules Index  │  │ Shared Metrics  │   │ │
│  │  │ (Shared)     │  │ (Shared)     │  │ (Shared)        │   │ │
│  │  │              │  │              │  │                 │   │ │
│  │  │ - Services   │  │ - Rule Docs  │  │ - Validation    │   │ │
│  │  │ - Messages   │  │ - Matchers   │  │ - Rule Matches  │   │ │
│  │  │ - Types      │  │              │  │                 │   │ │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                          │                                      │
│           ┌──────────────┴──────────────┐                       │
│           │                             │                       │
│  ┌────────▼────────┐          ┌─────────▼────────┐              │
│  │ gRPC Protocol   │          │ Connect Protocol │              │
│  │ Adapter         │          │ Adapter          │              │
│  │ (protocolAdapter)│         │ (protocolAdapter)│              │
│  │                 │          │                  │              │
│  │ - Metadata      │          │ - Metadata       │              │
│  │   extraction    │          │   extraction     │              │
│  │ - Error mapping │          │ - Error mapping  │              │
│  │ - Streaming     │          │ - Streaming      │              │
│  │   conversion    │          │   conversion     │              │
│  └─────────────────┘          └──────────────────┘              │
│           │                             │                       │
│  ┌────────▼────────┐          ┌─────────▼────────┐              │
│  │ Native gRPC     │          │ Connect RPC      │              │
│  │ Server          │          │ Server           │              │
│  │ (grpcServer.ts) │          │ (connectServer.ts)│             │
│  │                 │          │                  │              │
│  │ Port: 50050     │          │ Port: 50052      │              │
│  │ (plaintext)     │          │                  │              │
│  │ Port: 50051     │          │ Protocols:       │              │
│  │ (TLS/mTLS)      │          │ - Connect        │              │
│  │                 │          │ - gRPC-Web       │              │
│  │                 │          │ - gRPC           │              │
│  └─────────────────┘          └──────────────────┘              │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Admin HTTP API                          │ │
│  │                  (interfaces/httpAdmin.ts)                 │ │
│  │                                                            │ │
│  │  Port: 4319                                                │ │
│  │  - Status & Metrics    - Proto Upload    - Rule Management │ │
│  │  - Service Discovery   - Reload Trigger  - Web UI          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Shared Request Handlers

**Location**: `src/domain/usecases/handleRequest.ts`

The shared request handlers provide protocol-agnostic request processing logic that is used by both gRPC and Connect RPC servers.


#### Key Functions

- **`handleUnaryRequest()`**: Processes single request/response RPCs
  - Validates request using validation runtime
  - Matches rule from rules index
  - Selects response using selectResponse
  - Returns normalized response or error

- **`handleServerStreamingRequest()`**: Processes server streaming RPCs
  - Validates initial request
  - Matches rule and extracts streaming configuration
  - Yields multiple responses based on `stream_items`
  - Supports `stream_loop`, `stream_random_order`, `stream_delay_ms`

- **`handleClientStreamingRequest()`**: Processes client streaming RPCs
  - Collects all incoming requests
  - Validates each request (based on validation mode)
  - Aggregates requests into single request object
  - Returns single response

- **`handleBidiStreamingRequest()`**: Processes bidirectional streaming RPCs
  - Collects all incoming requests
  - Validates each request (based on validation mode)
  - Aggregates requests and yields multiple responses
  - Combines client and server streaming logic

#### Request Processing Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Request Processing                       │
│                                                             │
│  1. Normalize Request                                       │
│     ├─ Extract metadata from protocol-specific format       │
│     ├─ Parse request data (JSON or binary)                  │
│     └─ Create NormalizedRequest                             │
│                                                             │
│  2. Validate Request                                        │
│     ├─ Check if validation is active                        │
│     ├─ Get validator for message type                       │
│     ├─ Run validation (PGV or protovalidate)                │
│     ├─ Track metrics (success/failure)                      │
│     └─ Return error if validation fails                     │
│                                                             │
│  3. Match Rule                                              │
│     ├─ Build rule key (service.method)                      │
│     ├─ Lookup rule in rules index                           │
│     ├─ Track metrics (match/miss)                           │
│     └─ Return error if no rule matches                      │
│                                                             │
│  4. Select Response                                         │
│     ├─ Evaluate rule conditions (when, priority)            │
│     ├─ Apply template engine (Handlebars)                   │
│     ├─ Extract response data and metadata                   │
│     └─ Check for error response (grpc-status trailer)       │
│                                                             │
│  5. Return Response                                         │
│     ├─ Create NormalizedResponse                            │
│     ├─ Include data, metadata, trailer                      │
│     └─ Protocol adapter converts to protocol format         │
└─────────────────────────────────────────────────────────────┘
```


### 2. Protocol Adapters

**Location**: `src/infrastructure/protocolAdapter.ts`

Protocol adapters handle the conversion between protocol-specific formats and Wishmock's normalized internal format. They isolate protocol-specific concerns from the core business logic.

#### Normalized Request Format

```typescript
interface NormalizedRequest {
  service: string;           // e.g., "helloworld.Greeter"
  method: string;            // e.g., "SayHello"
  metadata: Record<string, string>;  // Headers/metadata
  data: any;                 // Parsed protobuf message
  requestType: protobuf.Type;
  responseType: protobuf.Type;
  requestStream: boolean;
  responseStream: boolean;
}
```

#### Normalized Response Format

```typescript
interface NormalizedResponse {
  data: any;                 // Protobuf message to send
  metadata?: Record<string, string>;  // Initial metadata
  trailer?: Record<string, string>;   // Trailing metadata
}
```

#### Normalized Error Format

```typescript
interface NormalizedError {
  code: string;              // e.g., "INVALID_ARGUMENT", "NOT_FOUND"
  message: string;
  details?: any[];           // Protocol-specific error details
}
```

#### gRPC Protocol Adapter

**Request Normalization**:
- `normalizeGrpcRequest()`: Generic function for all streaming patterns
- `normalizeGrpcUnaryRequest()`: Unary requests
- `normalizeGrpcServerStreamingRequest()`: Server streaming
- `normalizeGrpcClientStreamingRequest()`: Client streaming
- `normalizeGrpcBidiStreamingRequest()`: Bidirectional streaming
- `extractGrpcMetadata()`: Converts gRPC Metadata to record

**Response Conversion**:
- `sendGrpcResponse()`: Generic function for all streaming patterns
- `sendGrpcUnaryResponse()`: Send unary response via callback
- `sendGrpcServerStreamingResponse()`: Write to server stream
- `sendGrpcClientStreamingResponse()`: Send client streaming response
- `sendGrpcBidiStreamingResponse()`: Write to bidi stream
- `sendGrpcError()`: Generic error sending
- `mapNormalizedErrorCodeToGrpc()`: Maps error codes to gRPC status codes


#### Connect Protocol Adapter

**Request Normalization**:
- `normalizeConnectRequest()`: Generic function for all streaming patterns
- `normalizeConnectUnaryRequest()`: Unary requests
- `normalizeConnectServerStreamingRequest()`: Server streaming
- `normalizeConnectClientStreamingRequest()`: Client streaming
- `normalizeConnectBidiStreamingRequest()`: Bidirectional streaming
- `extractMetadata()`: Converts HTTP headers to metadata record
- `detectProtocol()`: Detects Connect/gRPC-Web/gRPC from headers

**Response Conversion**:
- `sendConnectResponse()`: Formats response for Connect protocol
- `sendConnectError()`: Formats error for Connect protocol
- `formatResponse()`: Converts data to protobuf format
- `mapNormalizedErrorCodeToConnect()`: Maps error codes to Connect error codes

**Legacy Functions** (for backward compatibility):
- `normalizeRequest()`: Original normalization function
- `mapValidationError()`: Maps validation errors
- `mapNoRuleMatchError()`: Maps rule matching errors
- `mapStreamingError()`: Maps streaming errors
- `mapGenericError()`: Maps generic errors

#### Error Code Mapping

Both adapters map normalized error codes to protocol-specific formats:

| Normalized Code | gRPC Status | Connect Code |
|----------------|-------------|--------------|
| OK | 0 | ok |
| CANCELLED | 1 | canceled |
| UNKNOWN | 2 | unknown |
| INVALID_ARGUMENT | 3 | invalid_argument |
| DEADLINE_EXCEEDED | 4 | deadline_exceeded |
| NOT_FOUND | 5 | not_found |
| ALREADY_EXISTS | 6 | already_exists |
| PERMISSION_DENIED | 7 | permission_denied |
| RESOURCE_EXHAUSTED | 8 | resource_exhausted |
| FAILED_PRECONDITION | 9 | failed_precondition |
| ABORTED | 10 | aborted |
| OUT_OF_RANGE | 11 | out_of_range |
| UNIMPLEMENTED | 12 | unimplemented |
| INTERNAL | 13 | internal |
| UNAVAILABLE | 14 | unavailable |
| DATA_LOSS | 15 | data_loss |
| UNAUTHENTICATED | 16 | unauthenticated |


### 3. Validation Runtime

**Location**: `src/infrastructure/validation/runtime.ts`

The validation runtime provides a unified interface for request validation using either PGV (protoc-gen-validate) or protovalidate (Buf's CEL-based validation).

#### Features

- **Multiple Validation Sources**: Supports PGV, protovalidate, or auto-detection
- **Message-Level CEL**: Experimental support for message-level CEL expressions
- **Streaming Validation Modes**: Per-message or aggregate validation for streams
- **Validation Events**: Emits events for success/failure for monitoring
- **Coverage Tracking**: Reports which message types have validation rules

#### Configuration

Environment variables:
- `VALIDATION_ENABLED`: Enable/disable validation (default: false)
- `VALIDATION_SOURCE`: `auto`, `pgv`, or `protovalidate` (default: auto)
- `VALIDATION_MODE`: `per_message` or `aggregate` for streaming (default: per_message)
- `VALIDATION_CEL_MESSAGE`: Enable message-level CEL (default: disabled)

#### Integration with Shared Handlers

The shared request handlers call the validation runtime before rule matching:

```typescript
// In handleUnaryRequest()
if (validationRuntime.active()) {
  const validator = validationRuntime.getValidator(requestType.fullName);
  if (validator) {
    const result = validator(data);
    if (!result.ok) {
      // Track metrics
      sharedMetrics.recordValidationCheck(typeName, false);
      
      // Return normalized error
      return {
        code: "INVALID_ARGUMENT",
        message: "Request validation failed",
        details: result.violations,
      };
    }
  }
}
```

### 4. Shared State

#### Proto Root

**Type**: `protobuf.Root`

The proto root is a single instance shared by both servers that contains:
- All loaded protobuf definitions
- Service definitions and methods
- Message types and field definitions
- Enum definitions

**Loading**: `src/infrastructure/protoLoader.ts`
- Scans `protos/` directory for `.proto` files
- Uses protobufjs to parse and load definitions
- Reports loaded and skipped files with error details


#### Rules Index

**Type**: `Map<string, RuleDoc>`

The rules index is a single map shared by both servers that contains:
- Rule key (lowercase `service.method`) → Rule document
- Rule documents with match conditions and response options
- Priority and conditional logic for response selection

**Loading**: `src/infrastructure/ruleLoader.ts`
- Scans `rules/grpc/` directory for YAML/JSON files
- Parses rule files and builds index
- Supports hot-reload when files change

**Rule Document Structure**:
```typescript
interface RuleDoc {
  service: string;
  method: string;
  options: ResponseOption[];
}

interface ResponseOption {
  when?: MatchCondition;
  priority?: number;
  body?: any;
  metadata?: Record<string, string>;
  trailers?: Record<string, string | number | boolean>;
  delay_ms?: number;
  stream_items?: any[];
  stream_delay_ms?: number;
  stream_loop?: boolean;
  stream_random_order?: boolean;
}
```

#### Shared Metrics

**Location**: `src/domain/metrics/sharedMetrics.ts`

Tracks metrics across both servers:
- **Validation Checks**: Total checks and failures by message type
- **Rule Matches**: Total attempts, matches, and misses by rule key

Exposed via Admin API `/admin/status` endpoint under `shared_metrics`.

### 5. Server Implementations

#### Native gRPC Server

**Location**: `src/infrastructure/grpcServer.ts`

**Features**:
- Plaintext server (port 50050)
- TLS/mTLS server (port 50051, optional)
- gRPC reflection support
- All four streaming patterns

**Handler Generation**:
```typescript
// For each method in proto root
const handler = async (call, callback) => {
  // 1. Normalize request
  const normalized = normalizeGrpcRequest(
    call, requestType, responseType, 
    service, method, requestStream, responseStream
  );
  
  // 2. Call shared handler
  const result = await handleUnaryRequest(normalized, rulesIndex, log);
  
  // 3. Send response
  if ('code' in result) {
    sendGrpcError(call, result, requestStream, responseStream, callback);
  } else {
    sendGrpcResponse(call, result, requestStream, responseStream, callback);
  }
};
```


#### Connect RPC Server

**Location**: `src/infrastructure/connectServer.ts`

**Features**:
- HTTP/1.1 and HTTP/2 support
- Three protocols: Connect, gRPC-Web, gRPC
- JSON and binary encoding
- CORS support for browser clients
- Optional TLS
- All four streaming patterns

**Service Registration**:
```typescript
// For each method in proto root
const handler = async (req, context) => {
  // 1. Normalize request
  const normalized = normalizeConnectRequest(
    req, requestType, responseType, context,
    service, method, requestStream, responseStream
  );
  
  // 2. Call shared handler
  const result = await handleUnaryRequest(normalized, rulesIndex, log);
  
  // 3. Send response
  if ('code' in result) {
    throw sendConnectError(result);
  } else {
    return sendConnectResponse(result, responseType, context);
  }
};
```

**Protocol Detection**:
- Automatically detects protocol from `Content-Type` header
- `application/connect+json` → Connect
- `application/grpc-web` → gRPC-Web
- `application/grpc` → gRPC
- `application/json` → Connect (fallback)

## Lifecycle Management

### Initialization Flow

**Location**: `src/app.ts` - `initializeServers()`

```
┌─────────────────────────────────────────────────────────────┐
│                  Server Initialization                      │
│                                                             │
│  1. Load Protos                                             │
│     ├─ Scan protos/ directory                               │
│     ├─ Parse .proto files with protobufjs                   │
│     ├─ Create shared Proto Root                             │
│     └─ Report loaded/skipped files                          │
│                                                             │
│  2. Load Rules                                              │
│     ├─ Scan rules/grpc/ directory                           │
│     ├─ Parse YAML/JSON rule files                           │
│     ├─ Build shared Rules Index                             │
│     └─ Report loaded rules count                            │
│                                                             │
│  3. Initialize Validation Runtime                           │
│     ├─ Load validation rules from Proto Root                │
│     ├─ Detect validation source (PGV/protovalidate)         │
│     └─ Build validator cache                                │
│                                                             │
│  4. Start Native gRPC Server (Plaintext)                    │
│     ├─ Build handlers using shared Proto Root & Rules       │
│     ├─ Bind to port 50050                                   │
│     └─ Enable reflection                                    │
│                                                             │
│  5. Start Native gRPC Server (TLS) [Optional]               │
│     ├─ Load TLS certificates                                │
│     ├─ Build handlers using shared Proto Root & Rules       │
│     ├─ Bind to port 50051                                   │
│     └─ Enable mTLS if configured                            │
│                                                             │
│  6. Start Connect RPC Server [Optional]                     │
│     ├─ Register services using shared Proto Root & Rules    │
│     ├─ Configure CORS if enabled                            │
│     ├─ Bind to port 50052                                   │
│     └─ Enable reflection                                    │
│                                                             │
│  7. Signal Ready                                            │
│     └─ Notify cluster master (if running in cluster mode)   │
└─────────────────────────────────────────────────────────────┘
```


### Coordinated Reload

**Location**: `src/app.ts` - `reloadServers()`

The reload process ensures atomic updates across all servers:

```
┌─────────────────────────────────────────────────────────────┐
│                    Coordinated Reload                       │
│                                                             │
│  1. Mark Not Ready                                          │
│     └─ Set rebuildInProgress = true                         │
│                                                             │
│  2. Shutdown All Servers                                    │
│     ├─ Stop gRPC server (plaintext)                         │
│     ├─ Stop gRPC server (TLS)                               │
│     └─ Stop Connect RPC server                              │
│                                                             │
│  3. Regenerate Descriptors                                  │
│     └─ Run generate-descriptors.mjs for reflection          │
│                                                             │
│  4. Reload Protos                                           │
│     ├─ Scan protos/ directory                               │
│     ├─ Parse .proto files                                   │
│     └─ Create new shared Proto Root                         │
│                                                             │
│  5. Reload Rules                                            │
│     ├─ Scan rules/grpc/ directory                           │
│     ├─ Parse rule files                                     │
│     └─ Update shared Rules Index                            │
│                                                             │
│  6. Reinitialize Validation Runtime                         │
│     └─ Load validation rules from new Proto Root            │
│                                                             │
│  7. Restart All Servers                                     │
│     ├─ Start gRPC server (plaintext) with new state         │
│     ├─ Start gRPC server (TLS) with new state               │
│     └─ Start Connect RPC server with new state              │
│                                                             │
│  8. Mark Ready                                              │
│     └─ Set rebuildInProgress = false                        │
└─────────────────────────────────────────────────────────────┘
```

**Triggers**:
- File watcher detects `.proto` file changes (if `HOT_RELOAD_PROTOS=true`)
- Admin API `/admin/reload` endpoint
- Cluster master sends reload signal

**Downtime**:
- Reload is not zero-downtime (servers stop before restarting)
- Typical reload time: 100-500ms depending on proto/rule count
- Downtime is tracked and reported in `/admin/status`


### Graceful Shutdown

**Location**: `src/app.ts` - `shutdownServers()`

The shutdown process ensures clean resource cleanup:

```
┌─────────────────────────────────────────────────────────────┐
│                    Graceful Shutdown                        │
│                                                             │
│  1. Stop gRPC Server (Plaintext)                            │
│     ├─ Call server.tryShutdown()                            │
│     ├─ Wait for in-flight requests to complete              │
│     └─ Log success or error                                 │
│                                                             │
│  2. Stop gRPC Server (TLS)                                  │
│     ├─ Call server.tryShutdown()                            │
│     ├─ Wait for in-flight requests to complete              │
│     └─ Log success or error                                 │
│                                                             │
│  3. Stop Connect RPC Server                                 │
│     ├─ Call connectServer.stop()                            │
│     ├─ Close HTTP server                                    │
│     ├─ Wait for in-flight requests to complete              │
│     └─ Log success or error                                 │
│                                                             │
│  4. Clear State                                             │
│     ├─ Set server references to null                        │
│     └─ Clear enabled flags                                  │
│                                                             │
│  5. Report Status                                           │
│     └─ Log success or errors encountered                    │
└─────────────────────────────────────────────────────────────┘
```

**Triggers**:
- `SIGTERM` signal (Docker/Kubernetes shutdown)
- `SIGINT` signal (Ctrl+C)
- Cluster worker disconnect
- Process exit

**Error Handling**:
- Errors during shutdown are logged but don't prevent other servers from stopping
- All errors are collected and reported at the end
- Process exits with code 0 even if some shutdowns fail

### Hot Reload

**File Watchers**:
- **Proto Watcher**: Watches `protos/` directory for `.proto` file changes
  - Triggers full server reload (protos + rules + validation)
  - Can be disabled with `HOT_RELOAD_PROTOS=false`
  - Automatically disabled in cluster mode (use rolling restart instead)

- **Rule Watcher**: Watches `rules/grpc/` directory for rule file changes
  - Triggers rule-only reload (no server restart)
  - Can be disabled with `HOT_RELOAD_RULES=false`
  - Enabled by default in all modes

**Cluster Mode**:
- In cluster mode, proto hot-reload is disabled by default
- Use Admin API `/admin/reload` to trigger rolling restart
- Master process coordinates reload across workers
- Zero-downtime reload via worker rotation


## Data Flow

### Unary Request Flow

```
┌──────────┐                                                    ┌──────────┐
│  Client  │                                                    │  Client  │
└────┬─────┘                                                    └────▲─────┘
     │                                                               │
     │ 1. Send Request                                               │ 8. Receive Response
     │                                                               │
     ▼                                                               │
┌──────────────────────────────────────────────────────────────────────────┐
│                         Protocol Layer                                   │
│  ┌──────────────────────┐               ┌──────────────────────┐         │
│  │  gRPC Server         │               │  Connect RPC Server  │         │
│  │  (grpcServer.ts)     │               │  (connectServer.ts)  │         │
│  └──────────┬───────────┘               └──────────┬───────────┘         │
└─────────────┼──────────────────────────────────────┼─────────────────────┘
              │                                      │
              │ 2. Extract metadata                  │ 2. Extract metadata
              │    Parse request data                │    Parse request data
              │                                      │
              ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      Protocol Adapter Layer                              │
│  ┌──────────────────────┐               ┌───────────────────────┐        │
│  │  normalizeGrpcRequest│               │normalizeConnectRequest│        │
│  │  (protocolAdapter.ts)│               │  (protocolAdapter.ts) │        │
│  └──────────┬───────────┘               └──────────┬────────────┘        │
└─────────────┼──────────────────────────────────────┼─────────────────────┘
              │                                      │
              │ 3. Create NormalizedRequest          │ 3. Create NormalizedRequest
              │                                      │
              └──────────────────┬───────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Shared Core Logic                               │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  handleUnaryRequest (handleRequest.ts)                    │          │
│  │                                                           │          │
│  │  4. Validate Request                                      │          │
│  │     ├─ validationRuntime.getValidator()                   │          │
│  │     ├─ validator(data)                                    │          │
│  │     └─ sharedMetrics.recordValidationCheck()              │          │
│  │                                                           │          │
│  │  5. Match Rule                                            │          │
│  │     ├─ rulesIndex.get(ruleKey)                            │          │
│  │     └─ sharedMetrics.recordRuleMatchAttempt()             │          │
│  │                                                           │          │
│  │  6. Select Response                                       │          │
│  │     ├─ selectResponse(rule, data, metadata)               │          │
│  │     ├─ Apply template engine                              │          │
│  │     └─ Extract response data and trailers                 │          │
│  │                                                           │          │
│  │  7. Return NormalizedResponse or NormalizedError          │          │
│  └─────────────────────────────┬─────────────────────────────┘          │
└────────────────────────────────┼────────────────────────────────────────┘
                                 │
              ┌──────────────────┴───────────────────┐
              │                                      │
              ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Protocol Adapter Layer                             │
│  ┌──────────────────────┐              ┌──────────────────────┐         │
│  │  sendGrpcResponse    │              │  sendConnectResponse │         │
│  │  (protocolAdapter.ts)│              │  (protocolAdapter.ts)│         │
│  └──────────┬───────────┘              └───────────┬──────────┘         │
└─────────────┼──────────────────────────────────────┼────────────────────┘
              │                                      │
              │ 8. Convert to protocol format        │ 8. Convert to protocol format
              │    Set metadata/trailers             │    Set headers/trailers
              │                                      │
              ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Protocol Layer                                  │
│  ┌──────────────────────┐              ┌──────────────────────┐         │
│  │  gRPC Server         │              │  Connect RPC Server  │         │
│  │  (grpcServer.ts)     │              │  (connectServer.ts)  │         │
│  └──────────────────────┘              └──────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```


### Server Streaming Flow

```
┌──────────┐                                                    ┌──────────┐
│  Client  │                                                    │  Client  │
└────┬─────┘                                                    └────▲─────┘
     │                                                               │
     │ 1. Send Request                                               │ 8. Receive Stream
     │                                                               │    (multiple messages)
     ▼                                                               │
┌─────────────────────────────────────────────────────────────────────────┐
│                      Shared Core Logic                                  │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  handleServerStreamingRequest (handleRequest.ts)          │          │
│  │                                                           │          │
│  │  2. Validate Request                                      │          │
│  │  3. Match Rule                                            │          │
│  │  4. Select Response                                       │          │
│  │     ├─ Extract stream_items configuration                 │          │
│  │     ├─ Extract stream_delay_ms                            │          │
│  │     ├─ Extract stream_loop flag                           │          │
│  │     └─ Extract stream_random_order flag                   │          │
│  │                                                           │          │
│  │  5. Yield Responses (async generator)                     │          │
│  │     ├─ Apply initial delay (delay_ms)                     │          │
│  │     ├─ Loop through stream_items                          │          │
│  │     ├─ Apply template engine to each item                 │          │
│  │     ├─ Yield NormalizedResponse                           │          │
│  │     ├─ Delay between items (stream_delay_ms)              │          │
│  │     └─ Repeat if stream_loop is true                      │          │
│  │                                                           │          │
│  │  6. Complete Stream                                       │          │
│  └───────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Client Streaming Flow

```
┌──────────┐                                                    ┌──────────┐
│  Client  │                                                    │  Client  │
└────┬─────┘                                                    └────▲─────┘
     │                                                               │
     │ 1. Send Stream                                                │ 7. Receive Response
     │    (multiple messages)                                        │
     ▼                                                               │
┌─────────────────────────────────────────────────────────────────────────┐
│                      Shared Core Logic                                  │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  handleClientStreamingRequest (handleRequest.ts)          │          │
│  │                                                           │          │
│  │  2. Collect All Requests                                  │          │
│  │     ├─ Iterate through async iterable                     │          │
│  │     ├─ Validate each message (per_message mode)           │          │
│  │     └─ Store in messages array                            │          │
│  │                                                           │          │
│  │  3. Validate Aggregate (aggregate mode)                   │          │
│  │     └─ Validate all collected messages                    │          │
│  │                                                           │          │
│  │  4. Build Aggregated Request                              │          │
│  │     ├─ stream: messages array                             │          │
│  │     ├─ items: messages array                              │          │
│  │     ├─ first: messages[0]                                 │          │
│  │     ├─ last: messages[length-1]                           │          │
│  │     └─ count: messages.length                             │          │
│  │                                                           │          │
│  │  5. Match Rule                                            │          │
│  │  6. Select Response                                       │          │
│  │  7. Return NormalizedResponse                             │          │
│  └───────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```


### Bidirectional Streaming Flow

```
┌──────────┐                                                    ┌──────────┐
│  Client  │                                                    │  Client  │
└────┬─────┘                                                    └────▲─────┘
     │                                                               │
     │ 1. Send Stream                                                │ 8. Receive Stream
     │    (multiple messages)                                        │    (multiple messages)
     ▼                                                               │
┌─────────────────────────────────────────────────────────────────────────┐
│                      Shared Core Logic                                  │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  handleBidiStreamingRequest (handleRequest.ts)            │          │
│  │                                                           │          │
│  │  2. Collect All Requests                                  │          │
│  │     ├─ Iterate through async iterable                     │          │
│  │     ├─ Validate each message (per_message mode)           │          │
│  │     └─ Store in messages array                            │          │
│  │                                                           │          │
│  │  3. Validate Aggregate (aggregate mode)                   │          │
│  │  4. Build Aggregated Request                              │          │
│  │  5. Match Rule                                            │          │
│  │  6. Select Response                                       │          │
│  │                                                           │          │
│  │  7. Yield Responses (async generator)                     │          │
│  │     ├─ Loop through stream_items                          │          │
│  │     ├─ Apply template engine to each item                 │          │
│  │     ├─ Yield NormalizedResponse                           │          │
│  │     ├─ Delay between items (stream_delay_ms)              │          │
│  │     └─ Repeat if stream_loop is true                      │          │
│  │                                                           │          │
│  │  8. Complete Stream                                       │          │
│  └───────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Admin API

**Location**: `src/interfaces/httpAdmin.ts`

The Admin API provides HTTP endpoints for monitoring, management, and file uploads.

### Key Endpoints

#### Status & Monitoring

- **`GET /admin/status`**: Server status and metrics
  - gRPC server status (plaintext and TLS)
  - Connect RPC server status and metrics
  - Loaded services and rules
  - Proto load status
  - Validation coverage
  - Shared metrics (validation, rule matching)
  - Reload history

- **`GET /admin/services`**: List all services and methods
  - Service discovery information
  - Method details (streaming patterns, types)
  - Rule key mapping

- **`GET /admin/schema/:typeName`**: Get protobuf schema
  - Message field definitions
  - Enum values
  - Oneof groups

#### Management

- **`POST /admin/reload`**: Trigger coordinated server reload
  - Reloads protos, rules, and validation
  - Restarts all servers with new state

#### File Upload

- **`POST /admin/upload/proto`**: Upload `.proto` files
  - Saves to `protos/` directory
  - Triggers reload if hot-reload is enabled

- **`POST /admin/upload/rule`**: Upload rule files
  - Saves to `rules/grpc/` directory
  - Triggers rule reload

#### Health Checks

- **`GET /`**: Basic health check (returns 200)
- **`GET /liveness`**: Kubernetes liveness probe
- **`GET /readiness`**: Kubernetes readiness probe
  - Returns 503 if reload is in progress

#### Web UI

- **`GET /app/`**: Serves web UI for interactive testing
  - Service browser
  - Request builder
  - Response viewer


## Configuration

### Environment Variables

#### Server Ports

- `GRPC_PORT_PLAINTEXT` (default: 50050): Native gRPC plaintext port
- `GRPC_PORT` (alias for `GRPC_PORT_PLAINTEXT`)
- `GRPC_PORT_TLS` (default: 50051): Native gRPC TLS port
- `HTTP_PORT` (default: 4319): Admin API HTTP port
- `CONNECT_PORT` (default: 50052): Connect RPC server port

#### TLS Configuration (Native gRPC)

- `GRPC_TLS_ENABLED` (default: false): Enable TLS server
- `GRPC_TLS_CERT_PATH`: Path to TLS certificate
- `GRPC_TLS_KEY_PATH`: Path to TLS private key
- `GRPC_TLS_CA_PATH`: Path to CA certificate (for mTLS)
- `GRPC_TLS_REQUIRE_CLIENT_CERT` (default: false): Require client certificates

#### Connect RPC Configuration

- `CONNECT_ENABLED` (default: true): Enable Connect RPC server
- `CONNECT_CORS_ENABLED` (default: true): Enable CORS
- `CONNECT_CORS_ORIGINS` (default: *): Allowed CORS origins (comma-separated)
- `CONNECT_CORS_METHODS` (default: GET,POST,OPTIONS): Allowed CORS methods
- `CONNECT_CORS_HEADERS` (default: *): Allowed CORS headers
- `CONNECT_TLS_ENABLED` (default: false): Enable TLS for Connect
- `CONNECT_TLS_CERT_PATH`: Path to TLS certificate
- `CONNECT_TLS_KEY_PATH`: Path to TLS private key
- `CONNECT_TLS_CA_PATH`: Path to CA certificate

#### Validation Configuration

- `VALIDATION_ENABLED` (default: false): Enable request validation
- `VALIDATION_SOURCE` (default: auto): Validation source (auto, pgv, protovalidate)
- `VALIDATION_MODE` (default: per_message): Streaming validation mode (per_message, aggregate)
- `VALIDATION_CEL_MESSAGE` (default: disabled): Enable message-level CEL (experimental)

#### Hot Reload Configuration

- `HOT_RELOAD_PROTOS` (default: true, false in cluster): Enable proto hot-reload
- `HOT_RELOAD_RULES` (default: true): Enable rule hot-reload

#### Reflection Configuration

- `REFLECTION_DISABLE_REGEN` (default: false): Disable descriptor regeneration

#### Cluster Configuration

- `START_CLUSTER` (default: false): Run in cluster mode with multiple workers

### Directory Structure

```
wishmock/
├── protos/                    # Protobuf definitions
│   ├── helloworld.proto
│   ├── advanced.proto
│   └── ...
├── rules/grpc/                # Rule files
│   ├── helloworld.greeter.sayhello.yaml
│   ├── advanced.calculator.add.yaml
│   └── ...
├── uploads/                   # Uploaded files (via Admin API)
├── bin/                       # Generated files
│   └── .descriptors.bin       # Reflection descriptor set
├── src/                       # Source code
│   ├── app.ts                 # Main application entry point
│   ├── domain/                # Business logic
│   │   ├── usecases/          # Shared request handlers
│   │   ├── metrics/           # Shared metrics
│   │   └── types/             # Domain types
│   ├── infrastructure/        # Infrastructure layer
│   │   ├── grpcServer.ts      # Native gRPC server
│   │   ├── connectServer.ts   # Connect RPC server
│   │   ├── protocolAdapter.ts # Protocol adapters
│   │   ├── protoLoader.ts     # Proto loading
│   │   ├── ruleLoader.ts      # Rule loading
│   │   └── validation/        # Validation runtime
│   └── interfaces/            # Interface layer
│       └── httpAdmin.ts       # Admin API
└── docs/                      # Documentation
    ├── architecture.md        # This file
    ├── connect-rpc-support.md # Connect RPC guide
    └── ...
```


## Performance Considerations

### Shared State Benefits

- **Memory Efficiency**: Single proto root and rules index shared by all servers
- **Consistency**: No risk of state divergence between servers
- **Atomic Updates**: Reload operations update all servers with same state

### Protocol Adapter Optimizations

- **Cached Conversion Options**: Protobuf conversion options cached to avoid recreation
- **Smart Normalization Detection**: Skips unnecessary conversions for simple objects
- **Fast Path for Buffers**: Direct binary decoding without intermediate conversions
- **Pre-allocated Objects**: Metadata records pre-allocated with estimated size

### Validation Performance

- **Validator Caching**: Validators cached by message type
- **Lazy Evaluation**: Validation only runs if enabled and validator exists
- **Streaming Modes**: Per-message or aggregate validation for optimal performance

### Metrics Tracking

- **Minimal Overhead**: Metrics use simple counters and maps
- **No Blocking**: Metrics updates don't block request processing
- **Aggregated Reporting**: Metrics aggregated across both servers

## Security Considerations

### TLS/mTLS Support

- **Native gRPC**: Full TLS and mTLS support
- **Connect RPC**: Optional TLS support
- **Certificate Validation**: Proper certificate chain validation
- **Client Authentication**: Optional client certificate requirement

### Validation as Security Layer

- **Input Validation**: Validates all requests before processing
- **Type Safety**: Ensures requests conform to protobuf schema
- **Constraint Enforcement**: Enforces field constraints (min/max, regex, etc.)

### Error Information Leakage

- **Normalized Errors**: Consistent error format across protocols
- **Filtered Details**: Protocol adapters can filter sensitive information
- **Structured Logging**: Clear separation of internal and external errors

### Shared State Integrity

- **Read-Only During Requests**: Proto root and rules index are read-only during request handling
- **Atomic Reload**: Reload operations replace entire instances atomically
- **No Race Conditions**: No write contention between servers

## Monitoring and Observability

### Metrics

**Shared Metrics** (tracked across both servers):
- Validation checks (total, by message type)
- Validation failures (total, by message type)
- Rule match attempts (total, by rule key)
- Rule matches (total, by rule key)
- Rule misses (total, by rule key)

**gRPC Server Metrics**:
- Request count
- Error count
- Active connections

**Connect RPC Server Metrics**:
- Request count (total and by protocol)
- Error count
- Active connections
- Protocol distribution (Connect, gRPC-Web, gRPC)

### Logging

**Log Prefixes**:
- `[wishmock]`: General application logs
- `[shared]`: Shared handler logs
- `[grpc]`: Native gRPC server logs
- `[connect]`: Connect RPC server logs
- `[reload]`: Reload operation logs
- `[shutdown]`: Shutdown operation logs
- `[lifecycle]`: Lifecycle event logs
- `[rules]`: Rule loading logs
- `[watch]`: File watcher logs

**Log Levels**:
- Info: Normal operations, startup, shutdown
- Error: Failures, exceptions, validation errors
- Debug: Detailed request/response information (not enabled by default)


### Health Checks

**Liveness Probe** (`GET /liveness`):
- Always returns 200 if process is running
- Indicates process is alive and not deadlocked

**Readiness Probe** (`GET /readiness`):
- Returns 200 if ready to serve requests
- Returns 503 if reload is in progress
- Kubernetes uses this to route traffic

**Status Endpoint** (`GET /admin/status`):
- Comprehensive server status
- Metrics and statistics
- Proto and rule load status
- Validation coverage
- Reload history

## Testing Strategy

### Unit Tests

**Shared Handler Tests** (`tests/handleRequest.test.ts`):
- Validation logic
- Rule matching
- Response selection
- Error handling
- All streaming patterns

**Protocol Adapter Tests** (`tests/protocolAdapter.test.ts`):
- gRPC → Normalized conversion
- Connect → Normalized conversion
- Normalized → gRPC conversion
- Normalized → Connect conversion
- Error code mapping

**Validation Tests** (`tests/validation.*.test.ts`):
- PGV validation
- Protovalidate validation
- Message-level CEL
- Streaming validation modes

### Integration Tests

**gRPC Server Tests** (`tests/grpcServer.test.ts`):
- Handler generation
- Request processing
- Streaming patterns
- Error handling

**Connect Server Tests** (`tests/connectServer.test.ts`):
- Service registration
- Protocol detection
- Request processing
- CORS handling

**Lifecycle Tests** (`tests/lifecycle.integration.test.ts`):
- Coordinated startup
- Reload behavior
- Graceful shutdown
- Error recovery

### End-to-End Tests

**Protocol Consistency Tests** (`tests/e2e/protocol-consistency.test.ts`):
- Send identical requests via gRPC and Connect
- Verify responses are identical
- Test with various rule configurations
- Test validation errors
- Test streaming patterns

**Admin API Tests** (`tests/httpAdmin.integration.test.ts`):
- Status endpoint
- Service discovery
- Schema retrieval
- File upload
- Reload trigger

## Troubleshooting

### Common Issues

**Proto Load Failures**:
- Check `GET /admin/status` → `protos.skipped` for error details
- Verify `.proto` files are valid
- Check for missing imports or dependencies

**Rule Not Matching**:
- Verify rule filename matches convention: `package.service.method.yaml`
- Check rule key in `GET /admin/status` → `rules`
- Verify rule conditions match request metadata/data
- Check rule priority if multiple rules exist

**Validation Errors**:
- Check `VALIDATION_ENABLED` is set to true
- Verify validation rules exist in proto files
- Check `GET /admin/status` → `validation` for coverage
- Review validation error details in response

**Connect RPC Not Working**:
- Check `CONNECT_ENABLED` is set to true
- Verify Connect server started (check logs)
- Check `GET /admin/status` → `connect_rpc.enabled`
- Verify CORS configuration if calling from browser

**Reload Downtime**:
- Reload is not zero-downtime by design
- Use cluster mode with rolling restart for zero-downtime
- Check `GET /admin/status` → `reload.downtime_detected`


## Design Decisions

### Why Shared Core Logic?

**Problem**: Original implementation had separate handler generation for gRPC and Connect, risking behavior divergence.

**Solution**: Extract common logic (validation, rule matching, response selection) into shared handlers that both servers use.

**Benefits**:
- Guaranteed consistency across protocols
- Single source of truth for business logic
- Easier to test and maintain
- Reduced code duplication

### Why Protocol Adapters?

**Problem**: Different protocols have different request/response formats, metadata structures, and error codes.

**Solution**: Create thin adapter layer that converts between protocol-specific and normalized formats.

**Benefits**:
- Clear separation of concerns
- Protocol-specific code isolated from business logic
- Easy to add new protocols
- Testable in isolation

### Why Coordinated Lifecycle?

**Problem**: Independent server management could lead to state divergence during reload.

**Solution**: Coordinate startup, reload, and shutdown across all servers using shared state.

**Benefits**:
- Atomic updates (all servers use same state)
- No risk of state divergence
- Clear lifecycle events
- Predictable behavior

### Why Not Zero-Downtime Reload?

**Decision**: Reload stops servers before restarting with new state.

**Rationale**:
- Simpler implementation
- Guaranteed consistency (no mixed state)
- Typical reload time is 100-500ms (acceptable for dev/test)
- Production deployments should use cluster mode with rolling restart

**Alternative**: Cluster mode provides zero-downtime via worker rotation.

### Why Shared Metrics?

**Problem**: Need to track metrics across both servers for unified monitoring.

**Solution**: Create shared metrics module that both servers update.

**Benefits**:
- Unified view of validation and rule matching
- Easy to compare behavior across protocols
- Single source of truth for metrics
- Exposed via Admin API

## Future Enhancements

### Potential Improvements

1. **Zero-Downtime Reload**: Implement hot-swap mechanism for single-process mode
2. **Metrics Export**: Add Prometheus metrics endpoint
3. **Distributed Tracing**: Add OpenTelemetry tracing support
4. **Rule Caching**: Cache compiled rule conditions for better performance
5. **Async Validation**: Support async validators for external validation services
6. **WebSocket Support**: Add WebSocket transport for Connect RPC
7. **HTTP/3 Support**: Add QUIC/HTTP/3 support for Connect RPC
8. **Rule Versioning**: Support multiple rule versions with A/B testing
9. **Request Recording**: Record and replay requests for testing
10. **Mock Scenarios**: Support complex multi-step mock scenarios

### Extensibility Points

**Custom Validators**:
- Validation runtime can be extended with custom validators
- Register validators for specific message types
- Integrate with external validation services

**Custom Response Selectors**:
- Response selection logic can be customized
- Add custom template helpers
- Implement custom matching logic

**Custom Metrics**:
- Shared metrics can be extended with custom counters
- Add protocol-specific metrics
- Integrate with external monitoring systems

**Custom Protocols**:
- Add new protocol adapters for other RPC frameworks
- Implement normalization and conversion functions
- Register with shared handlers

## References

### Related Documentation

- [Connect RPC Support](./connect-rpc-support.md): Detailed Connect RPC guide
- [PGV Validation](./pgv-validation.md): PGV validation guide
- [Protovalidate Validation](./protovalidate-validation.md): Protovalidate guide
- [Quick Reference](./quick-reference.md): Quick command reference
- [API Documentation](../API.md): Admin API reference
- [README](../README.md): General usage guide

### External Resources

- [Connect RPC](https://connectrpc.com/): Connect RPC protocol specification
- [gRPC](https://grpc.io/): gRPC protocol specification
- [gRPC-Web](https://github.com/grpc/grpc-web): gRPC-Web protocol
- [protobuf.js](https://github.com/protobufjs/protobuf.js): Protobuf JavaScript library
- [protovalidate](https://github.com/bufbuild/protovalidate): Buf's validation framework
- [protoc-gen-validate](https://github.com/bufbuild/protoc-gen-validate): PGV validation
- [Performance Optimization](./performance-optimization.md): Shared handler performance analysis

## Glossary

- **Connect RPC**: Modern RPC protocol with JSON and binary support, browser-compatible
- **gRPC**: High-performance RPC framework using HTTP/2 and Protocol Buffers
- **gRPC-Web**: Browser-compatible variant of gRPC
- **Protocol Adapter**: Layer that converts between protocol-specific and normalized formats
- **Normalized Request**: Protocol-agnostic request format used internally
- **Normalized Response**: Protocol-agnostic response format used internally
- **Normalized Error**: Protocol-agnostic error format used internally
- **Shared Handler**: Core business logic shared by all protocol servers
- **Proto Root**: protobuf.js Root object containing all loaded protobuf definitions
- **Rules Index**: Map of rule keys to rule documents for response mocking
- **Validation Runtime**: Unified interface for request validation (PGV or protovalidate)
- **Coordinated Lifecycle**: Synchronized startup, reload, and shutdown across servers
- **Hot Reload**: Automatic server reload when proto or rule files change
- **Shared Metrics**: Metrics tracked across both gRPC and Connect servers
- **Admin API**: HTTP API for monitoring, management, and file uploads

---

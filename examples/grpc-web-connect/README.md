# gRPC-Web Client Examples (via Connect RPC)

This directory contains examples demonstrating how to call Wishmock using the **gRPC-Web protocol** via Connect RPC from both browser and Node.js environments.

## Overview

gRPC-Web is a protocol that allows browser clients to communicate with gRPC services using HTTP/1.1 or HTTP/2. Traditionally, gRPC-Web requires a proxy like Envoy to translate between gRPC-Web and native gRPC. **With Connect RPC, Wishmock natively supports gRPC-Web without requiring any proxy!**

### Key Features

- ✅ **No Envoy Required** - Connect RPC natively handles gRPC-Web protocol
- ✅ **Browser Compatible** - Works in all modern browsers
- ✅ **Binary Protobuf** - Uses efficient binary encoding (with JSON fallback)
- ✅ **Streaming Support** - Server streaming works seamlessly
- ✅ **Same Server** - One server supports Connect, gRPC-Web, and gRPC

## Protocol Comparison

| Feature | Connect Protocol | gRPC-Web Protocol | Native gRPC |
|---------|-----------------|-------------------|-------------|
| Browser Support | ✅ Yes | ✅ Yes | ❌ No |
| Encoding | JSON or Binary | Binary (base64) | Binary |
| HTTP Version | HTTP/1.1, HTTP/2 | HTTP/1.1, HTTP/2 | HTTP/2 only |
| Proxy Required | ❌ No | ❌ No (with Connect) | N/A |
| Human Readable | ✅ Yes (JSON) | ❌ No | ❌ No |

## Prerequisites

1. **Start Wishmock with Connect RPC enabled:**

```bash
# From the project root
CONNECT_ENABLED=true CONNECT_PORT=50052 bun run start
```

2. **Ensure you have proto files loaded:**

The examples use services from:
- `protos/helloworld.proto` - For unary RPC examples
- `protos/streaming.proto` - For streaming RPC examples

3. **Optional: Create rule files for mock responses:**

See the [Connect client examples](../connect-client/README.md) for rule file examples.

## Browser Example

### Running the Browser Example

1. Open `browser.html` in your web browser:

```bash
# Option 1: Open directly
open examples/grpc-web-connect/browser.html

# Option 2: Serve via HTTP server (recommended for CORS)
npx http-server examples/grpc-web-connect -p 3000
# Then open http://localhost:3000/browser.html
```

2. The page includes three interactive sections:

   - **Unary RPC (gRPC-Web)**: Simple request-response using gRPC-Web protocol
   - **Server Streaming (gRPC-Web)**: Streaming call using gRPC-Web protocol
   - **Protocol Comparison**: Compare Connect vs gRPC-Web side-by-side

### Features

- ✅ Interactive UI with forms
- ✅ Real-time streaming message display
- ✅ Protocol comparison tool
- ✅ Error handling and display
- ✅ Stream cancellation support
- ✅ Visual protocol indicators

### Browser Screenshots

The browser example provides:
- Input fields for request parameters
- Buttons to trigger gRPC-Web calls
- Output areas showing responses
- Side-by-side protocol comparison
- Color-coded success/error messages

## Node.js Example

### Running the Node.js Example

```bash
# Run with default server (http://localhost:50052)
node examples/grpc-web-connect/node.mjs

# Run with custom server URL
node examples/grpc-web-connect/node.mjs --server http://localhost:50052
```

### What It Demonstrates

The Node.js example includes 6 different scenarios:

1. **Health Check**: Verify the Connect RPC server supports gRPC-Web
2. **Unary RPC (gRPC-Web)**: Simple `SayHello` call using gRPC-Web
3. **Protocol Comparison**: Compare Connect vs gRPC-Web performance
4. **Server Streaming (gRPC-Web)**: Receive multiple messages via gRPC-Web
5. **Validation**: Test validation with gRPC-Web protocol
6. **Error Handling**: Various error scenarios with gRPC-Web

### Example Output

```
🌐 gRPC-Web Node.js Client Example (via Connect RPC)
====================================================

Server URL: http://localhost:50052
Protocol: gRPC-Web (binary protobuf compatible)

📞 Example 6: Health Check
--------------------------
✅ Server is healthy!
Status: serving
Services: 3
Reflection: enabled
Protocols: Connect, gRPC-Web, gRPC (all supported!)

📞 Example 1: Unary RPC - SayHello (gRPC-Web)
----------------------------------------------
✅ Success! (gRPC-Web Protocol)
Request: { name: 'gRPC-Web NodeJS' }
Response: { message: 'Hello from Wishmock!' }
Content-Type: application/grpc-web+json

📞 Example 2: Protocol Comparison
----------------------------------

🔌 Calling with Connect protocol (JSON)...
✅ Connect Success
   Response: { message: 'Hello from Wishmock!' }
   Time: 15ms
   Content-Type: application/json

🌐 Calling with gRPC-Web protocol...
✅ gRPC-Web Success
   Response: { message: 'Hello from Wishmock!' }
   Time: 16ms
   Content-Type: application/grpc-web+json

📊 Summary:
   Both protocols work seamlessly with Connect RPC!
   • Connect: Modern, JSON-based, human-readable
   • gRPC-Web: Binary protobuf, browser-compatible
   • No Envoy proxy required for either protocol!
```

## Protocol Details

### gRPC-Web Protocol

gRPC-Web uses HTTP with specific headers to indicate the protocol:

**Request:**
```http
POST /helloworld.Greeter/SayHello HTTP/1.1
Host: localhost:50052
Content-Type: application/grpc-web+json
X-Grpc-Web: 1
Accept: application/grpc-web+json

{"name": "World"}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/grpc-web+json

{"message": "Hello, World!"}
```

### Content Types

gRPC-Web supports multiple content types:

- `application/grpc-web+proto` - Binary protobuf (most efficient)
- `application/grpc-web+json` - JSON format (human-readable)
- `application/grpc-web-text` - Base64-encoded binary (legacy)

Connect RPC accepts all these content types and handles the protocol translation automatically.

### Streaming Protocol

For server streaming, gRPC-Web uses the same newline-delimited format as Connect:

**Request:**
```http
POST /streaming.StreamService/GetMessages HTTP/1.1
Host: localhost:50052
Content-Type: application/grpc-web+json
X-Grpc-Web: 1

{"user_id": "user123", "limit": 5}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/grpc-web+json

{"id":"msg1","content":"First message",...}
{"id":"msg2","content":"Second message",...}
{"id":"msg3","content":"Third message",...}
```

## Error Handling

gRPC-Web errors use standard HTTP status codes and gRPC status codes:

```json
{
  "code": "invalid_argument",
  "message": "Validation failed: name must be at least 3 characters",
  "details": []
}
```

Common error codes:
- `invalid_argument` - Validation errors
- `not_found` - Service or method not found
- `unimplemented` - No rule matched for the request
- `internal` - Server error
- `unavailable` - Server unavailable

## Comparison with Envoy Setup

### Traditional Envoy Setup

```
┌─────────┐         ┌───────────┐         ┌──────────┐
│ Browser │ ──────> │   Envoy   │ ──────> │ Wishmock │
│ (gRPC-  │  HTTP   │  (Proxy)  │  gRPC   │  Server  │
│  Web)   │         │  :8080    │         │  :50050  │
└─────────┘         └───────────┘         └──────────┘
```

**Drawbacks:**
- ❌ Requires separate Envoy container
- ❌ Additional configuration complexity
- ❌ Extra network hop (latency)
- ❌ More moving parts to maintain

### Connect RPC Setup

```
┌─────────┐         ┌──────────────────────────────┐
│ Browser │ ──────> │       Wishmock Server        │
│ (gRPC-  │  HTTP   │                              │
│  Web)   │         │  • Connect Protocol          │
└─────────┘         │  • gRPC-Web Protocol         │
                    │  • Native gRPC               │
                    │  (all in one server!)        │
                    └──────────────────────────────┘
```

**Benefits:**
- ✅ No proxy required
- ✅ Simpler configuration
- ✅ Lower latency
- ✅ Fewer dependencies

## CORS Configuration

For browser clients, ensure CORS is properly configured:

```bash
# Enable CORS for all origins (development)
CONNECT_CORS_ENABLED=true CONNECT_CORS_ORIGINS=* bun run start

# Enable CORS for specific origins (production)
CONNECT_CORS_ORIGINS=https://example.com,https://app.example.com bun run start
```

## Troubleshooting

### CORS Errors in Browser

If you see CORS errors:

1. Ensure Wishmock is running with CORS enabled:
```bash
CONNECT_CORS_ENABLED=true CONNECT_CORS_ORIGINS=* bun run start
```

2. Check the browser console for specific CORS errors
3. Verify the server URL matches your configuration

### Protocol Not Recognized

If you see "protocol not recognized" errors:

1. Ensure you're using the correct headers:
   - `Content-Type: application/grpc-web+json`
   - `X-Grpc-Web: 1`

2. Verify Connect RPC is enabled:
```bash
curl http://localhost:4319/admin/status | jq '.connect_rpc'
```

### Streaming Not Working

If streaming doesn't work:

1. Check that the service supports server streaming
2. Verify the rule file includes streaming responses
3. Ensure you're reading the response body as a stream

### Connection Refused

If you see "Connection refused":

1. Check that Wishmock is running:
```bash
curl http://localhost:50052/health
```

2. Verify the Connect RPC port:
```bash
curl http://localhost:4319/admin/status | jq '.connect_rpc.port'
```

## Migration from Envoy

If you're currently using Envoy for gRPC-Web:

1. **Update client code** - Change the server URL from Envoy to Wishmock
2. **Remove Envoy** - No longer needed with Connect RPC
3. **Update configuration** - Enable Connect RPC in Wishmock
4. **Test thoroughly** - Verify all functionality works

See the [migration guide](../../docs/connect-migration-guide.md) for detailed instructions.

## Performance Considerations

### Protocol Overhead

- **gRPC-Web (binary)**: Similar to native gRPC, minimal overhead
- **gRPC-Web (JSON)**: Larger payload but human-readable
- **Connect (JSON)**: Similar to gRPC-Web JSON
- **Native gRPC**: Most efficient, binary protocol

### When to Use gRPC-Web

Use gRPC-Web when:
- ✅ You need browser compatibility
- ✅ You're migrating from Envoy setup
- ✅ You want binary protobuf efficiency
- ✅ You have existing gRPC-Web clients

Use Connect protocol when:
- ✅ You want human-readable JSON
- ✅ You're building new applications
- ✅ You want easier debugging
- ✅ You prefer modern RPC patterns

## Next Steps

- Try the [Connect client examples](../connect-client/) for JSON-based protocol
- Read the [Connect RPC documentation](../../docs/connect-rpc-support.md)
- See the [migration guide](../../docs/connect-migration-guide.md) for migrating from Envoy
- Explore the [API reference](../../API.md)

## Resources

- [gRPC-Web Documentation](https://github.com/grpc/grpc-web)
- [Connect RPC Documentation](https://connectrpc.com/docs/)
- [Wishmock Documentation](../../README.md)
- [Protocol Comparison](../../docs/connect-rpc-support.md#protocol-comparison)

## Key Takeaways

1. **No Proxy Required** - Connect RPC natively supports gRPC-Web
2. **Browser Compatible** - Works in all modern browsers
3. **Same Server** - One server supports three protocols
4. **Easy Migration** - Simple to migrate from Envoy setup
5. **Full Featured** - Streaming, validation, and error handling all work

---

**Questions or Issues?** Check the [troubleshooting section](#troubleshooting) or open an issue on GitHub.

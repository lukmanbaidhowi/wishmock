# Connect RPC Client Examples

This directory contains examples demonstrating how to call Wishmock using the Connect RPC protocol from both browser and Node.js environments.

## Overview

Connect RPC is a modern RPC protocol that works seamlessly in browsers and Node.js without requiring a proxy like Envoy. These examples show how to:

- Make unary (request-response) RPC calls
- Handle server streaming RPCs
- Work with validation
- Handle errors properly

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

Create rule files in `rules/grpc/` to define mock responses. For example:

```yaml
# rules/grpc/helloworld.greeter.sayhello.yaml
- when:
    metadata: {}
    request: {}
  response:
    message: "Hello from Wishmock!"
```

```yaml
# rules/grpc/streaming.streamservice.getmessages.yaml
- when:
    metadata: {}
    request: {}
  response:
    stream:
      - id: "msg1"
        content: "First message"
        timestamp: 1234567890
        sender: "system"
      - id: "msg2"
        content: "Second message"
        timestamp: 1234567891
        sender: "system"
      - id: "msg3"
        content: "Third message"
        timestamp: 1234567892
        sender: "system"
```

## Browser Example

### Running the Browser Example

1. Open `browser.html` in your web browser:

```bash
# Option 1: Open directly
open examples/connect-client/browser.html

# Option 2: Serve via HTTP server (recommended for CORS)
npx http-server examples/connect-client -p 3000
# Then open http://localhost:3000/browser.html
```

2. The page includes three interactive sections:

   - **Unary RPC**: Simple request-response call to `SayHello`
   - **Server Streaming RPC**: Streaming call to `GetMessages`
   - **Custom Request**: Send any JSON request to any service

### Features

- ✅ Interactive UI with forms
- ✅ Real-time streaming message display
- ✅ Error handling and display
- ✅ Stream cancellation support
- ✅ Configurable server URL

### Browser Example Screenshots

The browser example provides:
- Input fields for request parameters
- Buttons to trigger RPC calls
- Output areas showing responses
- Color-coded success/error messages
- Stream cancellation controls

## Node.js Example

### Running the Node.js Example

```bash
# Run with default server (http://localhost:50052)
node examples/connect-client/node.mjs

# Run with custom server URL
node examples/connect-client/node.mjs --server http://localhost:50052
```

### What It Demonstrates

The Node.js example includes 6 different scenarios:

1. **Health Check**: Verify the Connect RPC server is running
2. **Unary RPC**: Simple `SayHello` call
3. **Unary with Validation**: Call with valid data that passes validation
4. **Validation Error**: Call with invalid data to see validation errors
5. **Server Streaming**: Receive multiple messages from `GetMessages`
6. **Watch Events**: Another streaming example with `WatchEvents`

### Example Output

```
🔌 Connect RPC Node.js Client Example
=====================================

Server URL: http://localhost:50052

📞 Example 6: Health Check
--------------------------
✅ Server is healthy!
Status: serving
Services: 3
Reflection: enabled

📞 Example 1: Unary RPC - SayHello
-----------------------------------
✅ Success!
Request: { name: 'NodeJS' }
Response: { message: 'Hello from Wishmock!' }

📞 Example 4: Server Streaming RPC - GetMessages
------------------------------------------------
Request: { user_id: 'user123', limit: 5 }
📡 Receiving messages...

Message 1: { id: 'msg1', content: 'First message', timestamp: 1234567890, sender: 'system' }
Message 2: { id: 'msg2', content: 'Second message', timestamp: 1234567891, sender: 'system' }
Message 3: { id: 'msg3', content: 'Third message', timestamp: 1234567892, sender: 'system' }

✅ Stream completed. Received 3 messages.
```

## Protocol Details

### Connect RPC Protocol

Connect RPC uses standard HTTP with JSON or binary payloads:

**Request:**
```http
POST /helloworld.Greeter/SayHello HTTP/1.1
Host: localhost:50052
Content-Type: application/json
Connect-Protocol-Version: 1

{"name": "World"}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"message": "Hello, World!"}
```

### Streaming Protocol

For server streaming, Connect uses newline-delimited JSON:

**Request:**
```http
POST /streaming.StreamService/GetMessages HTTP/1.1
Host: localhost:50052
Content-Type: application/json
Connect-Protocol-Version: 1

{"user_id": "user123", "limit": 5}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"msg1","content":"First message",...}
{"id":"msg2","content":"Second message",...}
{"id":"msg3","content":"Third message",...}
```

## Error Handling

Connect RPC uses standard error codes:

```json
{
  "code": "invalid_argument",
  "message": "Validation failed: name must be at least 3 characters"
}
```

Common error codes:
- `invalid_argument` - Validation errors
- `not_found` - Service or method not found
- `unimplemented` - No rule matched for the request
- `internal` - Server error

## Validation Examples

The examples demonstrate Wishmock's validation features:

### Valid Request
```json
{
  "name": "ValidUser123",
  "email": "user@example.com",
  "age": 25
}
```

### Invalid Request (triggers validation error)
```json
{
  "name": "ab",              // Too short (min_len: 3)
  "email": "invalid-email",  // Invalid email format
  "age": 200                 // Too high (max: 150)
}
```

## Customization

### Changing the Server URL

**Browser:**
- Update the "Server URL" field in the UI

**Node.js:**
```bash
node examples/connect-client/node.mjs --server http://your-server:50052
```

### Adding More Examples

To add more RPC examples:

1. Add the proto file to `protos/`
2. Create rule files in `rules/grpc/`
3. Add example code to call the new service
4. Update this README with the new example

## Troubleshooting

### CORS Errors in Browser

If you see CORS errors:

1. Ensure Wishmock is running with CORS enabled:
```bash
CONNECT_CORS_ENABLED=true CONNECT_CORS_ORIGINS=* bun run start
```

2. Or configure specific origins:
```bash
CONNECT_CORS_ORIGINS=http://localhost:3000,http://localhost:50052 bun run start
```

### Connection Refused

If you see "Connection refused":

1. Check that Wishmock is running:
```bash
curl http://localhost:50052/health
```

2. Verify the Connect RPC port:
```bash
curl http://localhost:4319/admin/status | jq '.connect_rpc'
```

### No Rule Matched

If you see "No rule matched" errors:

1. Create rule files in `rules/grpc/` directory
2. Use the naming convention: `package.service.method.yaml`
3. Check the Admin API to see loaded rules:
```bash
curl http://localhost:4319/admin/rules
```

### Validation Errors

If validation is failing unexpectedly:

1. Check validation is enabled:
```bash
VALIDATION_ENABLED=true bun run start
```

2. Review the proto file for validation rules
3. Check the validation source setting:
```bash
VALIDATION_SOURCE=auto bun run start
```

## Next Steps

- Try the [gRPC-Web examples](../grpc-web-connect/) for browser compatibility
- Read the [Connect RPC documentation](../../docs/connect-rpc-support.md)
- See the [migration guide](../../docs/connect-migration-guide.md) for migrating from Envoy

## Resources

- [Connect RPC Documentation](https://connectrpc.com/docs/)
- [Wishmock Documentation](../../README.md)
- [API Reference](../../API.md)

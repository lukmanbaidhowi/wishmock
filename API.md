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

## Rule Files

### List Rule Files
```
GET /admin/rules
```
Returns list of available rule files.

Response:
```json
{
  "files": [
    { "filename": "helloworld.greeter.sayhello.yaml", "path": "/path/to/rules/..." }
  ]
}
```

### Get Rule File Content
```
GET /admin/rule/:filename
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
PUT /admin/rule/:filename
Content-Type: application/json

{
  "content": "responses:\n  - body:\n..."
}
```

## Existing Endpoints

- `GET /admin/status` - Server status
- `GET /admin/services` - List gRPC services
- `GET /admin/schema/:typeName` - Get message schema
- `POST /admin/upload/proto` - Upload proto file
- `POST /admin/upload/rule` - Upload rule file

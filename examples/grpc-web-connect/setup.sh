#!/bin/bash

# Setup script for gRPC-Web Connect examples
# This script copies example rule files to the rules directory

set -e

echo "🌐 Setting up gRPC-Web Connect examples..."
echo ""

# Get the project root directory (two levels up from this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RULES_DIR="$PROJECT_ROOT/rules/grpc"

# Create rules directory if it doesn't exist
mkdir -p "$RULES_DIR"

# Check if example rules exist in connect-client
EXAMPLE_RULES_DIR="$PROJECT_ROOT/examples/connect-client/example-rules"

if [ -d "$EXAMPLE_RULES_DIR" ]; then
  echo "📋 Copying example rule files to $RULES_DIR..."
  
  # Copy rule files
  cp "$EXAMPLE_RULES_DIR"/*.yaml "$RULES_DIR/" 2>/dev/null || true
  
  echo "✅ Rule files copied:"
  ls -1 "$RULES_DIR"/*.yaml 2>/dev/null | xargs -n1 basename || echo "   (no rule files found)"
else
  echo "⚠️  Example rules directory not found at $EXAMPLE_RULES_DIR"
  echo "   You can create rule files manually in $RULES_DIR"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start Wishmock with Connect RPC enabled:"
echo "   CONNECT_ENABLED=true CONNECT_PORT=50052 bun run start"
echo ""
echo "2. Run the Node.js example:"
echo "   node examples/grpc-web-connect/node.mjs"
echo ""
echo "3. Open the browser example:"
echo "   open examples/grpc-web-connect/browser.html"
echo "   (or serve via: npx http-server examples/grpc-web-connect -p 3000)"
echo ""

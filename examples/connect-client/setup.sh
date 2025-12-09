#!/bin/bash

# Setup script for Connect RPC client examples
# This script copies example rule files to the rules/grpc directory

set -e

echo "🔧 Setting up Connect RPC Client Examples"
echo "=========================================="
echo ""

# Check if we're in the project root
if [ ! -f "package.json" ]; then
  echo "❌ Error: Please run this script from the project root directory"
  echo "   Usage: bash examples/connect-client/setup.sh"
  exit 1
fi

# Create rules/grpc directory if it doesn't exist
if [ ! -d "rules/grpc" ]; then
  echo "📁 Creating rules/grpc directory..."
  mkdir -p rules/grpc
fi

# Copy example rule files
echo "📋 Copying example rule files..."

cp examples/connect-client/example-rules/helloworld.greeter.sayhello.yaml rules/grpc/
echo "   ✅ helloworld.greeter.sayhello.yaml"

cp examples/connect-client/example-rules/streaming.streamservice.getmessages.yaml rules/grpc/
echo "   ✅ streaming.streamservice.getmessages.yaml"

cp examples/connect-client/example-rules/streaming.streamservice.watchevents.yaml rules/grpc/
echo "   ✅ streaming.streamservice.watchevents.yaml"

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start Wishmock with Connect RPC enabled:"
echo "   CONNECT_ENABLED=true CONNECT_PORT=50052 bun run start"
echo ""
echo "2. Run the Node.js example:"
echo "   node examples/connect-client/node.mjs"
echo ""
echo "3. Open the browser example:"
echo "   open examples/connect-client/browser.html"
echo ""

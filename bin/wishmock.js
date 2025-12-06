#!/usr/bin/env node
// Entry for npx / global install. Assumes TypeScript has been compiled to dist/.
// The app bootstraps and starts on import.

import { readFileSync, existsSync, symlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Handle --version flag
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  try {
    const pkgPath = resolve(__dirname, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    console.log(`wishmock v${pkg.version}`);
    process.exit(0);
  } catch (e) {
    console.error('Failed to read version');
    process.exit(1);
  }
}

// Handle --help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
wishmock - gRPC mock server with hot reload and rule-based responses

Usage:
  wishmock [options]

Options:
  -v, --version     Show version number
  -h, --help        Show this help message

Environment Variables:
  HTTP_PORT                   HTTP admin API port (default: 4319)
  GRPC_PORT_PLAINTEXT         gRPC plaintext port (default: 50050)
  GRPC_PORT_TLS               gRPC TLS port (default: 50051)
  GRPC_TLS_ENABLED            Enable TLS (true/false, default: false)
  CONNECT_ENABLED             Enable Connect RPC (true/false, default: true)
  CONNECT_PORT                Connect RPC port (default: 50052)
  CONNECT_CORS_ENABLED        Enable CORS for Connect RPC (true/false, default: true)
  CONNECT_TLS_ENABLED         Enable TLS for Connect RPC (true/false, default: false)
  VALIDATION_ENABLED          Enable request validation (true/false)
  HOT_RELOAD_PROTOS           Enable proto hot reload (true/false)
  HOT_RELOAD_RULES            Enable rule hot reload (true/false)
  REFLECTION_DISABLE_REGEN    Disable reflection regeneration (auto-set if protoc missing)

Directory Structure:
  protos/          Place your .proto files here
  rules/grpc/      Place your rule files here (YAML/JSON)
  uploads/         Auto-created for Admin API uploads

Examples:
  # Start with default settings
  wishmock

  # Start with custom ports
  HTTP_PORT=8080 GRPC_PORT_PLAINTEXT=9090 wishmock

  # Start with validation enabled
  VALIDATION_ENABLED=true wishmock

  # Check server status (works without protoc)
  curl http://localhost:4319/admin/status

  # Test Connect RPC endpoint (works without protoc)
  curl http://localhost:50052/your.package.Service/Method -H "Content-Type: application/json" -d '{}'

  # List services via reflection (requires protoc installed)
  grpcurl -plaintext localhost:50050 list

Notes:
  - Connect RPC is enabled by default on port 50052 (supports browsers without proxies)
  - Connect RPC supports three protocols: Connect, gRPC-Web, and gRPC
  - protoc is auto-detected; if missing, reflection is disabled but server runs normally
  - Validation works without protoc (uses runtime proto parsing)
  - Install protoc for grpcurl reflection: https://protobuf.dev/installation/

Documentation:
  https://github.com/lukmanbaidhowi/wishmock
  https://www.npmjs.com/package/wishmock
`);
  process.exit(0);
}

function ensureFrontendLinked() {
  try {
    const cwdFrontend = resolve(process.cwd(), 'frontend');
    if (existsSync(cwdFrontend)) {
      return;
    }

    const globalFrontend = resolve(__dirname, '../frontend');
    if (!existsSync(globalFrontend)) {
      return;
    }

    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(globalFrontend, cwdFrontend, symlinkType);
    console.log('[wishmock] linked bundled frontend assets into ./frontend');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[wishmock] failed to link frontend assets automatically: ${message}`);
  }
}

// Check if protoc is available (cross-platform)
function hasProtoc() {
  try {
    // Use shell: true for Windows compatibility (handles .cmd/.bat extensions)
    execSync('protoc --version', { 
      stdio: 'ignore',
      shell: true,
      windowsHide: true  // Hide console window on Windows
    });
    return true;
  } catch {
    return false;
  }
}

// Auto-disable reflection regeneration if protoc is not available
if (!process.env.REFLECTION_DISABLE_REGEN) {
  if (!hasProtoc()) {
    console.log('[wishmock] protoc not found - disabling reflection descriptor regeneration');
    console.log('[wishmock] Server will run normally, but grpcurl reflection may not work');
    console.log('[wishmock] To enable reflection: install protoc (https://protobuf.dev/installation/)');
    process.env.REFLECTION_DISABLE_REGEN = '1';
  }
}

ensureFrontendLinked();

// Start the server
(async () => {
  try {
    await import('../dist/app.js');
  } catch (e) {
    console.error('[wishmock] Failed to start. Did you build?');
    console.error('[wishmock] Try: npm run start:node (which builds)');
    console.error(e);
    process.exit(1);
  }
})();

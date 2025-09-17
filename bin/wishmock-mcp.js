#!/usr/bin/env node
// ESM-aware launcher for the Wishmock MCP server
import { fileURLToPath, pathToFileURL } from 'url';
import { resolve, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// SDK-only launcher (stdio). For SSE, use start:mcp:http or Docker entrypoint.
const distPath = resolve(__dirname, '../dist/mcp/server.sdk.js');
const mod = await import(pathToFileURL(distPath).href);
if (typeof mod.start === 'function') {
  await mod.start();
} else if (typeof mod.default === 'function') {
  await mod.default();
} else {
  console.error('wishmock-mcp: no start() export found in dist/mcp/server.sdk.js');
  process.exit(1);
}

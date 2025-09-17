#!/usr/bin/env bun
// Run Wishmock server and MCP server together. Honor env vars (e.g., from --env-file).

const transport = (Bun.env.MCP_TRANSPORT || 'sse').toLowerCase();

function spawn(cmd, args, name) {
  const p = Bun.spawn([cmd, ...args], { stdout: 'inherit', stderr: 'inherit' });
  p.exited.then((code) => {
    console.log(`[dev.mcp] ${name} exited with code ${code}`);
    // If one process dies, terminate the group
    try { process.exitCode = code; } catch {}
    try { process.kill(process.pid, 'SIGINT'); } catch {}
  });
  return p;
}

console.log(`[dev.mcp] starting Wishmock server (bun dist/app.js)`);
const app = spawn('bun', ['dist/app.js'], 'app');

let mcpArgs;
if (transport === 'stdio') {
  console.log(`[dev.mcp] MCP transport=stdio (bun dist/mcp/server.sdk.js)`);
  mcpArgs = ['dist/mcp/server.sdk.js'];
} else {
  console.log(`[dev.mcp] MCP transport=sse (bun dist/mcp/server.sse.js)`);
  const host = Bun.env.MCP_HTTP_HOST || '127.0.0.1';
  const port = Bun.env.MCP_HTTP_PORT || '9090';
  console.log(`[dev.mcp] SSE listening on http://${host}:${port}/sse`);
  mcpArgs = ['dist/mcp/server.sse.js'];
}
const mcp = spawn('bun', mcpArgs, 'mcp');

function shutdown(signal) {
  console.log(`[dev.mcp] received ${signal}, shutting down...`);
  try { app.kill(signal); } catch {}
  try { mcp.kill(signal); } catch {}
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));


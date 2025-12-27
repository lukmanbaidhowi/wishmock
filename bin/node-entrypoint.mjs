
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const ENABLE_MCP = process.env.ENABLE_MCP === 'true';
const ENABLE_MCP_SSE = process.env.ENABLE_MCP_SSE === 'true';
const START_CLUSTER = process.env.START_CLUSTER === 'true';
const CLUSTER_WORKERS = process.env.CLUSTER_WORKERS;
const MCP_HTTP_HOST = process.env.MCP_HTTP_HOST || '0.0.0.0';
const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT || '9797';

console.log(`[node-entrypoint] Starting with NODE_ENV=${process.env.NODE_ENV}`);

if (ENABLE_MCP) {
    console.log('[node-entrypoint] ENABLE_MCP=true → starting MCP (stdio) in background');
    // Detached process, ignoring stdin to mimic background '&' behavior
    const mcpProcess = spawn(process.execPath, [path.join(root, 'dist/mcp/server.sdk.js')], {
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true
    });
    mcpProcess.unref();
}

if (ENABLE_MCP_SSE) {
    console.log(`[node-entrypoint] ENABLE_MCP_SSE=true → starting MCP (SSE) in background on ${MCP_HTTP_HOST}:${MCP_HTTP_PORT}`);
    const sseProcess = spawn(process.execPath, [path.join(root, 'dist/mcp/server.sse.js')], {
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true
    });
    sseProcess.unref();
}

const mainScript = START_CLUSTER
    ? path.join(root, 'bin/cluster.mjs')
    : path.join(root, 'dist/app.js');

if (START_CLUSTER) {
    console.log(`[node-entrypoint] starting wishmock in cluster mode (workers=${CLUSTER_WORKERS || 'auto'})`);
} else {
    console.log(`[node-entrypoint] starting wishmock gRPC/HTTP server (single process)`);
}

// Spawn the main process and inherit stdio
const main = spawn(process.execPath, [mainScript], { stdio: 'inherit' });

main.on('exit', (code) => {
    process.exit(code ?? 0);
});

// Forward signals to the main process
const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
signals.forEach((signal) => {
    process.on(signal, () => {
        // console.log(`[node-entrypoint] Received ${signal}, forwarding to child...`);
        main.kill(signal);
    });
});

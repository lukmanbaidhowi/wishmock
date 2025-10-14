/*
 HTTP SSE MCP server for Wishmock.
 - Exposes MCP over Server-Sent Events at GET /sse
 - Accepts client -> server JSON-RPC via POST /message (also supports POST /rpc and POST /)
 - Implements tools/resources similar to the stdio server
*/

import express from 'express';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

type Json = any;
import { ensureDir, listFiles, resolveBasePaths, safeJson, httpGetJson } from './utils.js';
const { BASE_DIR, RULES_DIR, PROTOS_DIR } = resolveBasePaths(import.meta.url);
const RULE_EXAMPLES_PATH = resolve(BASE_DIR, process.env.WISHMOCK_RULES_EXAMPLES_PATH || 'docs/rule-examples.md');
// Keep MCP defaults aligned with configurable Admin HTTP port.
function stripTrailingSlashes(value: string): string {
  let trimmed = value;
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

const ADMIN_BASE_URL = stripTrailingSlashes(process.env.ADMIN_BASE_URL || `http://localhost:${process.env.HTTP_PORT || '3000'}`);
const schemaBase = (url?: string) => stripTrailingSlashes(url || ADMIN_BASE_URL);

const MCP_HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || '9090', 10);
const MCP_HTTP_HOST = process.env.MCP_HTTP_HOST || '0.0.0.0';

// Protocol negotiation
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

// Simple per-process session identifier used for Streamable HTTP
const SESSION_ID = (process.env.MCP_SESSION_ID ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Json };
type JsonRpcResponse = { jsonrpc: '2.0'; id: number | string | null; result?: Json; error?: { code: number; message: string; data?: Json } };

function ok(id: number | string | null, result: Json): JsonRpcResponse { return { jsonrpc: '2.0', id, result }; }
function err(id: number | string | null, message: string, code = -32603, data?: Json): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

// utils imported above

// Simple cross-scope notifier so tools can emit SSE events
let notifyFn: ((obj: any) => void) | null = null;
function notify(obj: any) { try { notifyFn?.(obj); } catch {} }

// -------- Tool implementations (filesystem + Admin API) --------
async function tool_listRules() { return { files: await listFiles(RULES_DIR, ['.yaml', '.yml', '.json']) }; }
async function tool_readRule(args: { filename: string }) {
  if (!args?.filename) throw new Error('filename is required');
  const content = await fs.readFile(resolve(RULES_DIR, args.filename), 'utf8');
  return { filename: args.filename, content };
}
async function tool_writeRule(args: { filename: string; content: string }) {
  if (!args?.filename || typeof args.content !== 'string') throw new Error('filename and content required');
  await ensureDir(RULES_DIR);
  await fs.writeFile(resolve(RULES_DIR, args.filename), args.content, 'utf8');
  notify({ jsonrpc: '2.0', method: 'notifications/resources/list_changed', params: {} });
  return { filename: args.filename, bytes: Buffer.byteLength(args.content, 'utf8') };
}
async function tool_listProtos() { return { files: await listFiles(PROTOS_DIR, ['.proto']) }; }
async function tool_readProto(args: { filename: string }) {
  if (!args?.filename) throw new Error('filename is required');
  const content = await fs.readFile(resolve(PROTOS_DIR, args.filename), 'utf8');
  return { filename: args.filename, content };
}
async function tool_writeProto(args: { filename: string; content: string }) {
  if (!args?.filename || typeof args.content !== 'string') throw new Error('filename and content required');
  await ensureDir(PROTOS_DIR);
  await fs.writeFile(resolve(PROTOS_DIR, args.filename), args.content, 'utf8');
  notify({ jsonrpc: '2.0', method: 'notifications/resources/list_changed', params: {} });
  return { filename: args.filename, bytes: Buffer.byteLength(args.content, 'utf8') };
}
// httpGetJson imported from utils
async function tool_getStatus(args?: { url?: string }) {
  const url = args?.url || `${ADMIN_BASE_URL}/admin/status`;
  try {
    const payload = await httpGetJson(url);
    return { source: 'admin', status: payload };
  } catch {
    const rules = await listFiles(RULES_DIR, ['.yaml', '.yml', '.json']);
    const protos = await listFiles(PROTOS_DIR, ['.proto']);
    return { source: 'filesystem', status: { rules: rules.length, protos: protos.length } };
  }
}
async function tool_uploadProto(args: { filename: string; content: string; url?: string }) {
  if (!args?.filename || typeof args.content !== 'string') throw new Error('filename and content required');
  const url = args.url || `${ADMIN_BASE_URL}/admin/upload/proto`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: args.filename, content: args.content }) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: safeJson(text) };
}
async function tool_uploadRule(args: { filename: string; content: string; url?: string }) {
  if (!args?.filename || typeof args.content !== 'string') throw new Error('filename and content required');
  const url = args.url || `${ADMIN_BASE_URL}/admin/upload/rule/grpc`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: args.filename, content: args.content }) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: safeJson(text) };
}
async function tool_listServices(args?: { url?: string }) {
  const url = args?.url || `${ADMIN_BASE_URL}/admin/services`;
  return await httpGetJson(url);
}
async function tool_describeSchema(args: { type: string; url?: string }) {
  if (!args?.type) throw new Error('type is required');
  const base = schemaBase(args.url);
  return await httpGetJson(`${base}/admin/schema/${encodeURIComponent(args.type)}`);
}
async function tool_ruleExamples() {
  try {
    const text = await fs.readFile(RULE_EXAMPLES_PATH, 'utf8');
    return { path: RULE_EXAMPLES_PATH, content: text };
  } catch (err: any) {
    return { error: `Rule examples file not found at ${RULE_EXAMPLES_PATH}: ${err?.message || 'missing file'}` };
  }
}

async function listResources() {
  const ruleFiles = await listFiles(RULES_DIR, ['.yaml', '.yml', '.json']);
  const protoFiles = await listFiles(PROTOS_DIR, ['.proto']);
  return [
    ...ruleFiles.map((f) => ({ uri: `wishmock://rules/${encodeURIComponent(f)}`, name: `Rule: ${f}`, mimeType: f.endsWith('.json') ? 'application/json' : 'text/yaml' })),
    ...protoFiles.map((f) => ({ uri: `wishmock://protos/${encodeURIComponent(f)}`, name: `Proto: ${f}`, mimeType: 'text/x-proto' })),
  ];
}
async function readResource(uri: string) {
  if (!uri.startsWith('wishmock://')) throw new Error('Unsupported URI');
  const [, , kind, rest] = uri.split('/');
  const filename = decodeURIComponent(rest || '');
  if (!filename) throw new Error('Invalid resource URI');
  if (kind === 'rules') {
    const text = await fs.readFile(resolve(RULES_DIR, filename), 'utf8');
    return { uri, mimeType: filename.endsWith('.json') ? 'application/json' : 'text/yaml', text };
  }
  if (kind === 'protos') {
    const text = await fs.readFile(resolve(PROTOS_DIR, filename), 'utf8');
    return { uri, mimeType: 'text/x-proto', text };
  }
  throw new Error('Unknown resource kind');
}

async function handleRequest(msg: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id = null, method, params } = msg || {} as any;
  try {
    switch (method) {
      case 'initialize': {
        const requested = String((params as any)?.protocolVersion || '') || DEFAULT_PROTOCOL_VERSION;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
        return ok(id, { protocolVersion, serverInfo: { name: 'wishmock-mcp-sse', version: '0.1.0' }, capabilities: { tools: {}, resources: { listChanged: true } } });
      }
      case 'ping':
        return ok(id, { ok: true });
      case 'tools/list':
        return ok(id, { tools: [
          { name: 'listRules', description: 'List gRPC rule files under rules/grpc.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
          { name: 'readRule', description: 'Read a rule file content.', inputSchema: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'], additionalProperties: false } },
          { name: 'writeRule', description: 'Write content to a rule file (YAML/JSON).', inputSchema: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' } }, required: ['filename', 'content'], additionalProperties: false } },
          { name: 'listProtos', description: 'List proto files under protos/.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
          { name: 'readProto', description: 'Read a proto file content.', inputSchema: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'], additionalProperties: false } },
          { name: 'writeProto', description: 'Write content to a proto file.', inputSchema: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' } }, required: ['filename', 'content'], additionalProperties: false } },
          { name: 'getStatus', description: 'Fetch admin status (HTTP) or filesystem fallback.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, additionalProperties: false } },
          { name: 'uploadProto', description: 'Upload a proto via Admin API (POST /admin/upload/proto).', inputSchema: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' }, url: { type: 'string' } }, required: ['filename', 'content'], additionalProperties: false } },
          { name: 'uploadRule', description: 'Upload a gRPC rule via Admin API (POST /admin/upload/rule/grpc).', inputSchema: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' }, url: { type: 'string' } }, required: ['filename', 'content'], additionalProperties: false } },
          { name: 'listServices', description: 'List active services and methods via Admin API (GET /admin/services).', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, additionalProperties: false } },
          { name: 'describeSchema', description: 'Describe a message/enum schema via Admin API (GET /admin/schema/:type).', inputSchema: { type: 'object', properties: { type: { type: 'string' }, url: { type: 'string' } }, required: ['type'], additionalProperties: false } },
          { name: 'ruleExamples', description: 'Read Wishmock rule examples from docs/rule-examples.md.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        ]});
      case 'tools/call': {
        const { name, arguments: args } = (params || {}) as { name: string; arguments?: any };
        if (!name) return err(id, 'Tool name is required', -32602);
        let result: any;
        if (name === 'listRules') result = await tool_listRules();
        else if (name === 'readRule') result = await tool_readRule(args);
        else if (name === 'writeRule') result = await tool_writeRule(args);
        else if (name === 'listProtos') result = await tool_listProtos();
        else if (name === 'readProto') result = await tool_readProto(args);
        else if (name === 'writeProto') result = await tool_writeProto(args);
        else if (name === 'getStatus') result = await tool_getStatus(args);
        else if (name === 'uploadProto') result = await tool_uploadProto(args);
        else if (name === 'uploadRule') result = await tool_uploadRule(args);
        else if (name === 'listServices') result = await tool_listServices(args);
        else if (name === 'describeSchema') result = await tool_describeSchema(args);
        else if (name === 'ruleExamples') result = await tool_ruleExamples();
        else return err(id, `Unknown tool: ${name}`, -32601);
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
      }
      case 'resources/list': {
        const resources = await listResources();
        return ok(id, { resources });
      }
      case 'resources/read': {
        const { uri } = (params || {}) as { uri: string };
        if (!uri) return err(id, 'uri is required', -32602);
        const { mimeType, text } = await readResource(uri);
        return ok(id, { contents: [{ uri, mimeType, text }] });
      }
      default:
        return err(id, `Method not found: ${method}`, -32601);
    }
  } catch (e: any) {
    return err(id, e?.message || 'Internal error', -32603);
  }
}

export async function start() {
  await ensureDir(RULES_DIR);
  await ensureDir(PROTOS_DIR);

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Connected SSE clients
  const clients = new Set<any>();

  function sendEvent(obj: any) {
    const data = JSON.stringify(obj);
    for (const res of clients) {
      (res as any).write(`data: ${data}\n\n`);
    }
  }
  function sendNamedEvent(eventName: string, obj: any) {
    const data = JSON.stringify(obj);
    for (const res of clients) {
      (res as any).write(`event: ${eventName}\n`);
      (res as any).write(`data: ${data}\n\n`);
    }
  }
  notifyFn = sendEvent;

  app.get('/sse', (req: any, res: any) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    clients.add(res);
    // Initial hello + resource hint
    sendEvent({ jsonrpc: '2.0', method: 'server/ready', params: { name: 'wishmock-mcp-sse' } });
    sendEvent({ jsonrpc: '2.0', method: 'notifications/resources/list_changed', params: {} });

    const keepalive = setInterval(() => {
      try { (res as any).write(': keepalive\n\n'); } catch {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      clients.delete(res);
    });
  });

  // Simple endpoint to broadcast arbitrary SSE event objects
  app.post('/event', (req: any, res: any) => {
    const body = req?.body || {};
    let eventObj: any;
    const eventName = typeof body?.event === 'string' ? body.event : undefined;
    if (body && typeof body === 'object' && body.jsonrpc === '2.0' && typeof body.method === 'string') {
      eventObj = body;
    } else if (body && typeof body?.method === 'string') {
      eventObj = { jsonrpc: '2.0', method: String(body.method), params: body.params ?? {} };
    } else {
      res.status(400).json({ ok: false, error: 'Provide { method, params? } or full JSON-RPC object' });
      return;
    }
    if (eventName) sendNamedEvent(eventName, eventObj);
    else sendEvent(eventObj);
    res.json({ ok: true });
  });

  // Convenience endpoint to notify clients that resources changed
  app.post('/notify/resources-changed', (_req: any, res: any) => {
    sendEvent({ jsonrpc: '2.0', method: 'notifications/resources/list_changed', params: {} });
    res.json({ ok: true });
  });

  async function handleIncoming(req: any, res: any) {
    const msg = (req.body as unknown) as JsonRpcRequest;
    // If this is a notification (no id), accept and return 202 with no body
    if (msg && (msg as any).id === undefined) {
      // For streamable HTTP, include session id header
      res.setHeader('mcp-session-id', SESSION_ID);
      res.status(202).end();
      return;
    }
    const response = await handleRequest(msg);
    // Include session id header for streamable HTTP
    res.setHeader('mcp-session-id', SESSION_ID);
    // Also return immediate JSON response for convenience
    try { res.json(response); } catch { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(response)); }
  }

  // Accept POSTs to the SSE path as some clients send to the same endpoint
  app.post('/sse', handleIncoming);
  app.post('/message', handleIncoming);
  app.post('/rpc', handleIncoming);
  app.post('/', handleIncoming);

  const server = http.createServer(app);
  server.listen(MCP_HTTP_PORT, MCP_HTTP_HOST, () => {
    console.log(`[mcp-sse] listening on http://${MCP_HTTP_HOST}:${MCP_HTTP_PORT}/sse`);
  });
}

export default start;

// If this module is executed directly (not imported), start the server.
// Works in both Bun and Node ESM environments.
const isDirectRun = (() => {
  try {
    return !!(process?.argv?.[1] && fileURLToPath(import.meta.url) === process.argv[1]);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  start().catch((err) => {
    console.error('[mcp-sse] failed to start:', err);
    process.exit(1);
  });
}

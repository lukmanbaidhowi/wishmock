/*
 SDK-based MCP server for Wishmock.
 - Uses @modelcontextprotocol/sdk (McpServer) over stdio
 - Exposes tools for rules/protos + Admin API helpers
 - Exposes resources for rules/protos via URI templates

 This file uses the high-level McpServer API from the SDK.
*/

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { resolve, dirname } from 'path';
import { ensureDir, listFiles, resolveBasePaths, httpGetJson as httpGet } from './utils.js';
import { fileURLToPath } from 'url';

const MODULE_FILENAME = fileURLToPath(import.meta.url);
const MODULE_DIR = dirname(MODULE_FILENAME);
const PACKAGE_BASE_DIR = resolve(MODULE_DIR, '..', '..');
const { BASE_DIR, RULES_DIR, PROTOS_DIR } = resolveBasePaths(import.meta.url);
const RULE_EXAMPLES_PATH = resolve(BASE_DIR, process.env.WISHMOCK_RULES_EXAMPLES_PATH || 'docs/rule-examples.md');
const GLOBAL_RULE_EXAMPLES_PATH = resolve(PACKAGE_BASE_DIR, 'docs', 'rule-examples.md');
const RULE_EXAMPLES_SEARCH_PATHS = RULE_EXAMPLES_PATH === GLOBAL_RULE_EXAMPLES_PATH
  ? [RULE_EXAMPLES_PATH]
  : [RULE_EXAMPLES_PATH, GLOBAL_RULE_EXAMPLES_PATH];
// Keep MCP defaults aligned with configurable Admin HTTP port.
function stripTrailingSlashes(value: string): string {
  let trimmed = value;
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

const ADMIN_BASE_URL = stripTrailingSlashes(process.env.ADMIN_BASE_URL || `http://localhost:${process.env.HTTP_PORT || '4319'}`);
const schemaBase = (url?: string) => stripTrailingSlashes(url || ADMIN_BASE_URL);

export async function start() {
  await ensureDir(RULES_DIR);
  await ensureDir(PROTOS_DIR);

  const server = new McpServer({
    name: 'wishmock-mcp',
    version: '0.1.0',
  }, {
    capabilities: {
      tools: {},
      resources: { listChanged: true },
    },
  });

  async function readRuleExamples(): Promise<{ path: string; content: string } | null> {
    for (const path of RULE_EXAMPLES_SEARCH_PATHS) {
      try {
        const content = await fs.readFile(path, 'utf8');
        return { path, content };
      } catch (err: any) {
        if (err?.code && err.code !== 'ENOENT') throw err;
      }
    }
    return null;
  }

  // Tools
  server.tool('listRules', 'List gRPC rule files under rules/grpc.', async (_extra) => ({
    content: [],
    structuredContent: { files: await listFiles(RULES_DIR, ['.yaml', '.yml', '.json']) }
  }));

  server.tool('readRule', 'Read a rule file content.', z.object({ filename: z.string() }).strict().shape, async ({ filename }: { filename: string }, _extra) => {
    const text = await fs.readFile(resolve(RULES_DIR, filename), 'utf8');
    return { content: [], structuredContent: { filename, content: text } };
  });

  server.tool('writeRule', 'Write content to a rule file (YAML/JSON).', z.object({ filename: z.string(), content: z.string() }).strict().shape, async ({ filename, content }: { filename: string; content: string }, _extra) => {
    await ensureDir(RULES_DIR);
    await fs.writeFile(resolve(RULES_DIR, filename), content, 'utf8');
    return { content: [], structuredContent: { filename, bytes: Buffer.byteLength(content, 'utf8') } };
  });

  server.tool('listProtos', 'List proto files under protos/.', async (_extra) => ({
    content: [],
    structuredContent: { files: await listFiles(PROTOS_DIR, ['.proto']) }
  }));

  server.tool('readProto', 'Read a proto file content.', z.object({ filename: z.string() }).strict().shape, async ({ filename }: { filename: string }, _extra) => {
    const text = await fs.readFile(resolve(PROTOS_DIR, filename), 'utf8');
    return { content: [], structuredContent: { filename, content: text } };
  });

  server.tool('writeProto', 'Write content to a proto file.', z.object({ filename: z.string(), content: z.string() }).strict().shape, async ({ filename, content }: { filename: string; content: string }, _extra) => {
    await ensureDir(PROTOS_DIR);
    await fs.writeFile(resolve(PROTOS_DIR, filename), content, 'utf8');
    return { content: [], structuredContent: { filename, bytes: Buffer.byteLength(content, 'utf8') } };
  });

  server.tool('getStatus', 'Fetch admin status (HTTP) or filesystem fallback.', z.object({ url: z.string().optional() }).strict().partial().shape, async ({ url }: { url?: string }, _extra) => {
    try {
      const status = await httpGet(url || `${ADMIN_BASE_URL}/admin/status`);
      return { content: [], structuredContent: { source: 'admin', status } };
    } catch {
      const rules = await listFiles(RULES_DIR, ['.yaml', '.yml', '.json']);
      const protos = await listFiles(PROTOS_DIR, ['.proto']);
      return { content: [], structuredContent: { source: 'filesystem', status: { rules: rules.length, protos: protos.length } } };
    }
  });

  server.tool('uploadProto', 'Upload a proto via Admin API (POST /admin/upload/proto).', z.object({ filename: z.string(), content: z.string(), url: z.string().optional() }).strict().shape, async ({ filename, content, url }: { filename: string; content: string; url?: string }, _extra) => {
    const targetUrl = url || `${ADMIN_BASE_URL}/admin/upload/proto`;
    const res = await fetch(targetUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename, content }) });
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { content: [], structuredContent: { ok: res.ok, status: res.status, body } };
  });

  server.tool('uploadRule', 'Upload a gRPC rule via Admin API (POST /admin/upload/rule/grpc).', z.object({ filename: z.string(), content: z.string(), url: z.string().optional() }).strict().shape, async ({ filename, content, url }: { filename: string; content: string; url?: string }, _extra) => {
    const targetUrl = url || `${ADMIN_BASE_URL}/admin/upload/rule/grpc`;
    const res = await fetch(targetUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename, content }) });
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { content: [], structuredContent: { ok: res.ok, status: res.status, body } };
  });

  server.tool('listServices', 'List active services and methods via Admin API (GET /admin/services).', z.object({ url: z.string().optional() }).strict().partial().shape, async ({ url }: { url?: string }, _extra) => {
    const payload = await httpGet(url || `${ADMIN_BASE_URL}/admin/services`);
    return { content: [], structuredContent: payload };
  });

  server.tool('describeSchema', 'Describe a message/enum schema via Admin API (GET /admin/schema/:type).', z.object({ type: z.string(), url: z.string().optional() }).strict().shape, async ({ type, url }: { type: string; url?: string }, _extra) => {
    const base = schemaBase(url);
    const payload = await httpGet(`${base}/admin/schema/${encodeURIComponent(type)}`);
    return { content: [], structuredContent: payload };
  });

  server.tool('ruleExamples', 'Read Wishmock rule examples from docs/rule-examples.md.', async (_extra) => {
    const result = await readRuleExamples();
    if (result) {
      return {
        content: [],
        structuredContent: { path: result.path, content: result.content },
      };
    }
    return {
      content: [{ type: 'text', text: `Rule examples file not found. Looked in: ${RULE_EXAMPLES_SEARCH_PATHS.join(', ')}.` }],
      isError: true,
    };
  });

  // Resources
  const rulesTemplate = new ResourceTemplate('wishmock://rules/{filename}', {
    list: async () => ({
      resources: (await listFiles(RULES_DIR, ['.yaml', '.yml', '.json'])).map((f) => ({
        uri: `wishmock://rules/${encodeURIComponent(f)}`,
        name: `Rule: ${f}`,
        mimeType: f.endsWith('.json') ? 'application/json' : 'text/yaml',
      })),
    }),
  });
  server.resource('rules', rulesTemplate, async (_uri, variables) => {
    const filename = String(variables.filename || '');
    if (!filename) throw new Error('Invalid resource URI');
    const text = await fs.readFile(resolve(RULES_DIR, filename), 'utf8');
    return { contents: [{ uri: `wishmock://rules/${encodeURIComponent(filename)}`, mimeType: filename.endsWith('.json') ? 'application/json' : 'text/yaml', text }] };
  });

  const protosTemplate = new ResourceTemplate('wishmock://protos/{filename}', {
    list: async () => ({
      resources: (await listFiles(PROTOS_DIR, ['.proto'])).map((f) => ({
        uri: `wishmock://protos/${encodeURIComponent(f)}`,
        name: `Proto: ${f}`,
        mimeType: 'text/x-proto',
      })),
    }),
  });
  server.resource('protos', protosTemplate, async (_uri, variables) => {
    const filename = String(variables.filename || '');
    if (!filename) throw new Error('Invalid resource URI');
    const text = await fs.readFile(resolve(PROTOS_DIR, filename), 'utf8');
    return { contents: [{ uri: `wishmock://protos/${encodeURIComponent(filename)}`, mimeType: 'text/x-proto', text }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export default start;

// If this module is executed directly (not imported), start the server.
// Works in both Bun and Node ESM environments.
const isDirectRun = (() => {
  try {
    return !!(process?.argv?.[1] && MODULE_FILENAME === process.argv[1]);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  start().catch((err) => {
    console.error('[mcp-stdio] failed to start:', err);
    process.exit(1);
  });
}

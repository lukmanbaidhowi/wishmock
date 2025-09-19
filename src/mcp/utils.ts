import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { resolve, dirname, join as joinPath } from 'path';
import { fileURLToPath } from 'url';

export function resolveBasePaths(moduleUrl: string) {
  const CWD = process.cwd();
  const envBase = process.env.WISHMOCK_BASE_DIR;
  let baseDir: string;
  if (envBase) {
    baseDir = resolve(CWD, envBase);
  } else {
    try {
      const moduleDir = dirname(fileURLToPath(moduleUrl));
      const candidate = resolve(moduleDir, '..', '..');
      if (existsSync(resolve(candidate, 'rules')) || existsSync(resolve(candidate, 'rules', 'grpc')) || existsSync(resolve(candidate, 'protos'))) {
        baseDir = candidate;
      } else {
        baseDir = CWD;
      }
    } catch {
      baseDir = CWD;
    }
  }
  const defaultRulesRelative = process.env.WISHMOCK_RULES_DIR || joinPath('rules', 'grpc');
  const rulesDir = resolve(baseDir, defaultRulesRelative);
  const protosDir = resolve(baseDir, process.env.WISHMOCK_PROTOS_DIR || 'protos');
  return { BASE_DIR: baseDir, RULES_DIR: rulesDir, PROTOS_DIR: protosDir };
}

export async function ensureDir(path: string) {
  try { await fs.mkdir(path, { recursive: true }); } catch {}
}

export async function listFiles(dir: string, exts: string[]) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((n) => exts.some((e) => n.toLowerCase().endsWith(e)));
  } catch { return []; }
}

export function safeJson(text: string): any { try { return JSON.parse(text); } catch { return text; } }

export async function httpGetJson(url: string): Promise<any> {
  const res = await fetch(url);
  const text = await res.text();
  return safeJson(text);
}

import fs from "fs";
import path from "path";

export interface FileItem {
  filename: string;
  path: string;
}

export function listFiles(dir: string, extensions: readonly string[]): FileItem[] {
  return fs.readdirSync(dir)
    .filter(f => extensions.some(ext => f.endsWith(ext)))
    .map(f => ({ filename: f, path: path.join(dir, f) }));
}

export function readFile(dir: string, filename: string): string {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filename}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

export function writeFile(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

// Writes a file to a subpath under the given root directory, creating
// parent directories as needed. The provided relPath must be relative
// (no path traversal). Callers are responsible for validating relPath.
export function writeFileAtPath(rootDir: string, relPath: string, content: string): string {
  const abs = path.resolve(rootDir, path.normalize(relPath));
  const rootAbs = path.resolve(rootDir) + path.sep;
  if (!(abs + path.sep).startsWith(rootAbs) && abs !== rootAbs.slice(0, -1)) {
    throw new Error("resolved path escapes root directory");
  }
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

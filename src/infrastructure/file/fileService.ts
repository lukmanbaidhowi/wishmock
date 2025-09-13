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
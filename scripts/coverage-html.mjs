#!/usr/bin/env bun
// Generate rich HTML coverage from Bun's coverage (text + LCOV)
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function run(cmd, args) {
  const proc = Bun.spawnSync({ cmd: [cmd, ...args] });
  if (proc.exitCode !== 0) {
    // Still capture output to help debugging when tests fail
    const out = new TextDecoder().decode(proc.stdout || new Uint8Array());
    const err = new TextDecoder().decode(proc.stderr || new Uint8Array());
    throw new Error(`Failed to run ${cmd} ${args.join(' ')} (exit ${proc.exitCode})\n${out}${err}`);
  }
  const out = new TextDecoder().decode(proc.stdout || new Uint8Array());
  const err = new TextDecoder().decode(proc.stderr || new Uint8Array());
  return `${out}${err}`;
}

// Run tests and produce LCOV + text reports
const out = run("bun", [
  "test",
  "--coverage",
  "--coverage-reporter=lcov",
  "--coverage-reporter=text",
  "--coverage-dir=coverage",
]);

// Extract coverage table and summary lines
const lines = out.split(/\r?\n/);
const startIdx = lines.findIndex(l => l.startsWith("File"));
let table = "";
if (startIdx !== -1) {
  table = lines.slice(startIdx).join("\n");
} else {
  table = out;
}

// Try to read LCOV for per-line details
let lcov = "";
try {
  lcov = readFileSync("coverage/lcov.info", "utf8");
} catch {}

function parseLCOV(lcovText) {
  const files = [];
  let current = null;
  for (const raw of lcovText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      if (current) files.push(current);
      current = { file: line.slice(3), lines: new Map() };
    } else if (line.startsWith("DA:")) {
      const [ln, hits] = line.slice(3).split(",").map((x) => parseInt(x, 10));
      if (current) current.lines.set(ln, hits);
    } else if (line === "end_of_record") {
      if (current) {
        files.push(current);
        current = null;
      }
    }
  }
  if (current) files.push(current);

  return files.map((f) => {
    const total = f.lines.size;
    let covered = 0;
    const uncovered = [];
    for (const [ln, hits] of f.lines) {
      if (hits > 0) covered++;
      else uncovered.push(ln);
    }
    const pct = total ? (covered / total) * 100 : 100;
    return { file: f.file, total, covered, pct, uncovered, lines: f.lines };
  }).sort((a, b) => a.file.localeCompare(b.file));
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
}

function writeFileReport(baseDir, entry) {
  let src = "";
  try { src = readFileSync(entry.file, "utf8"); } catch {}
  const lines = src ? src.split(/\r?\n/) : [];
  const maxWidth = String(Math.max(lines.length, 1)).length;
  const rows = [];
  for (let i = 1; i <= Math.max(lines.length, 1); i++) {
    const code = lines[i - 1] ?? "";
    const hasData = entry.lines.has(i);
    const hits = hasData ? (entry.lines.get(i) ?? 0) : "";
    const cls = hasData ? (Number(hits) > 0 ? "hit" : "miss") : "neutral";
    const ln = String(i).padStart(maxWidth, " ");
    rows.push(`<tr class="${cls}"><td class="ln">${ln}</td><td class="hits">${hits}</td><td class="code"><code>${escapeHtml(code)}</code></td></tr>`);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Coverage: ${escapeHtml(entry.file)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    .meta { color: #555; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td { vertical-align: top; white-space: pre; }
    td.ln { padding-right: 8px; color: #888; user-select: none; }
    td.hits { padding-right: 8px; color: #888; user-select: none; }
    td.code { width: 100%; }
    tr.miss td.code { background: rgba(255, 0, 0, 0.10); }
    tr.hit td.code { background: rgba(0, 255, 0, 0.05); }
    tr.neutral td.code { background: transparent; }
    .summary { margin-bottom: 12px; }
    a { color: inherit; }
  </style>
  </head>
<body>
  <div class="summary"><a href="../index.html">&#8592; Back</a></div>
  <h1>${escapeHtml(entry.file)}</h1>
  <div class="meta">Lines: ${entry.covered}/${entry.total} (${entry.pct.toFixed(2)}%) • Uncovered: ${entry.uncovered.join(", ") || "-"}</div>
  <table>
    <tbody>
      ${rows.join("\n")}
    </tbody>
  </table>
</body>

</html>`;

  const outPath = join(baseDir, entry.file + ".html");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
}

let details = [];
if (lcov) {
  const entries = parseLCOV(lcov);
  const base = "coverage/html";
  for (const e of entries) writeFileReport(base, e);
  details = entries;
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bun Coverage Report</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    .meta { color: #555; margin-bottom: 12px; }
    pre { background:#0b1020; color:#e6edf3; padding:16px; border-radius:8px; overflow:auto; }
    .note { margin-top: 12px; color:#666; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #2e354a; }
    th { position: sticky; top: 0; background: #0b1020; color:#e6edf3; }
    a { color: inherit; }
  </style>
  </head>
<body>
  <h1>Bun Test Coverage</h1>
  <div class="meta">Generated: ${new Date().toISOString()}</div>
  ${details.length ? `
  <table>
    <thead>
      <tr>
        <th>File</th>
        <th>% Lines</th>
        <th>Covered</th>
        <th>Uncovered Line #s</th>
      </tr>
    </thead>
    <tbody>
      ${details.map(d => {
        const link = `html/${d.file}.html`;
        return `<tr>
          <td><a href="${escapeHtml(link)}">${escapeHtml(d.file)}</a></td>
          <td>${d.pct.toFixed(2)}</td>
          <td>${d.covered}/${d.total}</td>
          <td>${d.uncovered.join(', ') || '-'}</td>
        </tr>`;
      }).join('\n')}
    </tbody>
  </table>
  ` : ""}
  <pre>${table.replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre>
  <div class="note">Source: output of <code>bun test --coverage --coverage-reporter=lcov</code></div>
</body>
</html>`;

mkdirSync("coverage", { recursive: true });
writeFileSync("coverage/index.html", html);
console.log("Wrote coverage/index.html with per-file details", details.length ? `(${details.length} files)` : "");

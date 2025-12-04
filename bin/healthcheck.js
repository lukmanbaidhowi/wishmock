#!/usr/bin/env bun
// Simple healthcheck using Bun's fetch
const url = process.env.HEALTHCHECK_URL || 'http://localhost:4319/liveness';
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 2000);

const controller = new AbortController();
const t = setTimeout(() => controller.abort(), timeoutMs);

try {
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(t);
  if (res.ok) process.exit(0);
  process.exit(1);
} catch {
  clearTimeout(t);
  process.exit(1);
}

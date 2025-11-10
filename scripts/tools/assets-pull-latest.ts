#!/usr/bin/env bun

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.cwd();
const CANONICAL_PROTOS = join(PROJECT_ROOT, 'uploads', 'protos', 'canonical');
const CANONICAL_RULES = join(PROJECT_ROOT, 'uploads', 'rules', 'canonical');
const UPLOADS_DIR = join(PROJECT_ROOT, 'uploads');

function log(message: string) {
  console.log(`[assets-pull-latest] ${message}`);
}

function error(message: string) {
  console.error(`[assets-pull-latest] ERROR: ${message}`);
}

function copyDirectory(source: string, dest: string) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const items = readdirSync(source);
  for (const item of items) {
    const sourcePath = join(source, item);
    const destPath = join(dest, item);
    
    if (statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, destPath);
    } else {
      copyFileSync(sourcePath, destPath);
    }
  }
}

async function main() {
  log('Pulling latest canonical assets...');

  if (!existsSync(CANONICAL_PROTOS) && !existsSync(CANONICAL_RULES)) {
    error('Canonical bundle directories not found');
    error('Expected: uploads/protos/canonical/ or uploads/rules/canonical/');
    process.exit(1);
  }

  const version = new Date().toISOString().replace(/[:.]/g, '-');
  const protosVersion = join(UPLOADS_DIR, 'protos', version);
  const rulesVersion = join(UPLOADS_DIR, 'rules', version);

  let protoCount = 0;
  let ruleCount = 0;

  if (existsSync(CANONICAL_PROTOS)) {
    const files = readdirSync(CANONICAL_PROTOS);
    if (files.length > 0) {
      log('Copying canonical protos...');
      copyDirectory(CANONICAL_PROTOS, protosVersion);
      protoCount = files.filter(f => f.endsWith('.proto')).length;
      log(`Copied ${protoCount} proto files`);
    }
  }

  if (existsSync(CANONICAL_RULES)) {
    const files = readdirSync(CANONICAL_RULES);
    if (files.length > 0) {
      log('Copying canonical rules...');
      copyDirectory(CANONICAL_RULES, rulesVersion);
      ruleCount = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
      log(`Copied ${ruleCount} rule files`);
    }
  }

  if (protoCount === 0 && ruleCount === 0) {
    error('No assets found in canonical directories');
    process.exit(1);
  }

  const currentFile = join(UPLOADS_DIR, 'current.json');
  const pointer = {
    version,
    created_by: 'assets-pull-latest',
    updated_at: new Date().toISOString()
  };

  writeFileSync(currentFile, JSON.stringify(pointer, null, 2));

  log(`Activated bundle version: ${version}`);
  log('✓ Assets pull completed successfully');
  process.exit(0);
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});


#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(normalizeJson);
  }

  const sorted = {};
  Object.keys(obj)
    .sort()
    .forEach(key => {
      sorted[key] = normalizeJson(obj[key]);
    });
  return sorted;
}

function deepEqual(obj1, obj2, path = []) {
  if (obj1 === obj2) return { equal: true, diffs: [] };

  if (obj1 === null || obj2 === null || typeof obj1 !== 'object' || typeof obj2 !== 'object') {
    return {
      equal: false,
      diffs: [{
        path: path.join('.'),
        expected: obj2,
        actual: obj1
      }]
    };
  }

  if (Array.isArray(obj1) !== Array.isArray(obj2)) {
    return {
      equal: false,
      diffs: [{
        path: path.join('.'),
        expected: obj2,
        actual: obj1,
        reason: 'Type mismatch: array vs object'
      }]
    };
  }

  if (Array.isArray(obj1)) {
    if (obj1.length !== obj2.length) {
      return {
        equal: false,
        diffs: [{
          path: path.join('.'),
          expected: `length ${obj2.length}`,
          actual: `length ${obj1.length}`,
          reason: 'Array length mismatch'
        }]
      };
    }

    const diffs = [];
    for (let i = 0; i < obj1.length; i++) {
      const result = deepEqual(obj1[i], obj2[i], [...path, `[${i}]`]);
      if (!result.equal) {
        diffs.push(...result.diffs);
      }
    }
    return { equal: diffs.length === 0, diffs };
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  const allKeys = new Set([...keys1, ...keys2]);

  const diffs = [];
  for (const key of allKeys) {
    if (!(key in obj1)) {
      diffs.push({
        path: [...path, key].join('.'),
        expected: obj2[key],
        actual: undefined,
        reason: 'Missing in actual'
      });
    } else if (!(key in obj2)) {
      diffs.push({
        path: [...path, key].join('.'),
        expected: undefined,
        actual: obj1[key],
        reason: 'Extra in actual'
      });
    } else {
      const result = deepEqual(obj1[key], obj2[key], [...path, key]);
      if (!result.equal) {
        diffs.push(...result.diffs);
      }
    }
  }

  return { equal: diffs.length === 0, diffs };
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: assert-json-diff.mjs <actual.json> <expected.json> [output-diff.json]');
    process.exit(1);
  }

  const [actualPath, expectedPath, diffPath] = args;

  try {
    const actualContent = readFileSync(actualPath, 'utf-8');
    const expectedContent = readFileSync(expectedPath, 'utf-8');

    const actual = normalizeJson(JSON.parse(actualContent));
    const expected = normalizeJson(JSON.parse(expectedContent));

    const result = deepEqual(actual, expected);

    const output = {
      match: result.equal,
      diff_count: result.diffs.length,
      differences: result.diffs
    };

    if (diffPath) {
      writeFileSync(diffPath, JSON.stringify(output, null, 2));
    }

    if (result.equal) {
      console.log('✓ JSON matches expected output');
      process.exit(0);
    } else {
      console.error(`✗ JSON differs from expected (${result.diffs.length} differences)`);
      console.error(JSON.stringify(output, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
}

main();


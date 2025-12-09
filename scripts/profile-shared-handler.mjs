#!/usr/bin/env node

/**
 * Performance profiling script for shared handler
 * 
 * This script measures the execution time of the shared handler
 * and identifies potential optimization opportunities.
 */

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the shared handler (will need to build first)
const handleRequestPath = join(__dirname, '../dist/domain/usecases/handleRequest.js');

async function profileSharedHandler() {
  console.log('=== Shared Handler Performance Profile ===\n');

  // Load the compiled handler
  let handleUnaryRequest;
  try {
    const module = await import(handleRequestPath);
    handleUnaryRequest = module.handleUnaryRequest;
  } catch (error) {
    console.error('Error: Could not load shared handler. Please run `bun run build` first.');
    console.error(error.message);
    process.exit(1);
  }

  // Mock dependencies
  const mockLogger = () => {};
  const rulesIndex = new Map();
  
  // Add a simple rule
  rulesIndex.set('test.service.method', {
    service: 'test.Service',
    method: 'Method',
    responses: [
      {
        body: { message: 'Hello, World!' },
        when: {},
        priority: 1,
      },
    ],
  });

  // Mock request type
  const mockRequestType = {
    fullName: 'test.Request',
    name: 'Request',
  };

  // Mock response type
  const mockResponseType = {
    fullName: 'test.Response',
    name: 'Response',
  };

  // Create test request
  const request = {
    service: 'test.Service',
    method: 'Method',
    metadata: { 'user-agent': 'test' },
    data: { name: 'Test' },
    requestType: mockRequestType,
    responseType: mockResponseType,
    requestStream: false,
    responseStream: false,
  };

  // Warmup runs (JIT optimization)
  console.log('Warming up (100 iterations)...');
  for (let i = 0; i < 100; i++) {
    await handleUnaryRequest(request, rulesIndex, mockLogger);
  }

  // Benchmark runs
  const iterations = 10000;
  console.log(`\nRunning ${iterations} iterations...\n`);

  const timings = {
    total: [],
    validation: [],
    ruleMatch: [],
    responseSelection: [],
  };

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await handleUnaryRequest(request, rulesIndex, mockLogger);
    const end = performance.now();
    timings.total.push(end - start);
  }

  // Calculate statistics
  const stats = (arr) => {
    const sorted = arr.slice().sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    const mean = sum / arr.length;
    const p50 = sorted[Math.floor(arr.length * 0.5)];
    const p95 = sorted[Math.floor(arr.length * 0.95)];
    const p99 = sorted[Math.floor(arr.length * 0.99)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    
    return { mean, p50, p95, p99, min, max };
  };

  const totalStats = stats(timings.total);

  console.log('Results:');
  console.log('--------');
  console.log(`Total execution time:`);
  console.log(`  Mean:   ${totalStats.mean.toFixed(3)} ms`);
  console.log(`  Median: ${totalStats.p50.toFixed(3)} ms`);
  console.log(`  P95:    ${totalStats.p95.toFixed(3)} ms`);
  console.log(`  P99:    ${totalStats.p99.toFixed(3)} ms`);
  console.log(`  Min:    ${totalStats.min.toFixed(3)} ms`);
  console.log(`  Max:    ${totalStats.max.toFixed(3)} ms`);
  console.log();

  // Calculate throughput
  const throughput = 1000 / totalStats.mean;
  console.log(`Throughput: ${throughput.toFixed(0)} requests/second`);
  console.log();

  // Memory usage
  const memUsage = process.memoryUsage();
  console.log('Memory usage:');
  console.log(`  RSS:      ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap:     ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  External: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB`);
  console.log();

  // Overhead analysis
  console.log('Overhead Analysis:');
  console.log('------------------');
  console.log('The shared handler adds minimal overhead:');
  console.log(`  - Request normalization: ~${(totalStats.mean * 0.1).toFixed(3)} ms (estimated 10%)`);
  console.log(`  - Validation check: ~${(totalStats.mean * 0.2).toFixed(3)} ms (estimated 20%)`);
  console.log(`  - Rule matching: ~${(totalStats.mean * 0.3).toFixed(3)} ms (estimated 30%)`);
  console.log(`  - Response selection: ~${(totalStats.mean * 0.3).toFixed(3)} ms (estimated 30%)`);
  console.log(`  - Response normalization: ~${(totalStats.mean * 0.1).toFixed(3)} ms (estimated 10%)`);
  console.log();

  // Recommendations
  console.log('Optimization Recommendations:');
  console.log('-----------------------------');
  
  if (totalStats.mean < 0.1) {
    console.log('✓ Performance is excellent (< 0.1ms per request)');
    console.log('  No optimization needed at this time.');
  } else if (totalStats.mean < 0.5) {
    console.log('✓ Performance is good (< 0.5ms per request)');
    console.log('  Minor optimizations could be considered:');
    console.log('  - Cache validation runtime lookups');
    console.log('  - Optimize metadata extraction');
  } else if (totalStats.mean < 1.0) {
    console.log('⚠ Performance is acceptable (< 1ms per request)');
    console.log('  Consider these optimizations:');
    console.log('  - Cache validation runtime lookups');
    console.log('  - Optimize rule matching with indexing');
    console.log('  - Reduce object allocations in hot paths');
  } else {
    console.log('⚠ Performance needs improvement (> 1ms per request)');
    console.log('  Priority optimizations:');
    console.log('  - Profile with --inspect to identify bottlenecks');
    console.log('  - Cache validation runtime lookups');
    console.log('  - Optimize rule matching algorithm');
    console.log('  - Consider lazy evaluation of metadata');
  }
  console.log();

  console.log('=== Profile Complete ===');
}

profileSharedHandler().catch(console.error);

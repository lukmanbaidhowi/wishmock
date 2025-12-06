/**
 * Performance Benchmarks for Connect RPC vs Native gRPC
 * 
 * This test suite benchmarks:
 * - Throughput (requests per second)
 * - Memory usage with concurrent connections
 * - Latency across different protocols (Connect, gRPC-Web, gRPC)
 * 
 * Requirements: 1.1, 1.2, 1.3
 * 
 * Skip by default in `bun test`. Set BENCHMARK=true to enable.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createConnectServer, type ConnectServer } from "../src/infrastructure/connectServer.js";
import { createGrpcServer } from "../src/infrastructure/grpcServer.js";
import protobuf from "protobufjs";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import type { RuleDoc } from "../src/domain/types.js";
import * as grpc from "@grpc/grpc-js";
// Note: createPromiseClient not used in this benchmark, using fetch directly

// Skip benchmark tests by default in `bun test`.
// Set BENCHMARK=true to enable running these tests.
const describeBenchmark = (process.env.BENCHMARK === "true" || process.env.RUN_BENCHMARK === "true") ? describe : (describe as any).skip;

// Benchmark configuration
const WARMUP_REQUESTS = 100;
const BENCHMARK_REQUESTS = 1000;
const CONCURRENT_CONNECTIONS = [1, 10, 50, 100];
const LATENCY_SAMPLES = 100;

interface BenchmarkResult {
  protocol: string;
  metric: string;
  value: number;
  unit: string;
  concurrency?: number;
}

interface LatencyStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
}

describeBenchmark("Performance Benchmarks", () => {
  let protoRoot: protobuf.Root;
  let rulesIndex: Map<string, RuleDoc>;
  let connectServer: ConnectServer | null = null;
  let grpcServer: grpc.Server | null = null;
  let connectPort: number;
  let grpcPort: number;
  let results: BenchmarkResult[] = [];

  beforeAll(async () => {
    // Find available ports
    connectPort = 50052;
    grpcPort = 50053;

    // Load proto files
    const helloworldProto = path.join(process.cwd(), "protos", "helloworld.proto");
    
    protoRoot = new protobuf.Root();
    protoRoot.resolvePath = (origin: string, target: string) => {
      if (target.startsWith("validate/") || target.startsWith("buf/") || target.startsWith("google/")) {
        return path.join(process.cwd(), "protos", target);
      }
      return target;
    };
    
    await protoRoot.load(helloworldProto, { keepCase: true });

    // Load rule files
    rulesIndex = new Map();
    const rulesDir = path.join(process.cwd(), "rules", "grpc");
    
    const sayHelloRulePath = path.join(rulesDir, "helloworld.greeter.sayhello.yaml");
    if (fs.existsSync(sayHelloRulePath)) {
      const sayHelloRule = yaml.load(fs.readFileSync(sayHelloRulePath, "utf8")) as RuleDoc;
      rulesIndex.set("helloworld.greeter.sayhello", sayHelloRule);
    }

    // Start Connect server
    try {
      connectServer = await createConnectServer({
        port: connectPort,
        corsEnabled: true,
        corsOrigins: ["*"],
        protoRoot,
        rulesIndex,
        logger: () => {}, // Silent logger for benchmarks
        errorLogger: () => {},
      });
      await connectServer.start();
      console.log(`Connect server started on port ${connectPort}`);
    } catch (error) {
      console.error("Failed to start Connect server:", error);
    }

    // Start native gRPC server
    try {
      const { server } = await createGrpcServer(
        protoRoot,
        rulesIndex,
        () => {}, // Silent logger for benchmarks
        () => {}, // Silent error logger
        { protoDir: path.join(process.cwd(), "protos") }
      );
      
      grpcServer = server;
      
      await new Promise<void>((resolve, reject) => {
        grpcServer!.bindAsync(
          `0.0.0.0:${grpcPort}`,
          grpc.ServerCredentials.createInsecure(),
          (error?: Error | null) => {
            if (error) return reject(error);
            grpcServer!.start();
            resolve();
          }
        );
      });
      
      console.log(`gRPC server started on port ${grpcPort}`);
    } catch (error) {
      console.error("Failed to start gRPC server:", error);
    }

    // Warmup phase
    console.log("\nWarming up servers...");
    await warmupServers();
  });

  afterAll(async () => {
    // Print benchmark results
    console.log("\n" + "=".repeat(80));
    console.log("PERFORMANCE BENCHMARK RESULTS");
    console.log("=".repeat(80));
    
    printResultsByCategory("Throughput", "req/s");
    printResultsByCategory("Latency", "ms");
    printResultsByCategory("Memory", "MB");
    
    console.log("=".repeat(80) + "\n");

    // Cleanup
    if (connectServer) {
      await connectServer.stop();
    }
    if (grpcServer) {
      await new Promise<void>((resolve) => {
        grpcServer?.tryShutdown(() => resolve());
      });
    }
  });

  function printResultsByCategory(category: string, unit: string) {
    const categoryResults = results.filter(r => r.metric.includes(category));
    if (categoryResults.length === 0) return;

    console.log(`\n${category} (${unit}):`);
    console.log("-".repeat(80));
    
    for (const result of categoryResults) {
      const concurrency = result.concurrency ? ` [concurrency: ${result.concurrency}]` : "";
      console.log(`  ${result.protocol.padEnd(20)} ${result.metric.padEnd(30)} ${result.value.toFixed(2).padStart(10)} ${unit}${concurrency}`);
    }
  }

  async function warmupServers() {
    // Warmup Connect server
    if (connectServer) {
      for (let i = 0; i < WARMUP_REQUESTS; i++) {
        try {
          await fetch(`http://localhost:${connectPort}/helloworld.Greeter/SayHello`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `Warmup${i}` }),
          });
        } catch (error) {
          // Ignore warmup errors
        }
      }
    }

    // Warmup gRPC server
    if (grpcServer) {
      const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
      const HelloReply = protoRoot.lookupType("helloworld.HelloReply");
      
      const client = new grpc.Client(
        `localhost:${grpcPort}`,
        grpc.credentials.createInsecure()
      );

      for (let i = 0; i < WARMUP_REQUESTS; i++) {
        try {
          await new Promise((resolve, reject) => {
            client.makeUnaryRequest(
              "/helloworld.Greeter/SayHello",
              (arg: any) => Buffer.from(HelloRequest.encode(arg).finish()),
              (arg: Buffer) => HelloReply.decode(arg),
              { name: `Warmup${i}` },
              (error: any, response: any) => {
                if (error) reject(error);
                else resolve(response);
              }
            );
          });
        } catch (error) {
          // Ignore warmup errors
        }
      }

      client.close();
    }

    console.log("Warmup complete\n");
  }

  function calculateLatencyStats(latencies: number[]): LatencyStats {
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  describe("Throughput Benchmarks", () => {
    test("Connect protocol throughput (JSON)", async () => {
      if (!connectServer) {
        console.log("Connect server not available - skipping test");
        return;
      }

      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < BENCHMARK_REQUESTS; i++) {
        promises.push(
          fetch(`http://localhost:${connectPort}/helloworld.Greeter/SayHello`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `User${i}` }),
          })
        );
      }

      await Promise.all(promises);
      const duration = (Date.now() - startTime) / 1000;
      const throughput = BENCHMARK_REQUESTS / duration;

      results.push({
        protocol: "Connect (JSON)",
        metric: "Throughput",
        value: throughput,
        unit: "req/s",
      });

      console.log(`Connect (JSON) throughput: ${throughput.toFixed(2)} req/s`);
      expect(throughput).toBeGreaterThan(0);
    });

    test("Connect protocol throughput (binary)", async () => {
      if (!connectServer) {
        console.log("Connect server not available - skipping test");
        return;
      }

      const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < BENCHMARK_REQUESTS; i++) {
        const message = HelloRequest.create({ name: `User${i}` });
        const buffer = Buffer.from(HelloRequest.encode(message).finish());

        promises.push(
          fetch(`http://localhost:${connectPort}/helloworld.Greeter/SayHello`, {
            method: "POST",
            headers: { "Content-Type": "application/proto" },
            body: buffer,
          })
        );
      }

      await Promise.all(promises);
      const duration = (Date.now() - startTime) / 1000;
      const throughput = BENCHMARK_REQUESTS / duration;

      results.push({
        protocol: "Connect (Binary)",
        metric: "Throughput",
        value: throughput,
        unit: "req/s",
      });

      console.log(`Connect (Binary) throughput: ${throughput.toFixed(2)} req/s`);
      expect(throughput).toBeGreaterThan(0);
    });

    test("Native gRPC throughput", async () => {
      if (!grpcServer) {
        console.log("gRPC server not available - skipping test");
        return;
      }

      const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
      const HelloReply = protoRoot.lookupType("helloworld.HelloReply");
      
      const client = new grpc.Client(
        `localhost:${grpcPort}`,
        grpc.credentials.createInsecure()
      );

      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < BENCHMARK_REQUESTS; i++) {
        promises.push(
          new Promise((resolve, reject) => {
            client.makeUnaryRequest(
              "/helloworld.Greeter/SayHello",
              (arg: any) => Buffer.from(HelloRequest.encode(arg).finish()),
              (arg: Buffer) => HelloReply.decode(arg),
              { name: `User${i}` },
              (error: any, response: any) => {
                if (error) reject(error);
                else resolve(response);
              }
            );
          })
        );
      }

      await Promise.all(promises);
      const duration = (Date.now() - startTime) / 1000;
      const throughput = BENCHMARK_REQUESTS / duration;

      client.close();

      results.push({
        protocol: "Native gRPC",
        metric: "Throughput",
        value: throughput,
        unit: "req/s",
      });

      console.log(`Native gRPC throughput: ${throughput.toFixed(2)} req/s`);
      expect(throughput).toBeGreaterThan(0);
    });
  });

  describe("Latency Benchmarks", () => {
    test("Connect protocol latency (JSON)", async () => {
      if (!connectServer) {
        console.log("Connect server not available - skipping test");
        return;
      }

      const latencies: number[] = [];

      for (let i = 0; i < LATENCY_SAMPLES; i++) {
        const startTime = Date.now();
        await fetch(`http://localhost:${connectPort}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `User${i}` }),
        });
        latencies.push(Date.now() - startTime);
      }

      const stats = calculateLatencyStats(latencies);

      results.push(
        { protocol: "Connect (JSON)", metric: "Latency (mean)", value: stats.mean, unit: "ms" },
        { protocol: "Connect (JSON)", metric: "Latency (median)", value: stats.median, unit: "ms" },
        { protocol: "Connect (JSON)", metric: "Latency (p95)", value: stats.p95, unit: "ms" },
        { protocol: "Connect (JSON)", metric: "Latency (p99)", value: stats.p99, unit: "ms" }
      );

      console.log(`Connect (JSON) latency - mean: ${stats.mean.toFixed(2)}ms, p95: ${stats.p95.toFixed(2)}ms, p99: ${stats.p99.toFixed(2)}ms`);
      expect(stats.mean).toBeGreaterThan(0);
    });

    test("Connect protocol latency (binary)", async () => {
      if (!connectServer) {
        console.log("Connect server not available - skipping test");
        return;
      }

      const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
      const latencies: number[] = [];

      for (let i = 0; i < LATENCY_SAMPLES; i++) {
        const message = HelloRequest.create({ name: `User${i}` });
        const buffer = Buffer.from(HelloRequest.encode(message).finish());

        const startTime = Date.now();
        await fetch(`http://localhost:${connectPort}/helloworld.Greeter/SayHello`, {
          method: "POST",
          headers: { "Content-Type": "application/proto" },
          body: buffer,
        });
        latencies.push(Date.now() - startTime);
      }

      const stats = calculateLatencyStats(latencies);

      results.push(
        { protocol: "Connect (Binary)", metric: "Latency (mean)", value: stats.mean, unit: "ms" },
        { protocol: "Connect (Binary)", metric: "Latency (median)", value: stats.median, unit: "ms" },
        { protocol: "Connect (Binary)", metric: "Latency (p95)", value: stats.p95, unit: "ms" },
        { protocol: "Connect (Binary)", metric: "Latency (p99)", value: stats.p99, unit: "ms" }
      );

      console.log(`Connect (Binary) latency - mean: ${stats.mean.toFixed(2)}ms, p95: ${stats.p95.toFixed(2)}ms, p99: ${stats.p99.toFixed(2)}ms`);
      expect(stats.mean).toBeGreaterThan(0);
    });

    test("Native gRPC latency", async () => {
      if (!grpcServer) {
        console.log("gRPC server not available - skipping test");
        return;
      }

      const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
      const HelloReply = protoRoot.lookupType("helloworld.HelloReply");
      
      const client = new grpc.Client(
        `localhost:${grpcPort}`,
        grpc.credentials.createInsecure()
      );

      const latencies: number[] = [];

      for (let i = 0; i < LATENCY_SAMPLES; i++) {
        const startTime = Date.now();
        await new Promise((resolve, reject) => {
          client.makeUnaryRequest(
            "/helloworld.Greeter/SayHello",
            (arg: any) => Buffer.from(HelloRequest.encode(arg).finish()),
            (arg: Buffer) => HelloReply.decode(arg),
            { name: `User${i}` },
            (error: any, response: any) => {
              if (error) reject(error);
              else resolve(response);
            }
          );
        });
        latencies.push(Date.now() - startTime);
      }

      client.close();

      const stats = calculateLatencyStats(latencies);

      results.push(
        { protocol: "Native gRPC", metric: "Latency (mean)", value: stats.mean, unit: "ms" },
        { protocol: "Native gRPC", metric: "Latency (median)", value: stats.median, unit: "ms" },
        { protocol: "Native gRPC", metric: "Latency (p95)", value: stats.p95, unit: "ms" },
        { protocol: "Native gRPC", metric: "Latency (p99)", value: stats.p99, unit: "ms" }
      );

      console.log(`Native gRPC latency - mean: ${stats.mean.toFixed(2)}ms, p95: ${stats.p95.toFixed(2)}ms, p99: ${stats.p99.toFixed(2)}ms`);
      expect(stats.mean).toBeGreaterThan(0);
    });
  });

  describe("Concurrent Connection Benchmarks", () => {
    for (const concurrency of CONCURRENT_CONNECTIONS) {
      test(`Connect protocol with ${concurrency} concurrent connections`, async () => {
        if (!connectServer) {
          console.log("Connect server not available - skipping test");
          return;
        }

        const requestsPerConnection = Math.floor(BENCHMARK_REQUESTS / concurrency);
        const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        const startTime = Date.now();

        const connectionPromises = [];
        for (let c = 0; c < concurrency; c++) {
          const connectionRequests = [];
          for (let i = 0; i < requestsPerConnection; i++) {
            connectionRequests.push(
              fetch(`http://localhost:${connectPort}/helloworld.Greeter/SayHello`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: `User${c}-${i}` }),
              })
            );
          }
          connectionPromises.push(Promise.all(connectionRequests));
        }

        await Promise.all(connectionPromises);
        
        const duration = (Date.now() - startTime) / 1000;
        const throughput = (requestsPerConnection * concurrency) / duration;
        const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        const memoryUsed = endMemory - startMemory;

        results.push({
          protocol: "Connect (JSON)",
          metric: `Throughput (concurrent)`,
          value: throughput,
          unit: "req/s",
          concurrency,
        });

        results.push({
          protocol: "Connect (JSON)",
          metric: `Memory Usage`,
          value: memoryUsed,
          unit: "MB",
          concurrency,
        });

        console.log(`Connect (JSON) [${concurrency} connections]: ${throughput.toFixed(2)} req/s, memory: ${memoryUsed.toFixed(2)} MB`);
        expect(throughput).toBeGreaterThan(0);
      });

      test(`Native gRPC with ${concurrency} concurrent connections`, async () => {
        if (!grpcServer) {
          console.log("gRPC server not available - skipping test");
          return;
        }

        const HelloRequest = protoRoot.lookupType("helloworld.HelloRequest");
        const HelloReply = protoRoot.lookupType("helloworld.HelloReply");
        
        const requestsPerConnection = Math.floor(BENCHMARK_REQUESTS / concurrency);
        const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        const startTime = Date.now();

        const connectionPromises = [];
        for (let c = 0; c < concurrency; c++) {
          const client = new grpc.Client(
            `localhost:${grpcPort}`,
            grpc.credentials.createInsecure()
          );

          const connectionRequests = [];
          for (let i = 0; i < requestsPerConnection; i++) {
            connectionRequests.push(
              new Promise((resolve, reject) => {
                client.makeUnaryRequest(
                  "/helloworld.Greeter/SayHello",
                  (arg: any) => Buffer.from(HelloRequest.encode(arg).finish()),
                  (arg: Buffer) => HelloReply.decode(arg),
                  { name: `User${c}-${i}` },
                  (error: any, response: any) => {
                    if (error) reject(error);
                    else resolve(response);
                  }
                );
              })
            );
          }

          connectionPromises.push(
            Promise.all(connectionRequests).finally(() => client.close())
          );
        }

        await Promise.all(connectionPromises);
        
        const duration = (Date.now() - startTime) / 1000;
        const throughput = (requestsPerConnection * concurrency) / duration;
        const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        const memoryUsed = endMemory - startMemory;

        results.push({
          protocol: "Native gRPC",
          metric: `Throughput (concurrent)`,
          value: throughput,
          unit: "req/s",
          concurrency,
        });

        results.push({
          protocol: "Native gRPC",
          metric: `Memory Usage`,
          value: memoryUsed,
          unit: "MB",
          concurrency,
        });

        console.log(`Native gRPC [${concurrency} connections]: ${throughput.toFixed(2)} req/s, memory: ${memoryUsed.toFixed(2)} MB`);
        expect(throughput).toBeGreaterThan(0);
      });
    }
  });

  describe("Protocol Comparison Summary", () => {
    test("should generate comparison report", () => {
      // This test just ensures we have collected results
      expect(results.length).toBeGreaterThan(0);
      
      // Calculate relative performance
      const connectThroughput = results.find(
        r => r.protocol === "Connect (JSON)" && r.metric === "Throughput"
      );
      const grpcThroughput = results.find(
        r => r.protocol === "Native gRPC" && r.metric === "Throughput"
      );

      if (connectThroughput && grpcThroughput) {
        const ratio = (connectThroughput.value / grpcThroughput.value) * 100;
        console.log(`\nConnect throughput is ${ratio.toFixed(1)}% of native gRPC`);
      }

      const connectLatency = results.find(
        r => r.protocol === "Connect (JSON)" && r.metric === "Latency (mean)"
      );
      const grpcLatency = results.find(
        r => r.protocol === "Native gRPC" && r.metric === "Latency (mean)"
      );

      if (connectLatency && grpcLatency) {
        const diff = connectLatency.value - grpcLatency.value;
        console.log(`Connect latency is ${diff > 0 ? '+' : ''}${diff.toFixed(2)}ms vs native gRPC`);
      }
    });
  });
});

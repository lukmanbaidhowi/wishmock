// Simple cluster master for zero-downtime rolling restarts (Node runtime)
// Usage:
//  - Build: `bun run build`
//  - Start: `node bin/cluster.mjs`
//  - Rolling restart: send SIGHUP or SIGUSR2 to the master process

import cluster from 'node:cluster';
import os from 'node:os';
import process from 'node:process';

const WORKERS = Math.max(1, Number(process.env.CLUSTER_WORKERS || os.cpus().length));

if (cluster.isPrimary) {
  const readyWorkers = new Set();

  function forkOne() {
    const w = cluster.fork();
    w.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        readyWorkers.add(w.id);
        console.log(`[cluster] worker ${w.id} ready (${readyWorkers.size}/${Object.keys(cluster.workers || {}).length})`);
        return;
      }
      if (msg.type === 'rolling-restart') {
        console.log(`[cluster] worker ${w.id} requested rolling restart (${msg.reason || 'no reason'})`);
        scheduleRollingRestart();
        return;
      }
    });
    w.on('exit', (code, signal) => {
      readyWorkers.delete(w.id);
      console.log(`[cluster] worker ${w.id} exited code=${code} signal=${signal}`);
      // Auto-replace unexpected exits
      if (!restarting) {
        console.log('[cluster] spawning replacement worker');
        forkOne();
      }
    });
    return w;
  }

  // Spawn initial workers
  console.log(`[cluster] master ${process.pid} starting ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) forkOne();

  let restarting = false;

  async function waitForReady(worker) {
    if (readyWorkers.has(worker.id)) return;
    await new Promise((resolve) => {
      const onMsg = (msg) => {
        if (msg && msg.type === 'ready') {
          worker.off('message', onMsg);
          resolve();
        }
      };
      worker.on('message', onMsg);
    });
  }

  async function rollingRestart() {
    if (restarting) return;
    restarting = true;
    try {
      const current = Object.values(cluster.workers || {}).filter(Boolean);
      console.log(`[cluster] rolling restart over ${current.length} workers`);
      for (const oldWorker of current) {
        const nw = forkOne();
        await waitForReady(nw);
        console.log(`[cluster] disconnecting old worker ${oldWorker.id}`);
        oldWorker.disconnect();
        await new Promise((resolve) => oldWorker.on('exit', resolve));
      }
      console.log('[cluster] rolling restart complete');
    } finally {
      restarting = false;
    }
  }

  // Debounced trigger to collapse rapid-fire requests (e.g., multiple file uploads)
  let restartTimer = null;
  function scheduleRollingRestart() {
    if (restarting) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void rollingRestart();
    }, 500);
  }

  process.on('SIGHUP', () => {
    console.log('[cluster] SIGHUP received → rolling restart');
    void rollingRestart();
  });
  process.on('SIGUSR2', () => {
    console.log('[cluster] SIGUSR2 received → rolling restart');
    void rollingRestart();
  });

  // Graceful master shutdown: disconnect all workers
  async function shutdownAll() {
    const workers = Object.values(cluster.workers || {}).filter(Boolean);
    for (const w of workers) w.disconnect();
    await Promise.all(workers.map((w) => new Promise((r) => w.on('exit', r))));
  }
  process.on('SIGTERM', () => {
    console.log('[cluster] SIGTERM received → shutting down');
    shutdownAll().finally(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    console.log('[cluster] SIGINT received → shutting down');
    shutdownAll().finally(() => process.exit(0));
  });
} else {
  // Worker path: run the app
  // Note: this file is ESM and package.json has "type":"module"
  // Importing the built app initializes gRPC/HTTP servers
  await import('../dist/app.js');
}

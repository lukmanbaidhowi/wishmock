#!/usr/bin/env node
// Entry for npx / global install. Assumes TypeScript has been compiled to dist/.
// The app bootstraps and starts on import.
(async () => {
  try {
    await import('../dist/app.js');
  } catch (e) {
    console.error('[grpc-server-mock] Failed to start. Did you build?');
    console.error('[grpc-server-mock] Try: npm run start:node (which builds)');
    console.error(e);
    process.exit(1);
  }
})();

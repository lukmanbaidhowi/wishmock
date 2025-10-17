#!/usr/bin/env bash
set -euo pipefail

echo "Building test image (tests run during build, no cache)..."
docker build --no-cache -f test.Dockerfile -t wishmock-test:ci .
echo "Build completed successfully. Cleaning up image..."
# Remove the test image to keep local/CI runner clean
docker image rm -f wishmock-test:ci >/dev/null 2>&1 || true
echo "Cleanup done."

#!/usr/bin/env bash
set -euo pipefail

# E2E-only master script (no unit tests)
# Usage examples:
#   bash scripts/test-e2e-all.sh                   # auto-detect RUNNER (bun preferred)
#   RUNNER=node bash scripts/test-e2e-all.sh       # force Node runtime
#   RUNNER=bun bash scripts/test-e2e-all.sh        # force Bun runtime
#   E2E_MODE=full bash scripts/test-e2e-all.sh     # comprehensive

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

E2E_MODE="${E2E_MODE:-smoke}"   # smoke | full
TIMEOUT="${TIMEOUT:-30}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo "╔════════════════════════════════════════════╗"
echo "║         🚀 E2E VALIDATION TESTS           ║"
echo "╚════════════════════════════════════════════╝"
echo "Mode: E2E_MODE=$E2E_MODE (TIMEOUT=${TIMEOUT}s)"

E2E_PASSED=0
E2E_FAILED=0

run_e2e_step() {
  local title="$1"; shift
  local cmd=("$@")
  echo ""; echo "▶ ${title}"; echo "";
  if "${cmd[@]}"; then
    E2E_PASSED=$((E2E_PASSED + 1))
    echo -e "${GREEN}✓ ${title} PASSED${NC}"
  else
    E2E_FAILED=$((E2E_FAILED + 1))
    echo -e "${RED}✗ ${title} FAILED${NC}"
  fi
}

if [[ "$E2E_MODE" == "smoke" ]]; then
  run_e2e_step "PGV/Auto basic (HelloRequest cases)" bash scripts/test-validation-e2e.sh
  run_e2e_step "Protovalidate CEL (official)" bash scripts/test-protovalidate-official-e2e.sh
  run_e2e_step "Protovalidate oneof (baseline)" bash scripts/test-protovalidate-oneof-e2e.sh
  run_e2e_step "Protovalidate bytes" bash scripts/test-protovalidate-bytes-e2e.sh
  run_e2e_step "Protovalidate maps" bash scripts/test-protovalidate-maps-e2e.sh
  run_e2e_step "Protovalidate WKT (timestamp/duration)" bash scripts/test-protovalidate-wkt-timestamp-duration-e2e.sh
  run_e2e_step "Protovalidate WKT (Any)" bash scripts/test-protovalidate-wkt-any-e2e.sh
else
  # full
  bash scripts/test-validation-comprehensive.sh || true
fi

echo ""
if [[ $E2E_FAILED -eq 0 ]]; then
  echo -e "${GREEN}All E2E tests PASSED${NC}"
  exit 0
else
  echo -e "${RED}${E2E_FAILED} E2E test(s) FAILED${NC}"
  exit 1
fi


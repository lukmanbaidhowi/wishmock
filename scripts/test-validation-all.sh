#!/usr/bin/env bash
set -euo pipefail

# Master Validation Test Suite
# Runs both unit tests and comprehensive e2e tests
# Usage: bash scripts/test-validation-all.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║               🧪 VALIDATION TEST SUITE (Unit + E2E)                    ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""

# Mode: smoke (representative + optimal) | full (comprehensive)
E2E_MODE="${E2E_MODE:-smoke}"
TIMEOUT="${TIMEOUT:-30}"
echo "Mode: E2E_MODE=$E2E_MODE (TIMEOUT=${TIMEOUT}s)"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

UNIT_PASSED=0
UNIT_FAILED=0
E2E_PASSED=0
E2E_FAILED=0

# ============================================================================
# UNIT TESTS
# ============================================================================

echo -e "${BLUE}📦 Running Unit Tests...${NC}"
echo ""

if bun test tests/validation.ruleExtractor.test.ts tests/validation.engine.test.ts 2>&1 | tee /tmp/unit-test.log; then
  UNIT_PASSED=1
  echo -e "${GREEN}✅ Unit tests PASSED${NC}"
else
  UNIT_FAILED=1
  echo -e "${RED}❌ Unit tests FAILED${NC}"
fi

echo ""

# ============================================================================
# E2E TESTS
# ============================================================================

echo -e "${BLUE}🚀 Running E2E Validation Tests...${NC}"
echo ""

run_e2e_step() {
  local title="$1"; shift
  local cmd=("$@")
  echo ""; echo "▶ ${title}"; echo "";
  if "${cmd[@]}" 2>&1 | tee -a /tmp/e2e-test.log; then
    E2E_PASSED=$((E2E_PASSED + 1))
    echo -e "${GREEN}✓ ${title} PASSED${NC}"
  else
    E2E_FAILED=$((E2E_FAILED + 1))
    echo -e "${RED}✗ ${title} FAILED${NC}"
  fi
}

if [[ "$E2E_MODE" == "smoke" ]]; then
  # Representative, optimal set covering: PGV, protovalidate CEL, oneof, bytes, maps, WKT (timestamp/duration, any)
  run_e2e_step "PGV/Auto basic (HelloRequest cases)" bash scripts/test-validation-e2e.sh
  run_e2e_step "Protovalidate CEL (official)" bash scripts/test-protovalidate-official-e2e.sh
  run_e2e_step "Protovalidate oneof (baseline)" bash scripts/test-protovalidate-oneof-e2e.sh
  run_e2e_step "Protovalidate bytes" bash scripts/test-protovalidate-bytes-e2e.sh
  run_e2e_step "Protovalidate maps" bash scripts/test-protovalidate-maps-e2e.sh
  run_e2e_step "Protovalidate WKT (timestamp/duration)" bash scripts/test-protovalidate-wkt-timestamp-duration-e2e.sh
  run_e2e_step "Protovalidate WKT (Any)" bash scripts/test-protovalidate-wkt-any-e2e.sh
else
  # Full: keep comprehensive suite + the protovalidate e2e set for full coverage
  run_e2e_step "Comprehensive PGV suite" bash scripts/test-validation-comprehensive.sh
  run_e2e_step "Protovalidate CEL (official)" bash scripts/test-protovalidate-official-e2e.sh
  run_e2e_step "Protovalidate oneof (baseline)" bash scripts/test-protovalidate-oneof-e2e.sh
  run_e2e_step "Protovalidate bytes" bash scripts/test-protovalidate-bytes-e2e.sh
  run_e2e_step "Protovalidate maps" bash scripts/test-protovalidate-maps-e2e.sh
  run_e2e_step "Protovalidate WKT (timestamp/duration)" bash scripts/test-protovalidate-wkt-timestamp-duration-e2e.sh
  run_e2e_step "Protovalidate WKT (Any)" bash scripts/test-protovalidate-wkt-any-e2e.sh
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                         📊 TEST SUMMARY                               ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""

TOTAL_SUITES=2
PASSED_SUITES=0
FAILED_SUITES=0

if [[ $UNIT_PASSED -eq 1 ]]; then
  PASSED_SUITES=$((PASSED_SUITES + 1))
  echo -e "${GREEN}✅ Unit Tests${NC} - PASSED"
else
  FAILED_SUITES=$((FAILED_SUITES + 1))
  echo -e "${RED}❌ Unit Tests${NC} - FAILED"
fi

if [[ $E2E_FAILED -eq 0 && $E2E_PASSED -gt 0 ]]; then
  PASSED_SUITES=$((PASSED_SUITES + 1))
  echo -e "${GREEN}✅ E2E Tests${NC} - PASSED"
else
  FAILED_SUITES=$((FAILED_SUITES + 1))
  echo -e "${RED}❌ E2E Tests${NC} - FAILED"
fi

echo ""
echo "Test Suites: $PASSED_SUITES/$TOTAL_SUITES passed"
echo "E2E Steps: $E2E_PASSED passed, $E2E_FAILED failed"
echo ""

if [[ $FAILED_SUITES -eq 0 ]]; then
  echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
  echo ""
  echo "✨ Test Coverage:"
  echo "  - Unit Tests: Validation rule extraction & engine logic"
  echo "  - E2E Tests:  gRPC validation (smoke=${E2E_MODE}) covering PGV + Protovalidate (CEL, oneof, bytes, maps, WKT)"
  echo ""
  echo "📊 Features Tested:"
  echo "  ✅ PGV Validation"
  echo "  ✅ Buf Validation"
  echo "  ✅ CEL Expressions"
  echo "  ✅ Enum Constraints"
  echo ""
  exit 0
else
  echo -e "${RED}❌ SOME TESTS FAILED${NC}"
  echo ""
  echo "View logs:"
  echo "  Unit test logs: cat /tmp/unit-test.log"
  echo "  E2E test logs:  cat /tmp/e2e-test.log"
  echo ""
  exit 1
fi

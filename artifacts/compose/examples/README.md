# Compose Validation Artifact Examples

This directory contains example outputs from compose validation scripts for reference and troubleshooting.

## Artifact Structure

```
artifacts/compose/<timestamp>/
├── lint.json                  # Lint validation results
├── lint-error.log            # Lint error details (on failure)
├── dry-run.log               # Dry-run output
├── dry-run.json              # Dry-run summary
├── smoke.json                # Smoke test results
├── run-metrics.json          # Timing and performance metrics
└── smoke/
    ├── ps.json               # Container states
    └── logs.txt              # Container logs
```

## Example: Successful Lint

**File**: `lint-success.json`

```json
{
  "file": "docker-compose.yml",
  "status": "ok",
  "duration_ms": 250,
  "exit_code": 0
}
```

## Example: Failed Lint

**File**: `lint-error.json`

```json
{
  "file": "docker-compose.yml",
  "status": "error",
  "duration_ms": 180,
  "exit_code": 2
}
```

**Error Log**: `lint-error.log`

```
services.wishmock.image contains an interpolation: this is not supported
```

## Example: Dry-Run Success

**File**: `dry-run-success.json`

```json
{
  "file": "docker-compose.yml",
  "status": "ok",
  "duration_ms": 1200,
  "exit_code": 0
}
```

**Output**: `dry-run.log`

```
Container wishmock  Recreate
```

## Example: Smoke Test Success

**File**: `smoke-success.json`

```json
{
  "file": "docker-compose.yml",
  "status": "ok",
  "duration_ms": 12500,
  "exit_code": 0
}
```

**Run Metrics**: `run-metrics.json`

```json
{
  "start_time": "2025-11-10T12:00:00Z",
  "end_time": "2025-11-10T12:00:12Z",
  "total_duration_ms": 12500,
  "startup_duration_ms": 8000,
  "healthcheck_duration_ms": 150,
  "compose_file": "docker-compose.yml",
  "timeout_seconds": 120
}
```

**Container States**: `smoke/ps.json`

```json
[
  {
    "ID": "abc123",
    "Name": "wishmock",
    "Image": "wishmock:latest",
    "Status": "Up 5 seconds",
    "State": "running",
    "Health": "healthy"
  }
]
```

**Container Logs**: `smoke/logs.txt` (excerpt)

```
2025-11-10T12:00:05.123Z wishmock | gRPC (plaintext) listening on 50050
2025-11-10T12:00:05.125Z wishmock | gRPC (TLS) listening on 50051
2025-11-10T12:00:05.127Z wishmock | Admin HTTP listening on 3000
2025-11-10T12:00:05.130Z wishmock | Server ready
```

## Example: Smoke Test Failure

**File**: `smoke-failure.json`

```json
{
  "file": "docker-compose.yml",
  "status": "error",
  "duration_ms": 5200,
  "exit_code": 3,
  "phase": "healthcheck"
}
```

## Interpreting Artifacts

### Status Field
- `"ok"`: Validation passed
- `"error"`: Validation failed

### Exit Codes
- `0`: Success
- `1`: Version mismatch or invalid arguments
- `2`: Lint or dry-run failure
- `3`: Smoke test failed (startup or healthcheck)

### Duration
All durations are in milliseconds. Typical ranges:
- Lint: 200-500ms
- Dry-run: 1-3s
- Smoke test: 10-20s (includes startup, health checks, cleanup)

### Timing Breakdown (run-metrics.json)
- `total_duration_ms`: End-to-end execution time
- `startup_duration_ms`: Time to start services (`docker compose up --wait`)
- `healthcheck_duration_ms`: Time to verify health endpoints

## Using Examples

These examples help with:
1. **Understanding output format**: Compare your artifacts against examples
2. **Troubleshooting failures**: Match error patterns with known issues
3. **Setting expectations**: Know typical timing and structure
4. **Documentation**: Reference format for CI integration

## Generating Fresh Examples

Run the validation suite locally to generate new examples:

```bash
# Lint
scripts/compose/lint.sh --file docker-compose.yml

# Dry-run
scripts/compose/dry-run.sh --file docker-compose.yml

# Smoke test (requires Docker daemon)
scripts/compose/smoke.sh --file docker-compose.yml

# Check artifacts
ls -lh artifacts/compose/
```

## CI Integration

In CI workflows, always upload the `artifacts/compose/` directory for post-mortem analysis:

```yaml
- name: Upload validation artifacts
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: compose-validation-artifacts
    path: artifacts/compose/
    retention-days: 7
```

## Related Documentation

- Docker validation workflow: see `README.md#docker-compose-validation`
- grpcurl smoke test: `scripts/docker/grpcurl-smoke.sh`

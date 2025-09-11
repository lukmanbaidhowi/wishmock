#!/bin/bash

# Test script for gRPC with TLS
# Usage: ./test-tls.sh [command]
# Commands: list, describe, hello, calendar

set -e

CERT_DIR="./certs"
CA_CERT="$CERT_DIR/ca.crt"
CLIENT_CERT="$CERT_DIR/client.crt"
CLIENT_KEY="$CERT_DIR/client.key"
TLS_PORT="50051"

# Check if certs exist
if [[ ! -f "$CA_CERT" ]]; then
    echo "Error: CA certificate not found at $CA_CERT"
    echo "Run: bash scripts/generate-local-certs.sh"
    exit 1
fi

case "${1:-list}" in
    "list")
        echo "=== Listing services (TLS) ==="
        grpcurl -cacert "$CA_CERT" localhost:$TLS_PORT list
        ;;
    
    "describe")
        SERVICE="${2:-helloworld.Greeter}"
        echo "=== Describing $SERVICE (TLS) ==="
        grpcurl -cacert "$CA_CERT" localhost:$TLS_PORT describe "$SERVICE"
        ;;
    
    "hello")
        NAME="${2:-Tom}"
        echo "=== Testing helloworld.Greeter/SayHello (TLS) ==="
        grpcurl -cacert "$CA_CERT" \
            -d "{\"name\":\"$NAME\"}" \
            localhost:$TLS_PORT helloworld.Greeter/SayHello
        ;;
    
    "hello-mtls")
        NAME="${2:-Tom}"
        echo "=== Testing helloworld.Greeter/SayHello (mTLS) ==="
        grpcurl -cacert "$CA_CERT" \
            -cert "$CLIENT_CERT" -key "$CLIENT_KEY" \
            -d "{\"name\":\"$NAME\"}" \
            localhost:$TLS_PORT helloworld.Greeter/SayHello
        ;;
    
    "calendar")
        ID="${2:-next}"
        echo "=== Testing calendar.Events/GetEvent (TLS) ==="
        grpcurl -cacert "$CA_CERT" \
            -d "{\"id\":\"$ID\"}" \
            localhost:$TLS_PORT calendar.Events/GetEvent
        ;;
    
    "calendar-mtls")
        ID="${2:-next}"
        echo "=== Testing calendar.Events/GetEvent (mTLS) ==="
        grpcurl -cacert "$CA_CERT" \
            -cert "$CLIENT_CERT" -key "$CLIENT_KEY" \
            -d "{\"id\":\"$ID\"}" \
            localhost:$TLS_PORT calendar.Events/GetEvent
        ;;
    
    "error")
        ERROR_ID="${2:-err-unauth}"
        echo "=== Testing error simulation: $ERROR_ID (TLS) ==="
        grpcurl -cacert "$CA_CERT" \
            -d "{\"id\":\"$ERROR_ID\"}" \
            localhost:$TLS_PORT calendar.Events/GetEvent
        ;;
    
    "header")
        NAME="${2:-Tom}"
        echo "=== Testing with Authorization header (TLS) ==="
        grpcurl -cacert "$CA_CERT" \
            -H 'authorization: Bearer token123' \
            -d "{\"name\":\"$NAME\"}" \
            localhost:$TLS_PORT helloworld.Greeter/SayHello
        ;;
    
    *)
        echo "Usage: $0 [command] [args...]"
        echo ""
        echo "Commands:"
        echo "  list                    - List all services"
        echo "  describe [service]      - Describe service (default: helloworld.Greeter)"
        echo "  hello [name]           - Test SayHello (default: Tom)"
        echo "  hello-mtls [name]      - Test SayHello with mTLS"
        echo "  calendar [id]          - Test GetEvent (default: next)"
        echo "  calendar-mtls [id]     - Test GetEvent with mTLS"
        echo "  error [error_id]       - Test error simulation (default: err-unauth)"
        echo "  header [name]          - Test with Authorization header"
        echo ""
        echo "Examples:"
        echo "  $0 list"
        echo "  $0 describe helloworld.Greeter"
        echo "  $0 hello Alice"
        echo "  $0 calendar err-forbidden"
        echo "  $0 hello-mtls Bob"
        ;;
esac
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT_DIR="$ROOT_DIR/certs"
mkdir -p "$OUT_DIR"

echo "[certs] Generating CA-signed certificate for system trust"

# Generate CA
openssl genrsa -out "$OUT_DIR/ca.key" 2048
openssl req -x509 -new -nodes -key "$OUT_DIR/ca.key" -sha256 -days 3650 \
  -subj "/CN=Local gRPC Mock CA/O=Development" -out "$OUT_DIR/ca.crt"

# Generate server certificate signed by CA
openssl genrsa -out "$OUT_DIR/server.key" 2048
openssl req -new -key "$OUT_DIR/server.key" -subj "/CN=localhost" -out "$OUT_DIR/server.csr"

# Create extensions file
cat > "$OUT_DIR/server.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = 127.0.0.1
IP.1 = 127.0.0.1
IP.2 = 0.0.0.0
EOF

# Sign server certificate with CA
openssl x509 -req -in "$OUT_DIR/server.csr" -CA "$OUT_DIR/ca.crt" -CAkey "$OUT_DIR/ca.key" \
  -CAcreateserial -out "$OUT_DIR/server.crt" -days 825 -sha256 -extfile "$OUT_DIR/server.ext"

# Cleanup
rm "$OUT_DIR/server.csr" "$OUT_DIR/server.ext"

echo "[certs] Generated CA-signed certificate:"
echo "  - $OUT_DIR/ca.crt (Root CA)"
echo "  - $OUT_DIR/server.crt (Server certificate)"
echo "  - $OUT_DIR/server.key (Server key)"
echo
echo "To trust the CA system-wide (Linux):"
echo "  sudo cp $OUT_DIR/ca.crt /usr/local/share/ca-certificates/grpc-mock-ca.crt"
echo "  sudo update-ca-certificates"
echo
echo "To trust the CA system-wide (macOS):"
echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $OUT_DIR/ca.crt"
echo
echo "After installing CA, BloomRPC can connect without 'Skip Certificate Verification':"
echo "  - Address: localhost:50051"
echo "  - Enable 'Server Certificate'"
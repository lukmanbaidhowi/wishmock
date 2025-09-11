#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT_DIR="$ROOT_DIR/certs"
mkdir -p "$OUT_DIR"

echo "[certs] Generating certificates with TLS Web Server/Client Authentication"

# Generate CA
openssl genrsa -out "$OUT_DIR/ca.key" 2048
openssl req -x509 -new -nodes -key "$OUT_DIR/ca.key" -sha256 -days 3650 \
  -subj "/CN=gRPC Mock CA/O=Development" -out "$OUT_DIR/ca.crt"

# Generate server certificate with Web Server Authentication
openssl genrsa -out "$OUT_DIR/server.key" 2048
openssl req -new -key "$OUT_DIR/server.key" -subj "/CN=localhost" -out "$OUT_DIR/server.csr"

cat > "$OUT_DIR/server.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = 127.0.0.1
IP.1 = 127.0.0.1
IP.2 = 0.0.0.0
EOF

openssl x509 -req -in "$OUT_DIR/server.csr" -CA "$OUT_DIR/ca.crt" -CAkey "$OUT_DIR/ca.key" \
  -CAcreateserial -out "$OUT_DIR/server.crt" -days 825 -sha256 -extfile "$OUT_DIR/server.ext"

# Generate client certificate with Web Client Authentication
openssl genrsa -out "$OUT_DIR/client.key" 2048
openssl req -new -key "$OUT_DIR/client.key" -subj "/CN=grpc-client" -out "$OUT_DIR/client.csr"

cat > "$OUT_DIR/client.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
EOF

openssl x509 -req -in "$OUT_DIR/client.csr" -CA "$OUT_DIR/ca.crt" -CAkey "$OUT_DIR/ca.key" \
  -CAcreateserial -out "$OUT_DIR/client.crt" -days 825 -sha256 -extfile "$OUT_DIR/client.ext"

# Cleanup
rm "$OUT_DIR/server.csr" "$OUT_DIR/client.csr" "$OUT_DIR/server.ext" "$OUT_DIR/client.ext"

echo "[certs] Generated certificates with Web Authentication:"
echo "  - $OUT_DIR/ca.crt (Root CA)"
echo "  - $OUT_DIR/server.crt (Server - TLS Web Server Authentication)"
echo "  - $OUT_DIR/server.key (Server key)"
echo "  - $OUT_DIR/client.crt (Client - TLS Web Client Authentication)"
echo "  - $OUT_DIR/client.key (Client key)"
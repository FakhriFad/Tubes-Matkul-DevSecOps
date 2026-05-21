#!/usr/bin/env bash
# Generates a self-signed TLS certificate for local development.
# For production, replace with a certificate from Let's Encrypt or your CA.

set -euo pipefail

CERT_DIR="$(dirname "$0")/ssl"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
  echo "Certificates already exist in $CERT_DIR – skipping generation."
  echo "Delete them and re-run this script to regenerate."
  exit 0
fi

echo "Generating self-signed TLS certificate..."

openssl req -x509 -nodes \
  -newkey rsa:4096 \
  -keyout "$CERT_DIR/server.key" \
  -out    "$CERT_DIR/server.crt" \
  -days   365 \
  -subj   "/C=ID/ST=West Java/L=Bandung/O=EcomShop/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"

echo ""
echo "Certificate generated:"
echo "  Key:  $CERT_DIR/server.key"
echo "  Cert: $CERT_DIR/server.crt"
echo ""
echo "NOTE: Browsers will show a security warning for self-signed certs."
echo "Add server.crt to your system trust store to suppress it."
echo "For production, use Let's Encrypt: https://letsencrypt.org/"

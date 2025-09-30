#!/bin/bash

set -e  # Exit on any error

# Generate SSL certificates for HTTPS
if ! mkdir -p certs; then
    echo "Error: Failed to create certs directory" >&2
    exit 1
fi

# Generate private key
if ! openssl genrsa -out certs/key.pem 2048; then
    echo "Error: Failed to generate private key" >&2
    exit 1
fi

# Generate certificate signing request
if ! openssl req -new -key certs/key.pem -out certs/csr.pem -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"; then
    echo "Error: Failed to generate certificate signing request" >&2
    exit 1
fi

# Generate self-signed certificate
if ! openssl x509 -req -days 365 -in certs/csr.pem -signkey certs/key.pem -out certs/cert.pem; then
    echo "Error: Failed to generate certificate" >&2
    exit 1
fi

# Clean up CSR
rm -f certs/csr.pem

# Set secure permissions
chmod 600 certs/key.pem
chmod 644 certs/cert.pem

echo "SSL certificates generated in ./certs/"
echo "cert.pem - Certificate file"
echo "key.pem  - Private key file"
echo "WARNING: These are self-signed certificates for development only!"
echo "Do not use in production. Generate proper certificates from a CA."
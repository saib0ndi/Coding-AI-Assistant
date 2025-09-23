#!/bin/bash

# Generate SSL certificates for HTTPS
mkdir -p certs

# Generate private key
openssl genrsa -out certs/key.pem 2048

# Generate certificate signing request
openssl req -new -key certs/key.pem -out certs/csr.pem -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Generate self-signed certificate
openssl x509 -req -days 365 -in certs/csr.pem -signkey certs/key.pem -out certs/cert.pem

# Clean up CSR
rm certs/csr.pem

echo "SSL certificates generated in ./certs/"
echo "cert.pem - Certificate file"
echo "key.pem  - Private key file"
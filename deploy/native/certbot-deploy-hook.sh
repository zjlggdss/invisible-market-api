#!/usr/bin/env bash
set -euo pipefail

# Certbot invokes all deploy hooks. Only this application's configured
# certificate may replace the files used by its HTTPS gateway.
source /opt/invisible-market/deploy/native/certificate-config.sh
if [ "${RENEWED_LINEAGE:-}" != "/etc/letsencrypt/live/$CERT_NAME" ]; then
  exit 0
fi

cert_dir=/opt/invisible-market/certs
install -m 0644 "$RENEWED_LINEAGE/fullchain.pem" "$cert_dir/fullchain.pem"
install -m 0600 "$RENEWED_LINEAGE/privkey.pem" "$cert_dir/privkey.pem"
bash /opt/invisible-market/deploy/native/install-certificate.sh

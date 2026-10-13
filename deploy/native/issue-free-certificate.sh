#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/certificate-config.sh"
test -f "$certificate_config"
/opt/certbot/bin/certbot certonly \
  --standalone \
  --preferred-profile shortlived \
  --ip-address "$PUBLIC_IP" \
  --cert-name "$CERT_NAME" \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email

# Certbot also invokes this as a deploy hook; repeat it here so a manual run
# verifies that the HTTPS gateway actually loads the issued certificate.
RENEWED_LINEAGE="/etc/letsencrypt/live/$CERT_NAME" \
  bash /etc/letsencrypt/renewal-hooks/deploy/invisible-market.sh

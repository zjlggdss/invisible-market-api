#!/usr/bin/env bash
# Sourced by the certificate scripts. Configuration is root-owned and lives in
# certs/, which is excluded from Git. Environment values take precedence.
set -euo pipefail

certificate_config=/opt/invisible-market/certs/certificate.conf
requested_public_ip=${PUBLIC_IP:-}
requested_cert_name=${CERT_NAME:-}
if [ -f "$certificate_config" ]; then
  # shellcheck source=/dev/null
  source "$certificate_config"
fi
PUBLIC_IP=${requested_public_ip:-${PUBLIC_IP:-}}
CERT_NAME=${requested_cert_name:-${CERT_NAME:-invisible-market}}
: "${PUBLIC_IP:?Set PUBLIC_IP to this server's public IPv4 address, or run setup-certbot.sh first}"
if [[ ! "$CERT_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo 'CERT_NAME must contain only letters, digits, dots, underscores or hyphens.' >&2
  exit 1
fi
python3 - "$PUBLIC_IP" <<'PY'
import ipaddress
import sys
ipaddress.IPv4Address(sys.argv[1])
PY
export PUBLIC_IP CERT_NAME

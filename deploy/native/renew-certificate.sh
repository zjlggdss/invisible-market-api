#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/certificate-config.sh"
/opt/certbot/bin/certbot renew --cert-name "$CERT_NAME" --quiet "$@"

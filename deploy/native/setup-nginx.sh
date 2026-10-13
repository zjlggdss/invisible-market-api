#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/invisible-market
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -m 0644 "$script_dir/nginx-site.conf" /etc/nginx/sites-available/invisible-market
if [ -e /etc/nginx/sites-enabled/default ] || [ -L /etc/nginx/sites-enabled/default ]; then
  unlink /etc/nginx/sites-enabled/default
fi
ln -sfn /etc/nginx/sites-available/invisible-market /etc/nginx/sites-enabled/invisible-market

if [ -f "$app_dir/certs/fullchain.pem" ] && [ -f "$app_dir/certs/privkey.pem" ]; then
  nginx -t
else
  # On a dedicated new server, free port 80 for Certbot's HTTP-01 challenge.
  # install-certificate.sh enables Nginx after a trusted certificate exists.
  systemctl stop nginx.service
  systemctl disable nginx.service
fi

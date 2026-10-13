#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/certificate-config.sh"
install -d -o root -g root -m 0700 /opt/invisible-market/certs
umask 0077
printf 'PUBLIC_IP=%s\nCERT_NAME=%s\n' "$PUBLIC_IP" "$CERT_NAME" > "$certificate_config"
chown root:root "$certificate_config"
chmod 0600 "$certificate_config"

export DEBIAN_FRONTEND=noninteractive
apt-get install -y python3-venv
if [ ! -x /opt/certbot/bin/certbot ]; then
  python3 -m venv /opt/certbot
fi
/opt/certbot/bin/python -m pip install --upgrade pip 'certbot>=5.4,<6'
/opt/certbot/bin/certbot --version

install -d -m 0700 /etc/letsencrypt/renewal-hooks/deploy
install -m 0700 "$script_dir/certbot-deploy-hook.sh" \
  /etc/letsencrypt/renewal-hooks/deploy/invisible-market.sh
install -m 0644 "$script_dir/certbot-renew.service" \
  /etc/systemd/system/invisible-market-certbot-renew.service
install -m 0644 "$script_dir/certbot-renew.timer" \
  /etc/systemd/system/invisible-market-certbot-renew.timer
systemctl daemon-reload
systemctl enable --now invisible-market-certbot-renew.timer

#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/invisible-market
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test -f "$app_dir/.env"
test -f "$app_dir/src/server.js"
test -d "$app_dir/node_modules/sharp"

chown root:invisible-market "$app_dir/.env"
chmod 0640 "$app_dir/.env"
install -d -o invisible-market -g invisible-market -m 0700 "$app_dir/data" "$app_dir/data/images"
chown -R invisible-market:invisible-market "$app_dir/data"
if [ -f "$app_dir/data/market.sqlite" ]; then
  chmod 0600 "$app_dir/data/market.sqlite"
fi
# src/server.js creates and migrates the SQLite database on first startup.
install -m 0644 "$script_dir/invisible-market.service" /etc/systemd/system/invisible-market.service
systemd-analyze verify /etc/systemd/system/invisible-market.service
systemctl daemon-reload
systemctl enable invisible-market.service
systemctl restart invisible-market.service
systemctl is-active invisible-market.service

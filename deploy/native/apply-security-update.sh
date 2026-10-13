#!/usr/bin/env bash
set -euo pipefail

# Run from the staged release, after npm ci --omit=dev on the same server.
# Existing .env, data/ and certs/ stay in the application directory.
main() {
  local app=/opt/invisible-market
  local stage
  stage=$(realpath -- "${1:?Usage: apply-security-update.sh /absolute/staged-release}")
  case "$stage" in
    "$app"|"$app"/*|/) echo 'Use a separate staged release directory.' >&2; exit 1 ;;
  esac
  test -f "$stage/package-lock.json"
  test -d "$stage/node_modules/sharp"
  test -d "$stage/src"
  test -d "$stage/scripts"
  test -f "$stage/deploy/native/invisible-market.service"
  test -f "$stage/deploy/native/nginx-site.conf"
  test -f "$app/.env"
  test -f "$app/data/market.sqlite"
  test -f /etc/systemd/system/invisible-market.service
  test -f /etc/nginx/sites-available/invisible-market

  install -d -m 0700 /root/invisible-market-backups
  local backup=/root/invisible-market-backups/$(date -u +%Y%m%dT%H%M%SZ)
  local updated=0 stopped=0
  rollback() {
    if [ "$updated" -eq 1 ]; then
      systemctl stop invisible-market.service || true
      rsync -a --delete "$backup/app/" "$app/"
      install -m 0644 "$backup/invisible-market.service" /etc/systemd/system/invisible-market.service
      install -m 0644 "$backup/nginx-site.conf" /etc/nginx/sites-available/invisible-market
      systemctl daemon-reload
      systemctl start invisible-market.service || true
      nginx -t && systemctl reload nginx || true
      echo "Update failed; restored backup from $backup" >&2
    elif [ "$stopped" -eq 1 ]; then
      systemctl start invisible-market.service || true
    fi
  }
  trap rollback ERR

  systemctl stop invisible-market.service
  stopped=1
  install -d -m 0700 "$backup"
  cp -a "$app" "$backup/app"
  cp -a /etc/systemd/system/invisible-market.service "$backup/invisible-market.service"
  cp -a /etc/nginx/sites-available/invisible-market "$backup/nginx-site.conf"
  updated=1

  for directory in src scripts node_modules; do
    install -d -m 0755 "$app/$directory"
    rsync -a --delete "$stage/$directory/" "$app/$directory/"
    chown -R root:root "$app/$directory"
  done
  install -d -m 0755 "$app/deploy/native"
  rsync -a --delete "$stage/deploy/native/" "$app/deploy/native/"
  chown -R root:root "$app/deploy/native"
  install -o root -g root -m 0644 "$stage/package.json" "$stage/package-lock.json" "$app/"
  install -m 0644 "$app/deploy/native/invisible-market.service" /etc/systemd/system/invisible-market.service
  install -m 0644 "$app/deploy/native/nginx-site.conf" /etc/nginx/sites-available/invisible-market

  systemd-analyze verify /etc/systemd/system/invisible-market.service
  nginx -t
  systemctl daemon-reload
  systemctl start invisible-market.service
  systemctl is-active --quiet invisible-market.service
  systemctl reload nginx
  systemctl is-active --quiet nginx
  local ready=0 status
  for attempt in {1..20}; do
    status=$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:4101/products/drafts || true)
    if [ "$status" = 401 ]; then
      ready=1
      break
    fi
    sleep 0.5
  done
  test "$ready" -eq 1
  test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:4104/reports/latest)" = 401
  trap - ERR
  echo "Update active; backup: $backup"
}

main "$@"

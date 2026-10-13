#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/certificate-config.sh"
cert_dir=/opt/invisible-market/certs
cert="$cert_dir/fullchain.pem"
key="$cert_dir/privkey.pem"
test -s "$cert"
test -s "$key"

openssl x509 -in "$cert" -noout -checkend 86400
ip_pattern=${PUBLIC_IP//./\\.}
openssl x509 -in "$cert" -noout -ext subjectAltName | grep -Eq "IP Address:$ip_pattern([,[:space:]]|$)"
cert_pub=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_pub=$(openssl pkey -in "$key" -pubout -outform DER | sha256sum | cut -d' ' -f1)
test "$cert_pub" = "$key_pub"

chown root:root "$cert" "$key"
chmod 0644 "$cert"
chmod 0600 "$key"
nginx -t
systemctl unmask nginx.service
systemctl enable nginx.service
if systemctl is-active --quiet nginx.service; then
  systemctl reload nginx.service
else
  systemctl start nginx.service
fi

for port in 3101 3102 3103 3104; do
  status=$(curl --silent --show-error --resolve "$PUBLIC_IP:$port:127.0.0.1" \
    --output /dev/null --write-out '%{http_code}' "https://$PUBLIC_IP:$port/")
  test "$status" = 401
  printf 'port=%s tls=ok unauthorized_status=%s\n' "$port" "$status"
done

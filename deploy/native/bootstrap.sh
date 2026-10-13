#!/usr/bin/env bash
set -euo pipefail

if [ "$(dpkg --print-architecture)" != amd64 ]; then
  echo 'This deployment template supports Ubuntu 24.04 x86_64 (amd64).' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx openssl python3-venv rsync

install -m 0755 -d /usr/share/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/invisible-market-nodesource.asc
gpg --batch --yes --dearmor -o /usr/share/keyrings/nodesource.gpg /tmp/invisible-market-nodesource.asc
rm /tmp/invisible-market-nodesource.asc
cat > /etc/apt/sources.list.d/nodesource.sources <<'EOF'
Types: deb
URIs: https://deb.nodesource.com/node_24.x
Suites: nodistro
Components: main
Architectures: amd64
Signed-By: /usr/share/keyrings/nodesource.gpg
EOF

apt-get update
apt-get install -y nodejs
node --version

if ! id invisible-market >/dev/null 2>&1; then
  useradd --system --home /opt/invisible-market --shell /usr/sbin/nologin invisible-market
fi
install -d -m 0755 /opt/invisible-market
install -d -o invisible-market -g invisible-market -m 0750 /opt/invisible-market/data
install -d -o invisible-market -g invisible-market -m 0750 /opt/invisible-market/data/images
install -d -m 0700 /opt/invisible-market/certs

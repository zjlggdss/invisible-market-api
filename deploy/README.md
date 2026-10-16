# Ubuntu / Alibaba Cloud ECS Deployment

This guide targets a dedicated Ubuntu 24.04 LTS x86_64 server running Node.js 24, systemd, Nginx, and SQLite. The deployment scripts install the application at `/opt/invisible-market` with root privileges. Docker is optional. Follow the steps in order on a new server; they modify the application service and the default Nginx site.

## Current Alibaba Cloud Instance

The deployed API endpoints are:

| Function | HTTPS URL |
| --- | --- |
| Product uploads | [https://47.98.16.128:3101](https://47.98.16.128:3101) |
| Best-match recommendations | [https://47.98.16.128:3102](https://47.98.16.128:3102) |
| Worst-match recommendations | [https://47.98.16.128:3103](https://47.98.16.128:3103) |

These endpoints serve a JSON API and require an individual client token. Requests without a valid token return `401`. See the [project README](../README.md) for request formats and client key management. The weekly report port, `3104`, is restricted to the owner's source allowlist and requires the owner token; public visitors cannot use it to read reports. Only the service addresses are published here. Access keys remain private.

## 1. Prepare the Server and Network

Configure the Alibaba Cloud security group and the server firewall as follows:

- TCP `3101`–`3103`: allow access from API clients.
- TCP `3104`: allow only trusted owner sources, or leave it closed and use the SSH tunnel below.
- TCP `80`: keep public inbound access enabled for HTTP-01 issuance and renewal of the IP certificate. No other service should occupy this port.
- TCP `22`: allow only trusted administrator sources and use SSH key authentication.
- Keep internal ports `4101`–`4104` closed to external traffic. The application listens only on `127.0.0.1`.

The server needs a static public address that is reachable from the internet. The certificate steps support IPv4. See the [Alibaba Cloud security group documentation](https://www.alibabacloud.com/help/en/ecs/user-guide/start-using-security-groups) for rule configuration.

## 2. Install the Application

Clone the public repository into a temporary source directory on the server. If you use your own fork, replace the repository URL below:

~~~sh
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/zjlggdss/invisible-market-api.git invisible-market-source
cd invisible-market-source
sudo bash deploy/native/bootstrap.sh
sudo rsync -a --exclude=.git --exclude=.env --exclude=data/ --exclude=certs/ --exclude=node_modules/ ./ /opt/invisible-market/
cd /opt/invisible-market
sudo npm ci --omit=dev
sudo chown -R root:root src scripts deploy node_modules package.json package-lock.json
~~~

`bootstrap.sh` uses the [NodeSource repository for Node.js 24](https://github.com/nodesource/distributions/blob/master/DEV_README.md), creates a dedicated application account, and installs Nginx, OpenSSL, Python, and rsync. The application account writes the database and images; root owns the source code.

## 3. Configure Keys and Start the Internal API

For the first deployment, create a private configuration file from the public template:

~~~sh
sudo install -o root -g invisible-market -m 0640 .env.example /opt/invisible-market/.env
sudoedit /opt/invisible-market/.env
~~~

Set distinct `AGENT_API_KEY` and `OWNER_API_KEY` values, each at least 24 characters long. Set your own `DASHSCOPE_API_KEY` and workspace-specific Alibaba Cloud HTTPS endpoint, `DASHSCOPE_BASE_URL`, and configure the models as described in the project README. Keep this configuration file on the server and never commit it to GitHub.

~~~sh
sudo bash deploy/native/setup-service.sh
sudo systemctl status invisible-market --no-pager
~~~

The first startup creates the SQLite database and tables automatically; an existing database is not required. The service uses `/opt/invisible-market/data` and internal ports `4101`–`4104`. The setup script restricts permissions on the environment file and data directories.

## 4. Configure HTTPS and Automatic Renewal

This setup uses [Let's Encrypt short-lived IP certificates](https://letsencrypt.org/2026/03/11/shorter-certs-certbot) and requires Certbot 5.4 or later. These certificates need automatic renewal. `setup-certbot.sh` installs an isolated Python environment and a systemd timer that checks for renewal twice a day.

Replace the example IP with **your server's public IPv4 address**. The certificate name defaults to `invisible-market`; use distinct names if the server hosts multiple applications.

~~~sh
cd /opt/invisible-market
sudo bash deploy/native/setup-nginx.sh
sudo PUBLIC_IP=203.0.113.10 CERT_NAME=invisible-market bash deploy/native/setup-certbot.sh
sudo bash deploy/native/issue-free-certificate.sh
sudo bash deploy/native/renew-certificate.sh --dry-run --no-random-sleep-on-renew
~~~

Initial issuance accepts the Let's Encrypt terms of service and registers an account without an email address. To provide an email contact, register your own account with Certbot first. Automatic renewal requires TCP `80` to remain reachable. Nginx listens only on the application's HTTPS ports.

The setup script saves `PUBLIC_IP` and `CERT_NAME` in the root-only file `certs/certificate.conf`. The `certs/` directory is ignored by Git. You can also configure this file on the server using `deploy/native/certificate.conf.example` as a reference. Manual commands accept environment variables with the same names as overrides; scheduled renewal uses the saved configuration.

The original certificates live in `/etc/letsencrypt/live/<CERT_NAME>/`; application copies live in `/opt/invisible-market/certs/`. The renewal command handles only this application's certificate. The deploy hook checks the certificate name so that only the configured certificate can replace the application's files. Installation checks the certificate's remaining validity, IP address, and matching private key, then starts or reloads Nginx and verifies that unauthenticated requests to all four HTTPS ports return `401`.

If a certificate already exists, save the matching `CERT_NAME` as described above before issuing or renewing it. Leave other sites' certificate names and global renewal jobs unchanged. If the public IP changes, update the configuration and issue a certificate for the new address.

## 5. Verify the Deployment

Run these commands from the repository root on the server:

~~~sh
cd /opt/invisible-market
sudo DATA_DIR=/opt/invisible-market/data node --env-file=.env deploy/native/verify.mjs
sudo node --env-file=.env deploy/native/verify-security.mjs
~~~

The verification scripts check data integrity, authentication on the internal ports, and key validity without printing keys. An authenticated report request can return `404` when no weekly report has been generated yet.

After uploading at least one product with images using the workflow in the project README, you can optionally check model connectivity. This check makes real Alibaba Cloud model calls and incurs the corresponding charges:

~~~sh
sudo DATA_DIR=/opt/invisible-market/data node --env-file=.env deploy/native/smoke-ai.mjs
~~~

From outside the server, visit `https://<PUBLIC_IP>:3101`–`:3103` and verify trusted TLS and a `401` response without a token. Keep certificate verification enabled.

## 6. SSH Tunnel for Owner Reports

On Windows, use `scripts/report-tunnel.ps1` and explicitly supply the server, user, private key, and verified host records. First obtain the server's SSH host public key fingerprint through the Alibaba Cloud console or another trusted management channel, then compare it with the local record. Collecting a public key alone does not verify the server's identity.

View the fingerprint in the server console:

~~~sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
~~~

Collect the host key and inspect its fingerprint from the project directory on Windows. Replace `SERVER_HOST` with your server:

~~~powershell
ssh-keyscan -t ed25519 SERVER_HOST | Out-File -Encoding ascii deploy/known_hosts
ssh-keygen -lf deploy/known_hosts
~~~

After confirming that the fingerprint matches the one from the trusted console, start the tunnel:

~~~powershell
./scripts/report-tunnel.ps1 -Host SERVER_HOST -User ubuntu -KeyPath C:\private\server.pem -KnownHostsPath ./deploy/known_hosts
~~~

By default, the script forwards `http://127.0.0.1:43104` to `127.0.0.1:4104` on the server. Keep the window open and include `OWNER_API_KEY` when requesting `/reports/latest` locally. Use `-SshPort`, `-LocalPort`, and `-RemotePort` to change the ports. Strict host key verification is always enabled. Exclude private keys and host records from public packages.

## 7. Docker Compose Alternative

`compose.yaml` provides a container deployment option. The server must be able to download the Node.js and Nginx images. Docker and the native setup above use the same application ports, so their default configurations cannot run simultaneously on the same host.

Create a private `.env` file in the repository root with the same access keys and Alibaba Cloud settings as the native setup. Obtain a trusted certificate for your public IP or domain, save the certificate chain as `certs/fullchain.pem`, and save the private key as `certs/privkey.pem`. Compose mounts the entire `certs/` directory read-only into Nginx. Restrict private key access to administrators and reload or restart the gateway after updating certificates.

On Linux, the application account inside the container has UID/GID `1000:1000` and needs write access to the host data directory. These commands apply when creating empty data directories for the first time:

~~~sh
cp .env.example .env
chmod 0600 .env
install -d -m 0700 certs
# Edit .env and provide certs/fullchain.pem and certs/privkey.pem before starting.
sudo install -d -o 1000 -g 1000 -m 0700 data data/images
docker compose up -d --build
~~~

To restore existing data, stop the service first and ensure that UID/GID `1000:1000` can read and write the entire `data/` directory, including the database and images. The first container startup also creates the database automatically; no sample products or production data package is required.

This example binds all four ports, `3101`–`3104`, to all host network interfaces. Restrict sources through the cloud security group and server firewall, especially by allowing only trusted owner sources on `3104`. Alternatively, change the report port mapping in Compose to `127.0.0.1:3104:3104` and forward SSH traffic to port `3104` on the server. Pass `-RemotePort 3104` to the Windows tunnel script for this configuration. You can also bind the other ports to specific host addresses as needed. Docker deployment does not install the native Certbot timer from this guide; arrange certificate renewal separately and synchronize updated certificates into `certs/`.

## 8. Updates and Maintenance

- Application status: `systemctl status invisible-market nginx`.
- Application logs: `journalctl -u invisible-market -n 100 --no-pager`.
- Renewal schedule: `systemctl list-timers invisible-market-certbot-renew.timer`.
- Renewal logs: `journalctl -u invisible-market-certbot-renew -n 100 --no-pager`.
- Data and images: `/opt/invisible-market/data`. Stop the application and back up the entire directory before updating. Restore the database and images from the same backup.
- Key management: use `scripts/manage-clients.js` as described in the project README to create individual keys and quotas for each client.

To update, prepare the new source in a separate directory on the same server, such as `/opt/invisible-market-next`, and run `npm ci --omit=dev` there. Then run the update script from the new version:

~~~sh
sudo bash /opt/invisible-market-next/deploy/native/apply-security-update.sh /opt/invisible-market-next
~~~

The update script stops the service, backs up the current application, installs the new source and service configuration, checks authentication, and restarts the service. It restores the backup if the update fails. The existing private `.env`, `data/`, and `certs/` remain in the application directory. After updating certificate scripts, run `sudo bash /opt/invisible-market/deploy/native/setup-certbot.sh` to reinstall the hook and timer. Backups contain private configuration and real data. Keep them accessible only to administrators and never upload them to GitHub.

`apply-security-update.sh` was adapted from the existing instance's maintenance tooling and is intended for application updates after HTTPS has been configured. `sanitize-backup.mjs` is a legacy maintenance tool for older recommendation feature storage. Running it migrates the specified backup database; it is not a general backup or restore command. `10-invisible-market-sshd-hardening.conf` and `cloud-init-hotplugd.socket.override.conf` are legacy system hardening examples. The cloud-init override is particularly dependent on the server image version. Check the server environment and confirm a working fallback management channel before applying these examples individually as needed.

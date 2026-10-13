# Ubuntu / 阿里云 ECS 部署

本指南适用于一台专用 Ubuntu 24.04 LTS x86_64 服务器，采用 Node.js 24、systemd、Nginx 和 SQLite。部署脚本以 root 权限安装到 `/opt/invisible-market`，不需要 Docker。请在新服务器上按顺序执行；这些步骤会修改应用服务与 Nginx 的默认站点。

## 当前阿里云实例

目前部署的 API 地址：

| 功能 | HTTPS 地址 |
| --- | --- |
| 商品上传 | [https://47.98.16.128:3101](https://47.98.16.128:3101) |
| 最适合推荐 | [https://47.98.16.128:3102](https://47.98.16.128:3102) |
| 最不适合推荐 | [https://47.98.16.128:3103](https://47.98.16.128:3103) |

这些地址提供 JSON API，访问需要独立客户端令牌，无令牌请求返回 `401`。请求格式与客户端密钥管理见[项目 README](../README.md)。周报端口 `3104` 仅对站主来源白名单开放，需要站主令牌；公网读者不能通过它读取周报。这里公布服务地址，不公布任何访问密钥。

## 1. 准备服务器与网络

在阿里云安全组及服务器防火墙中开放：

- TCP `3101`–`3103`：允许 API 客户端访问。
- TCP `3104`：仅允许站主可信来源，或保持关闭并使用下文 SSH 通道。
- TCP `80`：对公网持续放行，用于 IP 证书的 HTTP-01 签发及续期；不要让其他服务占用该端口。
- TCP `22`：仅允许管理员可信来源，并使用 SSH 密钥登录。
- 内部 `4101`–`4104` 保持关闭，应用只监听 `127.0.0.1`。

公网地址必须固定，并可从外部到达服务器。证书步骤支持 IPv4。阿里云规则操作见[安全组文档](https://help.aliyun.com/zh/ecs/user-guide/start-using-security-groups)。

## 2. 安装应用

将公开仓库克隆到服务器上的临时源码目录；使用自己的 fork 时，把下面的仓库地址替换为你的地址：

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

`bootstrap.sh` 使用 [NodeSource 的 Node.js 24 软件源](https://github.com/nodesource/distributions/blob/master/DEV_README.md)，创建专用应用账户，并安装 Nginx、OpenSSL、Python 和 rsync。数据库及图片由专用账户写入，源码由 root 管理。

## 3. 配置密钥并启动内部 API

首次部署时，从公开模板创建私有配置：

~~~sh
sudo install -o root -g invisible-market -m 0640 .env.example /opt/invisible-market/.env
sudoedit /opt/invisible-market/.env
~~~

设置不同的 `AGENT_API_KEY` 和 `OWNER_API_KEY`，各至少 24 个字符；设置自己的 `DASHSCOPE_API_KEY`、阿里云工作空间 HTTPS 地址 `DASHSCOPE_BASE_URL`，并按项目 README 配置模型。配置文件只保留在服务器，不能提交到 GitHub。

~~~sh
sudo bash deploy/native/setup-service.sh
sudo systemctl status invisible-market --no-pager
~~~

首次启动会自动创建 SQLite 数据库及表，不需要上传旧数据库。服务使用 `/opt/invisible-market/data`，内部端口为 `4101`–`4104`，环境配置及数据目录的权限会自动收紧。

## 4. 配置 HTTPS 与自动续期

此方案使用 [Let's Encrypt 的短期 IP 证书](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)，需要 Certbot 5.4 或更高版本。短期证书必须自动续期；`setup-certbot.sh` 安装独立 Python 环境和每天两次检查的 systemd timer。

将示例 IP 替换为**你的服务器公网 IPv4 地址**。证书名称默认为 `invisible-market`；一台服务器部署多个应用时应使用不同名称。

~~~sh
cd /opt/invisible-market
sudo bash deploy/native/setup-nginx.sh
sudo PUBLIC_IP=203.0.113.10 CERT_NAME=invisible-market bash deploy/native/setup-certbot.sh
sudo bash deploy/native/issue-free-certificate.sh
sudo bash deploy/native/renew-certificate.sh --dry-run --no-random-sleep-on-renew
~~~

首次签发会接受 Let's Encrypt 服务条款，采用无邮箱账户；如需要邮件联系信息，可先用 Certbot 注册自己的账户。自动续期依赖 TCP `80` 持续可达，Nginx 仅监听 HTTPS 业务端口。

安装脚本把 `PUBLIC_IP` 和 `CERT_NAME` 保存到 root 专用的 `certs/certificate.conf`，该目录已被 Git 忽略。也可以参考 `deploy/native/certificate.conf.example` 在服务器上配置。普通手动命令支持同名环境变量覆盖；定时续期使用保存的配置。

原始证书位于 `/etc/letsencrypt/live/<CERT_NAME>/`；应用副本位于 `/opt/invisible-market/certs/`。renew 命令只续期本应用的证书；deploy hook 会检查证书名称，只有本应用的证书才能覆盖其文件。安装时检查证书有效期、IP 与密钥配对，再启动或重载 Nginx，并验证四个 HTTPS 端口的无令牌请求均返回 `401`。

如果已有证书，先按上述步骤保存匹配的 `CERT_NAME`，再签发或续期。不要修改其他站点的证书名称或全局续期任务。IP 地址变化时需要更新配置并为新地址签发证书。

## 5. 验证

在服务器上、仓库根目录中执行：

~~~sh
cd /opt/invisible-market
sudo DATA_DIR=/opt/invisible-market/data node --env-file=.env deploy/native/verify.mjs
sudo node --env-file=.env deploy/native/verify-security.mjs
~~~

验证脚本检查数据完整性、内部端口鉴权和密钥是否可用，不打印密钥。周报尚未生成时，已鉴权的周报请求返回 `404` 属于正常情况。

使用项目 README 中的上传流程提交至少一个有图片的商品后，可选执行模型连通性验证。该检查会真实调用阿里云模型并产生相应费用：

~~~sh
sudo DATA_DIR=/opt/invisible-market/data node --env-file=.env deploy/native/smoke-ai.mjs
~~~

从服务器外访问 `https://<PUBLIC_IP>:3101`–`:3103`，验证受信任 TLS 和无令牌的 `401`；不要使用跳过证书校验的选项。

## 6. 站主周报 SSH 通道

Windows 上使用 `scripts/report-tunnel.ps1`，显式传入服务器、用户、私钥和已验证的主机记录。先通过阿里云控制台或可信管理通道读取服务器 SSH 主机公钥指纹，然后核对本机记录。仅采集公钥不能证明服务器身份。

服务器控制台上查看指纹：

~~~sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
~~~

Windows 项目目录中采集并核对指纹；将 `SERVER_HOST` 替换为自己的主机：

~~~powershell
ssh-keyscan -t ed25519 SERVER_HOST | Out-File -Encoding ascii deploy/known_hosts
ssh-keygen -lf deploy/known_hosts
~~~

确认指纹与可信控制台一致后启动通道：

~~~powershell
./scripts/report-tunnel.ps1 -Host SERVER_HOST -User ubuntu -KeyPath C:\private\server.pem -KnownHostsPath ./deploy/known_hosts
~~~

脚本默认映射 `http://127.0.0.1:43104` 到服务器的 `127.0.0.1:4104`，保持窗口运行，在本机请求 `/reports/latest` 时携带 `OWNER_API_KEY`。可用 `-SshPort`、`-LocalPort`、`-RemotePort` 修改端口。严格主机验证始终启用，私钥及主机记录不应进入公开包。

## 7. Docker Compose 备选

`compose.yaml` 提供容器部署方案，需要服务器能够下载 Node.js 与 Nginx 镜像。它与上面的原生部署是两种安装方式，业务端口相同，不能在同一主机同时使用默认配置。

在仓库根目录创建私有 `.env` 并填写与原生部署相同的访问密钥和阿里云配置；准备适用于自己公网 IP 或域名的可信证书，将证书链保存为 `certs/fullchain.pem`、私钥保存为 `certs/privkey.pem`。Compose 将整个 `certs/` 目录只读挂载到 Nginx；私钥应仅允许管理员读取，并在证书更新后重载或重启 gateway。

Linux 上，容器内的应用账户 UID/GID 为 `1000:1000`，宿主数据目录需要由它写入。以下命令适用于首次创建的空数据目录：

~~~sh
cp .env.example .env
chmod 0600 .env
install -d -m 0700 certs
# 编辑 .env 并准备 certs/fullchain.pem、certs/privkey.pem 后再启动。
sudo install -d -o 1000 -g 1000 -m 0700 data data/images
docker compose up -d --build
~~~

如果恢复已有数据，先停服并确保整个 `data/` 目录及数据库、图片对 UID/GID `1000:1000` 可读写。容器首次启动同样会自动创建数据库，不需要示例商品或真实数据包。

本例将四个端口 `3101`–`3104` 全部绑定到宿主机所有网络接口，必须用云安全组和服务器防火墙限制来源，尤其将 `3104` 仅限站主可信来源。也可将 Compose 中周报映射改为 `127.0.0.1:3104:3104`，通过 SSH 转发到服务器的 `3104`（Windows 通道脚本使用 `-RemotePort 3104`）；其他端口也可按需显式指定绑定地址。Docker 部署不会自动安装本指南的原生 Certbot timer，需要自行安排证书续期，并将更新后的证书同步到 `certs/`。

## 8. 更新与维护

- 应用状态：`systemctl status invisible-market nginx`。
- 应用日志：`journalctl -u invisible-market -n 100 --no-pager`。
- 续期计划：`systemctl list-timers invisible-market-certbot-renew.timer`。
- 续期日志：`journalctl -u invisible-market-certbot-renew -n 100 --no-pager`。
- 数据与图片：`/opt/invisible-market/data`。更新前停止应用并备份整个目录；恢复时保持数据库与图片来自同一次备份。
- 密钥管理：使用项目 README 中的 `scripts/manage-clients.js`，为每个客户端生成独立密钥与额度。

更新时在同一台服务器上把新源码准备到独立目录（例如 `/opt/invisible-market-next`），运行 `npm ci --omit=dev`，再使用新版本的更新脚本执行：

~~~sh
sudo bash /opt/invisible-market-next/deploy/native/apply-security-update.sh /opt/invisible-market-next
~~~

更新脚本会停服、备份当前应用、安装新源码及服务配置、检查鉴权并重启服务；失败时恢复备份。私有 `.env`、`data/`、`certs/` 保留在现有应用目录。更新证书脚本后，执行 `sudo bash /opt/invisible-market/deploy/native/setup-certbot.sh` 重新安装 hook 和 timer。备份含私有配置与真实数据，只能保留在管理员可访问的位置，不能上传 GitHub。

`apply-security-update.sh` 由既有实例的维护工具整理而来，适用于已经完成 HTTPS 配置的本应用更新。`sanitize-backup.mjs` 是针对旧版推荐特征存储的历史维护工具，运行它会迁移指定的备份数据库；它不是普通备份或恢复命令。`10-invisible-market-sshd-hardening.conf` 和 `cloud-init-hotplugd.socket.override.conf` 是历史系统加固示例；cloud-init 覆盖尤其依赖镜像版本。请先确认服务器环境和备用管理通道，再由管理员按需要单独应用。

# Invisible Market · 谁也看不见的市场

面向受控 AI 客户端的商品上传、推荐与反馈服务。项目提供四个 JSON HTTP API，不提供网页；浏览器直接打开部署地址不会出现网站界面。需要 Node.js 24 或更高版本，使用内置 SQLite 保存商品、私有标签、推荐反馈和周报，阿里云百炼负责图片理解及用户特征提取。

## 功能概览

- 上传商品照片，生成待确认的描述和参考价格；确认后才入库。
- 根据自然语言用户特征，分别推荐最适合和最不适合的商品。
- 收集一次性推荐反馈，按北京时间生成每周统计和优化建议。
- 为 AI 客户端签发独立密钥，提供限流、额度控制和撤销能力；站主报告独立鉴权。
- 重新编码上传图片、移除元数据，限制图片大小并尽量减少用户特征存储。

## 阿里云公开 API 地址

| 用途 | API 基址 | 接入方式 |
| --- | --- | --- |
| 上传商品 | [https://47.98.16.128:3101](https://47.98.16.128:3101) | 生产客户端凭证 |
| 最适合推荐 | [https://47.98.16.128:3102](https://47.98.16.128:3102) | 生产客户端凭证 |
| 最不适合推荐 | [https://47.98.16.128:3103](https://47.98.16.128:3103) | 生产客户端凭证 |
| 站主报告 | `https://47.98.16.128:3104` | 来源 IP 白名单及站主凭证 |

以上地址是 API 基址，需要结合下文的请求方法和路径调用。上传与推荐服务在未提供有效凭证时返回 HTTP `401`；站主报告端口仅允许白名单来源连接。源码开源不代表获得生产实例的访问凭证。需要生产账户时，请私下向维护者申请；自行部署并配置自己的百炼账户和密钥后，可以使用完整功能。

2026-10-13 已验证上述上传与推荐端口的 HTTPS 证书及无凭证 `401` 响应。该记录仅表示当时可连接，不代表持续可用性承诺。

## 本地快速启动

准备 Node.js 24 或更高版本及阿里云百炼 API 密钥，在项目目录运行：

```sh
git clone https://github.com/zjlggdss/invisible-market-api.git
cd invisible-market-api
```

```powershell
Copy-Item .env.example .env
```

在 Linux / macOS 中可使用 `cp .env.example .env`。编辑 `.env`，设置两个不同且至少 24 字符的随机密钥 `AGENT_API_KEY`、`OWNER_API_KEY`，填写 `DASHSCOPE_API_KEY`，将自己的百炼 HTTPS 接入地址填入 `DASHSCOPE_BASE_URL`。接入地址说明见[阿里云工作空间专属接入地址](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)。

```sh
npm ci
npm test
npm start
```

测试使用虚拟 AI 和临时数据库，不调用百炼，也不需要生产凭证。可用以下命令生成一个随机密钥，运行两次分别填写客户端和站主密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

默认仅监听 `127.0.0.1`，运行后按下文接口说明携带本地配置的凭证调用。需要对外服务时，在网关/TLS 后配置 `HOST=0.0.0.0`，并仅开放所需端口。

## Docker 部署

仓库提供 `Dockerfile` 和 `compose.yaml`，通过 Nginx 提供四个 HTTPS 端口。先配置 `.env`、持久化数据目录和 TLS 证书，再运行：

```sh
docker compose up -d --build
```

证书挂载、端口限制和阿里云 ECS 部署步骤见 [deploy/README.md](deploy/README.md)。当前阿里云实例采用 Node.js + systemd + Nginx 部署。

## 配置与客户端管理

如需单独验证视觉模型连接，运行 `node --env-file=.env scripts/smoke-vision.js`。它只发送一张程序生成的测试图，不会创建商品。

`.env` 和 `data/` 不应提交到版本库。建议为四个端口配置 HTTPS 反向代理。`AGENT_API_KEY` 是兼容旧客户端的初始密钥；`OWNER_API_KEY` 只给站主。密钥能认证调用方，却无法从网络层证明调用程序一定是 AI；实际接入时应由受控的 AI 代理保管密钥，不要交给最终用户或浏览器。

生产环境建议为每个受控 AI 客户端单独签发密钥：在服务器的 `/opt/invisible-market` 目录执行 `node --env-file=.env scripts/manage-clients.js create 客户端名称`；只在创建时显示一次密钥。使用 `list` 查看客户端 ID，使用 `disable ID` 立即撤销，必要时用 `enable ID` 恢复。迁移完旧客户端后，可以 `disable legacy`。不要把密钥写进日志、聊天或公开文件。默认每个客户端每天最多创建 20 个上传草稿、请求 200 次推荐，每分钟最多 60 次接口请求；可通过 `UPLOADS_PER_DAY`、`RECOMMENDATIONS_PER_DAY`、`AGENT_REQUESTS_PER_MINUTE` 调整。AI 并发默认为 4，可通过 `MAX_CONCURRENT_AI` 调整。

默认端口：

| 端口 | 用途 | 凭证 |
| --- | --- | --- |
| 3101 | 上传商品草稿、确认入库 | `AGENT_API_KEY` |
| 3102 | 下载最适合商品、提交反馈 | `AGENT_API_KEY` |
| 3103 | 下载最不适合商品、提交反馈 | `AGENT_API_KEY` |
| 3104 | 下载周报、手动触发上周报告 | `OWNER_API_KEY` |

所有请求使用 `Authorization: Bearer <密钥>`。请求与响应为 UTF-8 JSON；图片用 Base64 传输。仅接受可完整解码的 JPEG、PNG、WebP，单张最多 5 MB，整批最多 40 MB，像素不超过 2400 万；入库前会重新编码并移除元数据。外观照片至少 3 张、最多 12 张，不能重复；第 4 至第 6 张及更多照片均为选填。内腔照片可选，最多 4 张。

## 端口 1：上传与确认

`POST /products/drafts`

```json
{
  "exterior_images": [
    {"mime_type": "image/jpeg", "data_base64": "<照片1>"},
    {"mime_type": "image/jpeg", "data_base64": "<照片2>"},
    {"mime_type": "image/jpeg", "data_base64": "<照片3>"}
  ],
  "interior_images": [],
  "description": "可选的商品描述",
  "price_usd": 29.99,
  "location": "可选的商品所在地"
}
```

`description` 与 `price_usd` 可省略。省略时，响应返回 `proposed_description`、`proposed_price_usd` 和 `draft_id`，等待用户确认。AI 认为商品有内腔且未收到内腔照片时，`interior_image_suggested` 为 `true`。草稿 24 小时过期；确认前商品不入库。

`POST /products/drafts/{draft_id}/confirm`

```json
{
  "accept_description": true,
  "accept_price": false,
  "price_usd": 25,
  "interior_images": []
}
```

若拒绝建议描述，发送 `"accept_description": false` 与自己的 `description`；若拒绝参考价格，发送 `"accept_price": false` 与自己的 `price_usd`。卖家最初已提交的描述或价格无需再次确认。自填描述会重新与图片核对。

图像元数据出现常见修图软件标记，或模型判断存在明显数字篡改时，返回 HTTP 422、`error.code: 114`、`禁止使用经过PS的照片`。视觉模型无法保证检出所有修图，也可能误判；如需严格的真实照片认证，后续应增加带签名的拍摄来源或人工复核。

## 端口 2 与 3：推荐与反馈

两个端口使用相同路径：`POST /recommendations`。

```json
{"user_features": "我26岁，住在上海，喜欢陶瓷制品，预算20美元。"}
```

输入为自然语言，不会反向向用户索取指定维度。模型仅提取文本里明确给出的特征；可识别维度不足 3 项时返回 HTTP 422、`error.code: 66`。成功时返回一件商品的全部图片 Base64、描述、美元价格，以及一次性 `recommendation_id` 和 `feedback_token`。不返回产品标签或内部用户特征。

在原推荐端口发送 `POST /recommendations/{recommendation_id}/feedback`：

```json
{"feedback_token": "<上一步返回的令牌>", "result": "适合我"}
```

`result` 也可为 `不适合我`。每条推荐只接受一次反馈。推荐主要依据喜好、明确预算、地点和商品受众提示；月收入仅在明确给出美元金额和周期、且缺少预算时用于粗略判断价格负担。性别、年龄、教育程度及 MBTI 仅在标签具有意义时提供较小权重。民族不用于排序，也不存储在推荐记录中。数据库仅保存周报所需的“是否有明确偏好”和“是否超预算”信号，推荐明细保留 90 天；原始用户特征文本不入库。内部商品标签还保存可从图片判断的材质、品相和用途，便于更准确地匹配喜好。

## 端口 4：周报

每周一按北京时间生成上一个完整自然周的报告，启动时也会补齐最近一周。报告仅统计已提交反馈的推荐。

- `GET /reports/latest`：最新报告。
- `GET /reports/YYYY-MM-DD`：指定周一开始的报告。
- `POST /reports/run`：立即生成上一个完整自然周的报告；同一周不会重复生成。

报告包含反馈数、准确率、按推荐模式和商品类型的统计，以及预算与喜好错配信号和优化建议。样本较少时会提示准确率不稳定。由于阿里云密钥未包含在项目里，实际模型调用需配置你的百炼账户后才能端到端验证。

## 错误响应

```json
{"error": {"code": 66, "message": "上传的特征过少，无法进行有效推荐"}}
```

常见状态码：400 请求格式错误，401 密钥错误，404 资源不存在，409 草稿已确认，422 内容校验失败，429 调用过频或超额，503 阿里云接口不可用或 AI 输出无效。所有端口无 HTML 页面。

## 阿里云部署

服务器系统、四端口 HTTPS 配置、证书与数据迁移步骤见 [deploy/README.md](deploy/README.md)。

## 贡献与许可

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

源码以 [MIT License](LICENSE) 开源。阿里云服务费用、生产实例访问权限和第三方服务条款由各自的账户及服务约定决定。

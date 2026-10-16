# Invisible Market

A service for product uploads, recommendations, and feedback, designed for controlled AI clients. The project exposes four JSON HTTP APIs and has no web interface; opening a deployment address in a browser does not display a website. It requires Node.js 24 or later, uses built-in SQLite to store products, private tags, recommendation feedback, and weekly reports, and uses Alibaba Cloud Model Studio for image understanding and user feature extraction.

## Features

- Upload product photos and generate a proposed description and reference price. Products enter the catalog only after confirmation.
- Recommend the most suitable or least suitable product based on user features expressed in natural language.
- Collect one-time recommendation feedback and generate weekly statistics and improvement suggestions using Beijing time.
- Issue individual AI client credentials with rate limits, quotas, and revocation. Owner reports use separate authentication.
- Re-encode uploaded images, remove metadata, enforce image limits, and minimize stored user features.

## Public Alibaba Cloud API addresses

| Purpose | API base URL | Access requirement |
| --- | --- | --- |
| Product uploads | [https://47.98.16.128:3101](https://47.98.16.128:3101) | Production client credentials |
| Most suitable recommendations | [https://47.98.16.128:3102](https://47.98.16.128:3102) | Production client credentials |
| Least suitable recommendations | [https://47.98.16.128:3103](https://47.98.16.128:3103) | Production client credentials |
| Owner reports | `https://47.98.16.128:3104` | Source IP allowlist and owner credentials |

These are API base URLs; use the methods and paths documented below. Upload and recommendation endpoints return HTTP `401` without valid credentials. The owner report port accepts connections only from allowlisted sources. Access to the open-source code does not grant credentials for the production instance. Request a production account privately from the maintainer. You can use all features by deploying your own instance with your own Model Studio account and credentials.

The HTTPS certificates and unauthenticated `401` responses for the upload and recommendation ports were verified on **2026-10-13**. This records connectivity at that time and does not guarantee continued availability.

## Local quick start

Install Node.js 24 or later and obtain an Alibaba Cloud Model Studio API key. Clone the repository:

```sh
git clone https://github.com/zjlggdss/invisible-market-api.git
cd invisible-market-api
```

Copy the example configuration on Windows:

```powershell
Copy-Item .env.example .env
```

On Linux or macOS, use `cp .env.example .env`. Edit `.env` to set distinct random `AGENT_API_KEY` and `OWNER_API_KEY` values, each at least 24 characters long. Set `DASHSCOPE_API_KEY` and enter your Model Studio HTTPS endpoint in `DASHSCOPE_BASE_URL`. See the [Alibaba Cloud workspace endpoint documentation](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions) for the endpoint format.

```sh
npm ci
npm test
npm start
```

Tests use a fake AI provider and temporary databases. They do not call Model Studio or require production credentials. Generate a random key with the following command; run it twice to create separate client and owner keys:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The service listens on `127.0.0.1` by default. Call the endpoints below using the credentials from your local configuration. To expose an instance, set `HOST=0.0.0.0` behind a gateway with TLS and open only the required ports.

## Docker deployment

The repository includes a `Dockerfile` and `compose.yaml`. Nginx exposes four HTTPS ports. Configure `.env`, the persistent data directory, and TLS certificates before starting the stack:

```sh
docker compose up -d --build
```

See [deploy/README.md](deploy/README.md) for certificate mounts, port restrictions, and Alibaba Cloud ECS deployment instructions. The current Alibaba Cloud instance uses Node.js, systemd, and Nginx.

## Configuration and client management

To check the vision model connection separately, run `node --env-file=.env scripts/smoke-vision.js`. It sends one programmatically generated test image and does not create a product.

Do not commit `.env` or `data/`. Configure an HTTPS reverse proxy for externally accessible ports. `AGENT_API_KEY` provides an initial credential for legacy clients; `OWNER_API_KEY` is reserved for the owner. Credentials authenticate callers but cannot prove that a caller is an AI program. Keep credentials with controlled AI agents, rather than sharing them with end users or embedding them in browsers.

In production, issue a separate key to each controlled AI client. From `/opt/invisible-market` on the server, run:

```sh
node --env-file=.env scripts/manage-clients.js create client-name
```

The key is displayed only once, when created. Use `list` to view client IDs, `disable ID` to revoke access immediately, and `enable ID` to restore it when needed. After migrating legacy clients, use `disable legacy` to disable the shared credential. Keep keys out of logs, chats, and public files.

Each client is limited by default to 20 upload drafts per day, 200 recommendations per day, and 60 API requests per minute. Adjust these limits with `UPLOADS_PER_DAY`, `RECOMMENDATIONS_PER_DAY`, and `AGENT_REQUESTS_PER_MINUTE`. The default AI concurrency limit is 4; change it with `MAX_CONCURRENT_AI`.

Default ports:

| Port | Purpose | Credential |
| --- | --- | --- |
| 3101 | Create product drafts and confirm catalog entries | `AGENT_API_KEY` or an individual client key |
| 3102 | Retrieve the most suitable product and submit feedback | `AGENT_API_KEY` or an individual client key |
| 3103 | Retrieve the least suitable product and submit feedback | `AGENT_API_KEY` or an individual client key |
| 3104 | Retrieve weekly reports and generate last week's report | `OWNER_API_KEY` |

All requests use `Authorization: Bearer <key>`. Requests and responses use UTF-8 JSON; images are transferred as Base64. Accepted formats are fully decodable JPEG, PNG, and WebP, with a maximum of 5 MB per image, 40 MB per batch, and 24 million pixels per image. Images are re-encoded and metadata is removed before storage. Provide 3 to 12 distinct exterior photos; photos beyond the first 3 are optional. Interior photos are optional, with a maximum of 4.

## Port 1: Uploads and confirmation

`POST /products/drafts`

```json
{
  "exterior_images": [
    {"mime_type": "image/jpeg", "data_base64": "<photo-1>"},
    {"mime_type": "image/jpeg", "data_base64": "<photo-2>"},
    {"mime_type": "image/jpeg", "data_base64": "<photo-3>"}
  ],
  "interior_images": [],
  "description": "Optional product description",
  "price_usd": 29.99,
  "location": "Optional product location"
}
```

`description` and `price_usd` are optional. If omitted, the response includes `proposed_description`, `proposed_price_usd`, and `draft_id` for confirmation. If the AI identifies an interior cavity and no interior photos were supplied, `interior_image_suggested` is `true`. Drafts expire after 24 hours. A product is not added to the catalog until confirmed.

`POST /products/drafts/{draft_id}/confirm`

```json
{
  "accept_description": true,
  "accept_price": false,
  "price_usd": 25,
  "interior_images": []
}
```

To reject the proposed description, send `"accept_description": false` with your own `description`. To reject the reference price, send `"accept_price": false` with your own `price_usd`. A description or price supplied by the seller in the original request does not need confirmation. A replacement description is checked against the images again.

If image metadata contains markers from common editing software, or the model detects obvious digital manipulation, the API returns HTTP `422` with `error.code: 114` and `Digitally edited photos are not allowed`. The vision model can miss edits or flag genuine photos incorrectly. Stronger photo authenticity checks would require signed capture provenance or human review.

## Ports 2 and 3: Recommendations and feedback

Both ports use `POST /recommendations`.

```json
{"user_features": "I am 26, live in Shanghai, enjoy pottery, and have a budget of USD 20."}
```

The input is natural language; the API does not ask the user to supply specific categories. The model extracts only features explicitly stated in the text. Fewer than 3 identifiable feature categories result in HTTP `422` with `error.code: 66` and `Too few user features for an effective recommendation`. A successful response contains all images of one product as Base64, its description and price in USD, and a one-time `recommendation_id` and `feedback_token`. It does not expose product tags or internal user features.

Submit feedback on the same port that returned the recommendation using `POST /recommendations/{recommendation_id}/feedback`:

```json
{"feedback_token": "<token-from-the-recommendation>", "result": "suitable"}
```

Set `result` to `suitable` or `unsuitable`. Legacy feedback values remain accepted for compatibility. Each recommendation accepts feedback only once. English feedback values are supported by v1.0.1 and later; existing hosted instances may require an upgrade.

Recommendations primarily consider preferences, an explicit budget, location, and product audience hints. Monthly income is used only as a rough affordability signal when no budget is given and the income includes an explicit USD amount and period. Gender, age, education, and MBTI have lower weights and are used only when relevant tags are available. Ethnicity is not used for ranking or stored in recommendation records.

The database stores only the signals needed for weekly reports: whether an explicit preference was supplied and whether the product exceeded the budget. Recommendation details are retained for 90 days; raw user feature text is not stored. Internal product tags also capture visible material, condition, and use to improve preference matching.

## Port 4: Weekly reports

Each Monday, using Beijing time, the service generates a report for the previous complete calendar week. It also fills in the latest week's report on startup. Reports include only recommendations with submitted feedback.

- `GET /reports/latest`: Retrieve the latest report.
- `GET /reports/YYYY-MM-DD`: Retrieve the report for the week beginning on the specified Monday.
- `POST /reports/run`: Generate the previous complete calendar week's report immediately. The same week is not generated twice.

Reports include feedback counts, accuracy, breakdowns by recommendation mode and product type, budget and preference mismatch signals, and improvement suggestions. Small samples are flagged because accuracy estimates may be unstable. Alibaba Cloud credentials are not included in the repository; end-to-end verification of real model calls requires your own configured Model Studio account.

## Error responses

```json
{"error": {"code": 66, "message": "Too few user features for an effective recommendation"}}
```

Common HTTP status codes: `400` for malformed requests, `401` for invalid credentials, `404` for missing resources, `409` for an already confirmed draft, `422` for content validation failures, `429` for rate or quota limits, and `503` for an unavailable Alibaba Cloud API or invalid AI output. None of the ports serves HTML pages.

## Alibaba Cloud deployment

See [deploy/README.md](deploy/README.md) for server requirements, HTTPS configuration for all four ports, certificates, and data migration.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. Report security issues privately as described in [SECURITY.md](SECURITY.md).

The source code is available under the [MIT License](LICENSE). Alibaba Cloud charges, production instance access, and third-party service terms are governed by the relevant accounts and service agreements.

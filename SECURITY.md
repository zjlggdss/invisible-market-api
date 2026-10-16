# Security

## Reporting a security issue

Report security issues through a private channel with the maintainer. If the repository has GitHub private vulnerability reporting enabled, use **Report a vulnerability** on its Security page. If no private channel is available, open a public issue requesting one without including vulnerability details, exploit code, credentials, or real data.

A private report should include the affected version or commit, triggering conditions, reproduction steps using synthetic data, expected impact, and any suggested fix. Avoid publishing directly exploitable details while the issue is being addressed. The project does not currently commit to a fixed response time or long-term maintenance schedule.

## Credentials and data

- Keep `.env`, API keys, SSH private keys, TLS private keys, databases, product images, and user data out of public repositories, logs, issues, and chat screenshots.
- Public API addresses do not grant access. Request a production client account privately from the maintainer. Do not share production keys or embed them in browser code.
- Give each controlled AI client an individual credential and use the client management script to revoke accounts that are no longer needed. Reserve the owner key for report endpoints.
- If a credential leaks, revoke or rotate it first, then remove it from public locations and version history. Deleting a file does not invalidate an exposed credential.

## Independent deployments

You can deploy the full service using your own Model Studio account, distinct randomly generated keys, and a separate data directory. Configure HTTPS, open only required ports, and restrict the report port with a source IP allowlist or an SSH tunnel. Follow [deploy/README.md](deploy/README.md) for persistence, permissions, and backups.

Validate changes on your own instance using synthetic data. Do not scan, load-test, or attempt to access other people's data on a production instance without authorization.

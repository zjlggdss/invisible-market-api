import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/opt/invisible-market/data/market.sqlite');
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const sensitiveRows = db.prepare(`SELECT COUNT(*) AS count FROM recommendations
  WHERE profile_json LIKE '%ethnicity%' OR profile_json LIKE '%income_usd_monthly%'`).get().count;
const clients = db.prepare('SELECT COUNT(*) AS count FROM api_clients').get().count;
db.close();
if (integrity !== 'ok' || sensitiveRows !== 0 || clients < 1) throw new Error('Database security check failed');

const statuses = {};
for (const [name, port, key] of [
  ['upload', 4101, process.env.AGENT_API_KEY],
  ['best', 4102, process.env.AGENT_API_KEY],
  ['worst', 4103, process.env.AGENT_API_KEY],
  ['report', 4104, process.env.OWNER_API_KEY]
]) {
  const response = await fetch(`http://127.0.0.1:${port}/security-check`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000)
  });
  statuses[name] = response.status;
  if (response.status !== 404) throw new Error(`${name} authentication failed: ${response.status}`);
}
console.log(JSON.stringify({ integrity, sensitiveRows, clients, authenticatedPorts: statuses }));

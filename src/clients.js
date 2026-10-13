import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from './core.js';

export const hashKey = key => createHash('sha256').update(key).digest('hex');

export function bootstrapLegacyClient(db, key) {
  db.prepare(`INSERT INTO api_clients (id,label,key_hash,created_at) VALUES ('legacy','Legacy agent',?,?)
    ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash`).run(hashKey(key), new Date().toISOString());
}

export function createClient(db, label) {
  if (typeof label !== 'string' || !label.trim() || label.length > 100) throw new Error('Client label must be 1-100 characters');
  const id = randomUUID();
  const key = `im_${randomBytes(32).toString('base64url')}`;
  db.prepare('INSERT INTO api_clients (id,label,key_hash,created_at) VALUES (?,?,?,?)')
    .run(id, label.trim(), hashKey(key), new Date().toISOString());
  return { id, key };
}

export function setClientEnabled(db, id, enabled) {
  return db.prepare('UPDATE api_clients SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id).changes === 1;
}

export function authenticateClient(db, authorization) {
  const token = /^Bearer (\S{24,256})$/.exec(authorization || '')?.[1];
  if (!token) return null;
  return db.prepare('SELECT id FROM api_clients WHERE key_hash=? AND enabled=1').get(hashKey(token))?.id || null;
}

export function clientLimiter(db, config) {
  const minutes = new Map();
  const minuteLimit = config.agentRequestsPerMinute ?? 60;
  return (clientId, kind = null) => {
    const minute = Math.floor(Date.now() / 60_000);
    const current = minutes.get(clientId);
    const count = current?.minute === minute ? current.count : 0;
    if (count >= minuteLimit) throw new ApiError(429, 'RATE_LIMIT', '请求过于频繁，请稍后重试');
    minutes.set(clientId, { minute, count: count + 1 });
    if (minutes.size > 10000) for (const [id, state] of minutes) if (state.minute < minute) minutes.delete(id);
    if (!kind) return;
    const field = kind === 'upload' ? 'uploads' : 'recommendations';
    const limit = kind === 'upload' ? (config.uploadsPerDay ?? 20) : (config.recommendationsPerDay ?? 200);
    const day = new Date().toISOString().slice(0, 10);
    const prior = db.prepare(`SELECT ${field} AS count FROM api_usage WHERE client_id=? AND day=?`).get(clientId, day)?.count || 0;
    if (prior >= limit) throw new ApiError(429, 'DAILY_LIMIT', '今日调用额度已用完');
    db.prepare(`INSERT INTO api_usage (client_id,day,${field}) VALUES (?,?,1)
      ON CONFLICT(client_id,day) DO UPDATE SET ${field}=${field}+1`).run(clientId, day);
  };
}

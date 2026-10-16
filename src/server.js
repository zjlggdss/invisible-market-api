import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { configFromEnv, assertProductionConfig } from './config.js';
import { openDatabase } from './db.js';
import { createAI, AIUnavailableError } from './ai.js';
import { createService, ApiError } from './core.js';
import { generateWeeklyReport, latestReport, reportForWeek } from './reports.js';
import { authenticateClient, bootstrapLegacyClient, clientLimiter } from './clients.js';

function authorized(req, key) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

async function readJson(req) {
  const limit = 80 * 1024 * 1024;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
    return value;
  } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object'); }
}

export function createServers(config, db, service) {
  bootstrapLegacyClient(db, config.agentKey);
  const limitClient = clientLimiter(db, config);
  let activeAi = 0;
  const withAiSlot = async task => {
    if (activeAi >= (config.maxConcurrentAi ?? 4)) throw new ApiError(429, 'BUSY', 'Service is busy; please try again later');
    activeAi++;
    try { return await task(); } finally { activeAi--; }
  };
  const make = handler => http.createServer({ maxHeaderSize: 8192, headersTimeout: 10_000,
    requestTimeout: 120_000, keepAliveTimeout: 5_000 }, async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof ApiError) send(res, error.status, { error: { code: error.code, message: error.message } });
      else if (error instanceof AIUnavailableError) send(res, 503, { error: { code: 'AI_UNAVAILABLE', message: error.message } });
      else { console.error(error); send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Service is temporarily unavailable' } }); }
    }
  });
  const auth = (req, res, owner = false) => {
    const clientId = owner ? authorized(req, config.ownerKey) && 'owner' :
      authenticateClient(db, req.headers.authorization);
    if (!clientId) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'A valid access token is required' } });
      return null;
    }
    return clientId;
  };
  const upload = make(async (req, res) => {
    const clientId = auth(req, res);
    if (!clientId) return;
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && pathname === '/products/drafts') {
      limitClient(clientId, 'upload');
      const body = await readJson(req);
      return send(res, 202, await withAiSlot(() => service.createDraft(body)));
    }
    const match = /^\/products\/drafts\/([0-9a-f-]{36})\/confirm$/.exec(pathname);
    if (req.method === 'POST' && match) {
      limitClient(clientId);
      const body = await readJson(req);
      return send(res, 201, await withAiSlot(() => service.confirmDraft(match[1], body)));
    }
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });
  const recommend = mode => make(async (req, res) => {
    const clientId = auth(req, res);
    if (!clientId) return;
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && pathname === '/recommendations') {
      limitClient(clientId, 'recommendation');
      const body = await readJson(req);
      return send(res, 200, await withAiSlot(() => service.recommend(body.user_features, mode)));
    }
    const match = /^\/recommendations\/([0-9a-f-]{36})\/feedback$/.exec(pathname);
    if (req.method === 'POST' && match) {
      limitClient(clientId);
      const body = await readJson(req);
      return send(res, 200, service.submitFeedback(match[1], body.feedback_token, body.result));
    }
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });
  const report = make(async (req, res) => {
    if (!auth(req, res, true)) return;
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/reports/latest') {
      const result = latestReport(db);
      if (!result) throw new ApiError(404, 'REPORT_NOT_FOUND', 'No weekly report is available');
      return send(res, 200, result);
    }
    if (req.method === 'GET' && /^\/reports\/\d{4}-\d{2}-\d{2}$/.test(pathname)) {
      const result = reportForWeek(db, pathname.slice(9));
      if (!result) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Weekly report not found');
      return send(res, 200, result);
    }
    if (req.method === 'POST' && pathname === '/reports/run') return send(res, 200, generateWeeklyReport(db));
    send(res, 404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });
  return { upload, best: recommend('best'), worst: recommend('worst'), report };
}

export async function start(config = configFromEnv()) {
  assertProductionConfig(config);
  const db = openDatabase(config.dataDir);
  const ai = createAI(config);
  const service = createService(db, ai, config.dataDir);
  const servers = createServers(config, db, service);
  try {
    for (const [name, server] of Object.entries(servers)) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.ports[name], config.host, resolve);
      });
      console.log(`${name}: http://${config.host}:${config.ports[name]}`);
    }
  } catch (error) {
    for (const server of Object.values(servers)) server.close();
    db.close();
    throw error;
  }
  const runWeekly = () => {
    try {
      db.prepare('DELETE FROM drafts WHERE expires_at < ?').run(new Date().toISOString());
      generateWeeklyReport(db);
      db.prepare('DELETE FROM recommendations WHERE created_at < ?').run(new Date(Date.now() - 90 * 86400_000).toISOString());
      db.prepare('DELETE FROM api_usage WHERE day < ?').run(new Date(Date.now() - 8 * 86400_000).toISOString().slice(0, 10));
    } catch (error) { console.error('Weekly report failed:', error); }
  };
  runWeekly();
  const timer = setInterval(runWeekly, 3600_000);
  return { servers, db, close: async () => {
    clearInterval(timer);
    await Promise.all(Object.values(servers).map(server => new Promise(resolve => server.close(resolve))));
    db.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(error => { console.error(error); process.exitCode = 1; });
}

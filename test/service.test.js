import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/db.js';
import { createService, ApiError } from '../src/core.js';
import { generateWeeklyReport, previousWeek } from '../src/reports.js';
import { createServers } from '../src/server.js';
import { authenticateClient, bootstrapLegacyClient, clientLimiter, createClient, setClientEnabled } from '../src/clients.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invisible-market-test-'));
  const db = openDatabase(dir);
  const ai = {
    async analyzeProduct() { return {
      edited: false, distinct_exterior_views: true, description_matches: true,
      proposed_description: 'Blue ceramic cup', proposed_price_usd: 12.5, has_cavity: true,
      tags: { product_type: 'Cup', keywords: ['ceramic', 'blue'], age_group: '18-65' }
    }; },
    async checkImages() { return { edited: false }; },
    async matchDescription() { return { matches: true }; },
    async extractProfile() { return { likes: ['ceramic'], country: 'China', age: 26, budget_usd: 20 }; }
  };
  return { dir, db, ai, service: createService(db, ai, dir), close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const photos = await Promise.all(Array.from({ length: 12 }, (_, index) =>
  sharp({ create: { width: 30, height: 30, channels: 3,
    background: { r: index * 17, g: 100, b: 200 - index * 12 } } }).jpeg().toBuffer()));

function photo(index, edited = false) {
  const bytes = edited ? Buffer.concat([photos[index], Buffer.from('Adobe Photoshop')]) : photos[index];
  return { mime_type: 'image/jpeg', data_base64: bytes.toString('base64') };
}

test('upload, confirm, recommend, feedback, weekly report', async () => {
  const f = fixture();
  try {
    const draft = await f.service.createDraft({ exterior_images: Array.from({ length: 6 }, (_, i) => photo(i)) });
    assert.equal(draft.proposed_description, 'Blue ceramic cup');
    assert.equal(draft.proposed_price_usd, 12.5);
    assert.equal(draft.interior_image_suggested, true);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM products').get().n, 0);
    const product = await f.service.confirmDraft(draft.draft_id, { accept_description: true, accept_price: true });
    assert.equal(product.price_usd, 12.5);
    const recommendation = await f.service.recommend('I like ceramics, am 26, live in China, and have a USD 20 budget.', 'best');
    assert.equal(recommendation.product.images.length, 6);
    assert.equal(recommendation.product.description, 'Blue ceramic cup');
    assert.equal('tags' in recommendation.product, false);
    assert.equal('profile' in recommendation, false);
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT profile_json FROM recommendations WHERE id=?').get(recommendation.recommendation_id).profile_json),
      { has_preferences: true, budget_exceeded: false });
    assert.equal(f.service.submitFeedback(recommendation.recommendation_id, recommendation.feedback_token, 'suitable').status, 'saved');
    const week = previousWeek();
    f.db.prepare('UPDATE recommendations SET created_at=? WHERE id=?').run(new Date(new Date(week.start).getTime() + 86400_000).toISOString(), recommendation.recommendation_id);
    const report = generateWeeklyReport(f.db);
    assert.equal(report.feedback_count, 1);
    assert.equal(report.accuracy, 1);
    assert.equal(report.by_product_type.Cup.count, 1);
  } finally { f.close(); }
});

test('rejects a forged image with a valid-looking JPEG header', async () => {
  const f = fixture();
  try {
    const fake = Buffer.alloc(200, 0);
    fake.set([0xff, 0xd8, 0xff]);
    await assert.rejects(f.service.createDraft({ exterior_images: [photo(0), photo(1),
      { mime_type: 'image/jpeg', data_base64: fake.toString('base64') }] }),
    error => error instanceof ApiError && error.code === 'INVALID_IMAGE');
  } finally { f.close(); }
});

test('English and legacy feedback remain compatible with historical reports', async () => {
  const f = fixture();
  try {
    const draft = await f.service.createDraft({ exterior_images: [photo(0), photo(1), photo(2)] });
    await f.service.confirmDraft(draft.draft_id, { accept_description: true, accept_price: true });
    const cases = [
      ['best', 'suitable', 'suitable'], ['worst', 'unsuitable', 'unsuitable'],
      ['best', 'unsuitable', 'unsuitable'], ['worst', 'suitable', 'suitable'],
      ['best', '\u9002\u5408\u6211', 'suitable'],
      ['worst', '\u4e0d\u9002\u5408\u6211', 'unsuitable']
    ];
    const week = previousWeek();
    const createdAt = new Date(new Date(week.start).getTime() + 86400_000).toISOString();
    for (const [mode, result, expected] of cases) {
      const recommendation = await f.service.recommend('I like ceramics, am 26, and have a USD 20 budget.', mode);
      assert.equal(recommendation.feedback_prompt, 'Rate this recommendation: suitable / unsuitable');
      assert.throws(() => f.service.submitFeedback(recommendation.recommendation_id, recommendation.feedback_token, 'unknown'),
        error => error.code === 'INVALID_FEEDBACK');
      f.service.submitFeedback(recommendation.recommendation_id, recommendation.feedback_token, result);
      assert.equal(f.db.prepare('SELECT feedback FROM recommendations WHERE id=?').get(recommendation.recommendation_id).feedback, expected);
      // Simulate rows written by older versions without migrating private data.
      f.db.prepare('UPDATE recommendations SET created_at=?,feedback=? WHERE id=?')
        .run(createdAt, result, recommendation.recommendation_id);
    }
    const report = generateWeeklyReport(f.db);
    assert.equal(report.feedback_count, 6);
    assert.equal(report.correct_count, 4);
    assert.equal(report.accuracy, 0.6667);
    assert.deepEqual(report.by_mode, { best: { count: 3, correct: 2 }, worst: { count: 3, correct: 2 } });
  } finally { f.close(); }
});

test('concurrent confirmations consume a draft only once', async () => {
  const f = fixture();
  try {
    const draft = await f.service.createDraft({ exterior_images: [photo(0), photo(1), photo(2)] });
    f.ai.matchDescription = async () => { await new Promise(resolve => setImmediate(resolve)); return { matches: true }; };
    const attempts = await Promise.allSettled([f.service.confirmDraft(draft.draft_id,
      { accept_description: false, description: 'Ceramic cup', accept_price: true }),
    f.service.confirmDraft(draft.draft_id,
      { accept_description: false, description: 'Ceramic cup', accept_price: true })]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.code === 'DRAFT_ALREADY_CONFIRMED').length, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM products').get().n, 1);
  } finally { f.close(); }
});

test('individual client keys can be revoked and have a daily quota', () => {
  const f = fixture();
  try {
    bootstrapLegacyClient(f.db, 'legacy-secret-12345678901234567890');
    const { id, key } = createClient(f.db, 'AI client A');
    assert.equal(authenticateClient(f.db, `Bearer ${key}`), id);
    const limit = clientLimiter(f.db, { uploadsPerDay: 1, recommendationsPerDay: 1, agentRequestsPerMinute: 10 });
    limit(id, 'upload');
    assert.throws(() => limit(id, 'upload'), error => error.code === 'DAILY_LIMIT');
    limit(id, 'recommendation');
    assert.throws(() => limit(id, 'recommendation'), error => error.code === 'DAILY_LIMIT');
    assert.equal(setClientEnabled(f.db, id, false), true);
    assert.equal(authenticateClient(f.db, `Bearer ${key}`), null);
  } finally { f.close(); }
});

test('rejects edited metadata with code 114 and missing dimensions with code 66', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.createDraft({ exterior_images: Array.from({ length: 6 }, (_, i) => photo(i, i === 2)) }),
      error => error instanceof ApiError && error.code === 114);
    f.ai.extractProfile = async () => ({ likes: ['ceramic'], age: 26 });
    await assert.rejects(f.service.recommend('I like ceramics and am 26.', 'worst'),
      error => error instanceof ApiError && error.code === 66);
  } finally { f.close(); }
});

test('accepts three exterior photos and rejects fewer or duplicate photos', async () => {
  const f = fixture();
  try {
    const draft = await f.service.createDraft({ exterior_images: [photo(0), photo(1), photo(2)] });
    assert.equal(draft.status, 'awaiting_confirmation');
    await assert.rejects(f.service.createDraft({ exterior_images: [photo(0), photo(1)] }),
      error => error instanceof ApiError && error.code === 'IMAGE_COUNT');
    await assert.rejects(f.service.createDraft({ exterior_images: [photo(0), photo(1), photo(0)] }),
      error => error instanceof ApiError && error.code === 'DUPLICATE_IMAGE');
    f.ai.analyzeProduct = async () => ({ edited: false, distinct_exterior_views: false });
    await assert.rejects(f.service.createDraft({ exterior_images: [photo(3), photo(4), photo(5)] }),
      error => error instanceof ApiError && error.code === 'INSUFFICIENT_VIEWS');
  } finally { f.close(); }
});

test('rejects an inconsistent seller description before saving a product', async () => {
  const f = fixture();
  try {
    f.ai.analyzeProduct = async () => ({ edited: false, distinct_exterior_views: true, description_matches: false });
    await assert.rejects(f.service.createDraft({ exterior_images: Array.from({ length: 6 }, (_, i) => photo(i)), description: 'Red leather shoes', price_usd: 50 }),
      error => error instanceof ApiError && error.code === 'DESCRIPTION_MISMATCH');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM products').get().n, 0);
  } finally { f.close(); }
});

test('checks photos beyond the first eight before accepting a draft', async () => {
  const f = fixture();
  try {
    let checked = 0;
    f.ai.checkImages = async images => { checked += images.length; return { edited: true }; };
    await assert.rejects(f.service.createDraft({ exterior_images: Array.from({ length: 10 }, (_, i) => photo(i)) }),
      error => error instanceof ApiError && error.code === 114);
    assert.equal(checked, 2);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM drafts').get().n, 0);
  } finally { f.close(); }
});

test('four HTTP ports enforce separate agent and owner keys', async () => {
  const f = fixture();
  const config = { agentKey: 'agent-secret-12345678901234567890', ownerKey: 'owner-secret-12345678901234567890' };
  const servers = createServers(config, f.db, f.service);
  try {
    await Promise.all(Object.values(servers).map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
    const url = name => `http://127.0.0.1:${servers[name].address().port}`;
    const unauthorized = await fetch(`${url('upload')}/products/drafts`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.message, 'A valid access token is required');
    const ownerOnAgent = await fetch(`${url('best')}/recommendations`, { method: 'POST', headers: { Authorization: `Bearer ${config.ownerKey}` } });
    assert.equal(ownerOnAgent.status, 401);
    const agentOnOwner = await fetch(`${url('report')}/reports/latest`, { headers: { Authorization: `Bearer ${config.agentKey}` } });
    assert.equal(agentOnOwner.status, 401);
    const validOwner = await fetch(`${url('report')}/reports/run`, { method: 'POST', headers: { Authorization: `Bearer ${config.ownerKey}` } });
    assert.equal(validOwner.status, 200);
  } finally {
    await Promise.all(Object.values(servers).map(server => new Promise(resolve => server.close(resolve))));
    f.close();
  }
});

test('weekly report uses the previous Monday in Shanghai as its label', () => {
  const week = previousWeek(new Date('2026-10-01T14:00:00.000Z'));
  assert.equal(week.week, '2026-09-21');
  assert.equal(week.start, '2026-09-20T16:00:00.000Z');
  assert.equal(week.end, '2026-09-27T16:00:00.000Z');
});

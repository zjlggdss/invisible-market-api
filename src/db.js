import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dataDir, 'images'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'market.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      exterior_json TEXT NOT NULL, interior_json TEXT NOT NULL,
      description TEXT, price_usd REAL, proposal_description TEXT,
      proposal_price_usd REAL, cavity INTEGER NOT NULL, tags_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, description TEXT NOT NULL,
      price_usd REAL NOT NULL, image_files_json TEXT NOT NULL,
      tags_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
      mode TEXT NOT NULL, profile_json TEXT NOT NULL, score REAL NOT NULL,
      feedback_token_hash TEXT NOT NULL, feedback TEXT, feedback_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reports (
      week TEXT PRIMARY KEY, created_at TEXT NOT NULL, report_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_clients (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_usage (
      client_id TEXT NOT NULL REFERENCES api_clients(id), day TEXT NOT NULL,
      uploads INTEGER NOT NULL DEFAULT 0, recommendations INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_recommendations_created_at ON recommendations(created_at);
    CREATE INDEX IF NOT EXISTS idx_recommendations_product_id ON recommendations(product_id);`);
  // Older versions stored the full extracted profile. Retain only the two
  // diagnostic signals used by weekly reports, including for existing rows.
  const rows = db.prepare('SELECT recommendations.id,profile_json,price_usd FROM recommendations LEFT JOIN products ON products.id=recommendations.product_id')
    .all();
  const update = db.prepare('UPDATE recommendations SET profile_json=? WHERE id=?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      let profile;
      try { profile = JSON.parse(row.profile_json); } catch { profile = {}; }
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) profile = {};
      if (Object.keys(profile).every(key => ['has_preferences', 'budget_exceeded'].includes(key))) continue;
      update.run(JSON.stringify({
        has_preferences: Boolean(profile.likes?.length || profile.dislikes?.length),
        budget_exceeded: typeof profile.budget_usd === 'number' && row.price_usd > profile.budget_usd
      }), row.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return db;
}

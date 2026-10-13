import path from 'node:path';
import { openDatabase } from '../../src/db.js';

// Historical maintenance helper for pre-minimization backups. Opening the
// database runs its migrations; this is not a generic restore or export tool.
const directory = path.resolve(process.argv[2] || '');
if (!directory.startsWith('/root/invisible-market-backups/') || !directory.endsWith('/app/data')) {
  throw new Error('Expected a data directory inside /root/invisible-market-backups');
}
const db = openDatabase(directory);
try {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup database is corrupt');
  const sensitiveRows = db.prepare(`SELECT COUNT(*) AS count FROM recommendations
    WHERE profile_json LIKE '%ethnicity%' OR profile_json LIKE '%income_usd_monthly%'`).get().count;
  if (sensitiveRows !== 0) throw new Error('Backup still contains extracted profiles');
  console.log(`Sanitized backup: ${path.basename(path.dirname(path.dirname(directory)))}`);
} finally { db.close(); }

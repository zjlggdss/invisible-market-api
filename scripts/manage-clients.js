import { configFromEnv } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createClient, setClientEnabled } from '../src/clients.js';

const [command, value] = process.argv.slice(2);
if (!['create', 'list', 'disable', 'enable'].includes(command)) {
  console.error('Usage: node --env-file=.env scripts/manage-clients.js create <label>|list|disable <id>|enable <id>');
  process.exit(2);
}
const db = openDatabase(configFromEnv().dataDir);
try {
  if (command === 'create') {
    const { id, key } = createClient(db, value);
    console.log(JSON.stringify({ id, key, note: 'Save this key now; it will not be shown again.' }));
  } else if (command === 'list') {
    console.log(JSON.stringify(db.prepare('SELECT id,label,enabled,created_at FROM api_clients ORDER BY created_at').all()));
  } else {
    if (!value || !setClientEnabled(db, value, command === 'enable')) throw new Error('Client ID not found');
    console.log('Updated');
  }
} finally { db.close(); }

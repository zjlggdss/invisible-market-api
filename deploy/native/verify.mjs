import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = process.env.DATA_DIR || '/opt/invisible-market/data';
const db = new DatabaseSync(path.join(dataDir, 'market.sqlite'), { readOnly: true });
const products = db.prepare('SELECT image_files_json FROM products').all();
const missingImages = products.flatMap(product => JSON.parse(product.image_files_json))
  .filter(file => !fs.existsSync(path.join(dataDir, 'images', file.name))).length;
db.close();

if (missingImages) throw new Error(`${missingImages} product images are missing`);
console.log(`products=${products.length} missing_images=${missingImages}`);

for (const port of [4101, 4102, 4103, 4104]) {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  if (response.status !== 401) throw new Error(`Port ${port}: expected 401, got ${response.status}`);
  console.log(`port=${port} unauthorized_status=${response.status}`);
}

const agent = await fetch('http://127.0.0.1:4101/unknown', {
  headers: { Authorization: `Bearer ${process.env.AGENT_API_KEY}` }
});
if (agent.status !== 404) throw new Error(`Agent auth failed: ${agent.status}`);
console.log('agent_auth=ok');

const owner = await fetch('http://127.0.0.1:4104/reports/latest', {
  headers: { Authorization: `Bearer ${process.env.OWNER_API_KEY}` }
});
if (![200, 404].includes(owner.status)) throw new Error(`Owner auth failed: ${owner.status}`);
console.log(`owner_auth=ok latest_report_status=${owner.status}`);

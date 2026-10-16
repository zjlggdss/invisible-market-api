import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configFromEnv } from '../../src/config.js';
import { createAI } from '../../src/ai.js';

const config = configFromEnv();
const ai = createAI(config);
const profile = await ai.extractProfile('I am 30 years old, live in China, and like sesame paste-flavored snacks.');
if (profile.age !== 30 || !Array.isArray(profile.likes)) {
  throw new Error('Text model response has an unexpected shape');
}
console.log('text_model=ok');

const db = new DatabaseSync(path.join(config.dataDir, 'market.sqlite'), { readOnly: true });
const product = db.prepare('SELECT image_files_json FROM products LIMIT 1').get();
db.close();
if (!product) throw new Error('No product image available for vision check');
const file = JSON.parse(product.image_files_json)[0];
const data = fs.readFileSync(path.join(config.dataDir, 'images', file.name)).toString('base64');
const inspection = await ai.checkImages([{ mime_type: file.mime_type, data_base64: data }]);
if (typeof inspection.edited !== 'boolean') {
  throw new Error('Vision model response has an unexpected shape');
}
console.log('vision_model=ok');

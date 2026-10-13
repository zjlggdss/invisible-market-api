import fs from 'node:fs';
import path from 'node:path';
import { configFromEnv, assertProductionConfig } from '../src/config.js';

const paths = process.argv.slice(2);
if (paths.length < 3 || paths.length > 12) {
  console.error('用法：node --env-file=.env scripts/upload-photos.js <图片1> <图片2> <图片3> [更多图片]');
  process.exit(2);
}
const mime = extension => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[extension];
const exterior_images = paths.map(file => {
  const mime_type = mime(path.extname(file).toLowerCase());
  if (!mime_type) throw new Error(`不支持的图片格式：${file}`);
  return { mime_type, data_base64: fs.readFileSync(file).toString('base64') };
});
const config = configFromEnv();
assertProductionConfig(config);
const response = await fetch(`http://${config.host}:${config.ports.upload}/products/drafts`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${config.agentKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ exterior_images })
});
console.log(JSON.stringify({ http_status: response.status, response: await response.json() }, null, 2));
if (!response.ok) process.exitCode = 1;

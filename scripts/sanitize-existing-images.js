import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const imageDir = path.join(dataDir, 'images');
const db = new DatabaseSync(path.join(dataDir, 'market.sqlite'));
const names = new Set();
for (const product of db.prepare('SELECT image_files_json FROM products').all()) {
  for (const file of JSON.parse(product.image_files_json)) {
    if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(file.name)) throw new Error('Unexpected image filename');
    names.add(file.name);
  }
}
db.close();

let sanitized = 0;
for (const name of names) {
  const filePath = path.join(imageDir, name);
  const source = fs.readFileSync(filePath);
  const options = { failOn: 'error', limitInputPixels: 24_000_000, autoOrient: true };
  const meta = await sharp(source, options).metadata();
  if (!meta.width || !meta.height || meta.width * meta.height > 24_000_000 || (meta.pages || 1) !== 1) {
    throw new Error('Unexpected image size or animation');
  }
  const output = sharp(source, options);
  const clean = name.endsWith('.jpg') ? await output.jpeg({ quality: 85 }).toBuffer() :
    name.endsWith('.png') ? await output.png({ compressionLevel: 9 }).toBuffer() :
    await output.webp({ quality: 85 }).toBuffer();
  const checked = await sharp(clean).metadata();
  if (checked.exif || checked.xmp || checked.iptc) throw new Error('Metadata remained after re-encoding');
  const temporary = `${filePath}.cleaning`;
  try {
    fs.writeFileSync(temporary, clean, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  sanitized++;
}
console.log(JSON.stringify({ imagesSanitized: sanitized }));

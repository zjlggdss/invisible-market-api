import { deflateSync } from 'node:zlib';
import { createAI } from '../src/ai.js';
import { configFromEnv, assertProductionConfig } from '../src/config.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function testPng() {
  const width = 128, height = 128;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * (1 + width * 3) + 1 + x * 3;
      pixels[index] = 220; pixels[index + 1] = 230; pixels[index + 2] = 240;
      if (x > 40 && x < 88 && y > 30 && y < 105) {
        pixels[index] = 45; pixels[index + 1] = 105; pixels[index + 2] = 180;
      }
    }
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const config = configFromEnv();
assertProductionConfig(config);
try {
  const result = await createAI(config).checkImages([{ mime_type: 'image/png', data_base64: testPng().toString('base64') }]);
  console.log(JSON.stringify({ vision_api_reachable: true, returned_boolean: typeof result?.edited === 'boolean' }));
  if (typeof result?.edited !== 'boolean') process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ vision_api_reachable: false, error: error.message }));
  process.exitCode = 1;
}

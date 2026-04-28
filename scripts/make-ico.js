/*
 * Copyright 2025 Loney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 将 PNG 转换为多尺寸 ICO 文件
 * 包含 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '../icon/logo.png');
const OUTPUT = path.join(__dirname, '../build/icon.ico');

const SIZES = [16, 32, 48, 64, 128, 256];

async function makePngBuffer(size) {
  return sharp(INPUT)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function buildIco() {
  const images = await Promise.all(SIZES.map(s => makePngBuffer(s)));

  // ICO 文件格式：header + directory + image data
  const HEADER_SIZE = 6;
  const DIR_ENTRY_SIZE = 16;
  const dirSize = SIZES.length * DIR_ENTRY_SIZE;
  const headerTotal = HEADER_SIZE + dirSize;

  // 计算每张图片的偏移
  const offsets = [];
  let offset = headerTotal;
  for (const buf of images) {
    offsets.push(offset);
    offset += buf.length;
  }

  const totalSize = offset;
  const ico = Buffer.alloc(totalSize);

  // ICO Header
  ico.writeUInt16LE(0, 0);       // Reserved
  ico.writeUInt16LE(1, 2);       // Type: 1 = ICO
  ico.writeUInt16LE(SIZES.length, 4); // Image count

  // Directory entries
  for (let i = 0; i < SIZES.length; i++) {
    const s = SIZES[i];
    const base = HEADER_SIZE + i * DIR_ENTRY_SIZE;
    ico.writeUInt8(s === 256 ? 0 : s, base);     // Width (0 = 256)
    ico.writeUInt8(s === 256 ? 0 : s, base + 1); // Height
    ico.writeUInt8(0, base + 2);   // Color count
    ico.writeUInt8(0, base + 3);   // Reserved
    ico.writeUInt16LE(1, base + 4); // Planes
    ico.writeUInt16LE(32, base + 6); // Bit count
    ico.writeUInt32LE(images[i].length, base + 8);  // Size
    ico.writeUInt32LE(offsets[i], base + 12);        // Offset
  }

  // Image data
  for (let i = 0; i < images.length; i++) {
    images[i].copy(ico, offsets[i]);
  }

  fs.writeFileSync(OUTPUT, ico);
  console.log(`icon.ico created: ${OUTPUT} (${(totalSize / 1024).toFixed(1)} KB)`);
}

buildIco().catch(e => { console.error(e); process.exit(1); });

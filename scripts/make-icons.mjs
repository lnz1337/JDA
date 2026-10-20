/**
 * Gera os ícones placeholder do PWA (fundo noite + cruz dourada) sem depender
 * de biblioteca de imagem. Substituir quando a identidade visual estiver
 * definida (CLAUDE.md §17): `node scripts/make-icons.mjs`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BG = [0x1e, 0x1b, 0x4b];
const FG = [0xd4, 0xaf, 0x37];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Cruz centrada, reduzida por `scale` (maskable precisa de safe zone). */
function paint(x, y, size, scale) {
  const nx = (x / size - 0.5) / scale + 0.5;
  const ny = (y / size - 0.5) / scale + 0.5;
  const vertical = nx > 0.455 && nx < 0.545 && ny > 0.14 && ny < 0.86;
  const horizontal = ny > 0.33 && ny < 0.42 && nx > 0.29 && nx < 0.71;
  return vertical || horizontal ? FG : BG;
}

function png(size, scale) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filtro "none"
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y, size, scale);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, 0.82],
  ['icon-512.png', 512, 0.82],
  ['icon-512-maskable.png', 512, 0.6],
];

for (const [file, size, scale] of targets) {
  writeFileSync(resolve(outDir, file), png(size, scale));
  console.log(`${file} (${size}x${size})`);
}

'use strict';
// Dev tool: draws the 128x128 Marketplace icon (32x32 pixel art scaled 4x) and writes media/icon.png.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 32;
const SCALE = 4;
const px = Array.from({ length: N }, () => Array(N).fill(null));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const C = {
  bg: hex('#1d1f2b'), bg2: hex('#262a3b'), white: hex('#f6f6f2'), shade: hex('#c8ccd8'), orange: hex('#f08a24'),
  purple: hex('#8a5cf6'), skin: hex('#f2c29b'), skinS: hex('#d39871'), dark: hex('#1b1b24'), cheek: hex('#f0a08a'),
  flame1: hex('#ffdd57'), flame2: hex('#ff9f1c'), flame3: hex('#ff5e1c'),
};

function rect(x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < N && y < N) px[y][x] = c;
}
function disc(cx, cy, r, c) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) px[y][x] = c;
}

// Background tile with rounded corners.
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = Math.max(0, Math.abs(x + 0.5 - 16) - 12);
    const dy = Math.max(0, Math.abs(y + 0.5 - 16) - 12);
    if (dx * dx + dy * dy <= 16) px[y][x] = (x + y) % 2 ? C.bg : C.bg2;
  }
}
const fg = [];
const paint = (fn) => { const before = px.map((r) => r.slice()); fn(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[y][x] !== before[y][x]) fg.push([x, y]); };

paint(() => {
  // Jacket
  rect(7, 23, 24, 31, C.white);
  rect(6, 25, 25, 31, C.white);
  rect(15, 24, 16, 24, C.dark); rect(15, 27, 16, 27, C.dark); rect(15, 30, 16, 30, C.dark);
  rect(7, 29, 8, 31, C.shade); rect(23, 29, 24, 31, C.shade);
  // Neck and face
  rect(13, 21, 18, 22, C.skinS);
  rect(10, 13, 21, 20, C.skin);
  rect(11, 21, 20, 21, C.skin);
  rect(12, 15, 13, 16, C.dark); rect(18, 15, 19, 16, C.dark);
  rect(11, 18, 12, 18, C.cheek); rect(19, 18, 20, 18, C.cheek);
  rect(14, 19, 17, 19, C.dark); rect(13, 18, 13, 18, C.dark); rect(18, 18, 18, 18, C.dark);
  // Toque with a two-source band
  disc(12, 6, 4, C.white); disc(16, 4.5, 4.5, C.white); disc(20, 6, 4, C.white);
  rect(10, 6, 21, 10, C.white);
  rect(13, 4, 13, 5, C.shade); rect(19, 6, 19, 8, C.shade);
  rect(10, 11, 15, 12, C.orange);
  rect(16, 11, 21, 12, C.purple);
  // Little flame on the jacket pocket
  rect(20, 27, 22, 29, C.flame2); rect(21, 26, 21, 26, C.flame1); rect(21, 28, 21, 29, C.flame1); rect(20, 29, 22, 29, C.flame3);
});

// Dark outline around the character.
const isFg = new Set(fg.map(([x, y]) => y * N + x));
for (const [x, y] of fg) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || isFg.has(ny * N + nx) || !px[ny][nx]) continue;
    px[ny][nx] = C.dark;
  }
}

const size = N * SCALE;
const raw = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) {
  raw[y * (size * 4 + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const c = px[Math.floor(y / SCALE)][Math.floor(x / SCALE)] || [0, 0, 0, 0];
    raw.set(c, y * (size * 4 + 1) + 1 + x * 4);
  }
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'media', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);

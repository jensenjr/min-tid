// Generates public/apple-touch-icon.png (180×180) without any native image deps.
// Run once when the icon design changes: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const SIZE = 180;
const BG = [255, 95, 0]; // pc-orange
const FG = [255, 255, 255];

const px = new Uint8Array(SIZE * SIZE * 3);
const cx = SIZE / 2, cy = SIZE / 2;

function put(x, y, [r, g, b]) {
  const i = (y * SIZE + x) * 3;
  px[i] = r; px[i + 1] = g; px[i + 2] = b;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    put(x, y, BG);
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    // clock ring
    if (d >= 52 && d <= 62) put(x, y, FG);
    // minute hand: straight up from center
    if (Math.abs(dx) <= 5 && dy <= 4 && dy >= -40) put(x, y, FG);
    // hour hand: to the right
    if (Math.abs(dy) <= 5 && dx >= -4 && dx <= 28) put(x, y, FG);
  }
}

// raw scanlines, filter byte 0 per row
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 3 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 3, SIZE * 3).copy(raw, y * (SIZE * 3 + 1) + 1);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(new URL("../public", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/apple-touch-icon.png", import.meta.url), png);
console.log(`Wrote public/apple-touch-icon.png (${png.length} bytes)`);

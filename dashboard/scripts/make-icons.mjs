// Generates the PWA icons ("RT" monogram on the accent color) as PNGs using only Node built-ins.
// Run: npm run icons   (writes into public/)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ACCENT = [0x24, 0x50, 0xd6];
const ON_ACCENT = [0xfc, 0xfc, 0xfd];
const OUT = fileURLToPath(new URL("../public/", import.meta.url));

// ---- glyph geometry in a 100 x 100 design space, centered on (50, 50) ----
const W = 9; // stroke width
const inRect = (x, y, x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function inGlyph(x, y) {
  // R
  if (inRect(x, y, 20, 29, 30, 70)) return true; // stem
  if (inRect(x, y, 20, 36, 30, 39)) return true; // bowl top
  if (inRect(x, y, 20, 36, 47, 56)) return true; // bowl bottom
  if (x >= 36) {
    const r = Math.hypot(x - 36, y - 43);
    if (r <= 13 && r >= 4) return true; // bowl curve
  }
  if (y >= 51 && y <= 70 && distToSegment(x, y, 33, 51, 45.5, 70) <= W / 2) return true; // leg
  // T
  if (inRect(x, y, 52, 80, 30, 39)) return true; // bar
  if (inRect(x, y, 61.5, 70.5, 30, 70)) return true; // stem
  return false;
}

function render(size, { glyphScale, cornerRadius }) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  const rad = cornerRadius * size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bgHits = 0, fgHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = i + (sx + 0.5) / SS, y = j + (sy + 0.5) / SS;
          // rounded-square mask
          if (rad > 0) {
            const cx = Math.min(Math.max(x, rad), size - rad), cy = Math.min(Math.max(y, rad), size - rad);
            if (Math.hypot(x - cx, y - cy) > rad) continue;
          }
          bgHits++;
          const gx = 50 + ((x / size) * 100 - 50) / glyphScale;
          const gy = 50 + ((y / size) * 100 - 50) / glyphScale;
          if (inGlyph(gx, gy)) fgHits++;
        }
      }
      const total = SS * SS;
      const o = (j * size + i) * 4;
      const f = bgHits ? fgHits / bgHits : 0;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(ACCENT[c] * (1 - f) + ON_ACCENT[c] * f);
      px[o + 3] = Math.round((bgHits / total) * 255);
    }
  }
  return encodePng(size, size, px);
}

// ---- minimal PNG encoder (RGBA, 8 bit) ----
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
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
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  ["icon-192.png", 192, { glyphScale: 1, cornerRadius: 0.2 }],
  ["icon-512.png", 512, { glyphScale: 1, cornerRadius: 0.2 }],
  ["icon-maskable-512.png", 512, { glyphScale: 0.8, cornerRadius: 0 }],
  ["apple-touch-icon.png", 180, { glyphScale: 0.95, cornerRadius: 0 }],
  ["favicon-64.png", 64, { glyphScale: 1.15, cornerRadius: 0.2 }],
];
for (const [name, size, opts] of icons) {
  writeFileSync(OUT + name, render(size, opts));
  console.log("wrote", name);
}

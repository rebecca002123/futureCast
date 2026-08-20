// Draws the app icon (a hurricane swirl over the North Atlantic) into a raw
// RGB buffer and writes it out as a PNG with Node's zlib — no image deps.
import zlib from 'zlib';
import fs from 'fs';

const S = 1024;
const buf = new Float64Array(S * S * 3);

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function put(x, y, [r, g, b], alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 3;
  buf[i] = mix(buf[i], r, alpha);
  buf[i + 1] = mix(buf[i + 1], g, alpha);
  buf[i + 2] = mix(buf[i + 2], b, alpha);
}

// Background: deep ocean-night gradient.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = clamp01((x / S) * 0.45 + (y / S) * 0.55);
    const col = [mix(11, 26, t), mix(26, 58, t), mix(48, 92, t)];
    const i = (y * S + x) * 3;
    buf[i] = col[0];
    buf[i + 1] = col[1];
    buf[i + 2] = col[2];
  }
}

const cx = S / 2;
const cy = S / 2;

// Four logarithmic spiral bands sweeping into the eye, drawn as fat
// anti-aliased strokes with a soft glow.
const ARMS = 4;
const A = 26;      // spiral tightness
const B = 0.30;
const CLOUD = [236, 248, 255];
const GLOW = [120, 200, 255];

for (let arm = 0; arm < ARMS; arm++) {
  const phase = (arm / ARMS) * Math.PI * 2;
  for (let t = 0; t < 2400; t++) {
    const th = (t / 2400) * (Math.PI * 3.15);
    const r = A * Math.exp(B * th);
    if (r > 430) break;
    const ang = th + phase;
    const px = cx + r * Math.cos(ang);
    const py = cy + r * Math.sin(ang);
    // Arms thicken and fade towards the outside.
    const width = 9 + (r / 430) * 40;
    const strength = clamp01(1.05 - (r / 430) * 0.45) * clamp01(r / 55);
    const R = Math.ceil(width);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > width) continue;
        // A hard core with a thin feathered edge keeps the arms crisp at
        // icon size instead of smearing into fog.
        const edge = clamp01((width - d) / Math.max(6, width * 0.28));
        put(Math.round(px + dx), Math.round(py + dy), CLOUD, Math.pow(edge, 0.6) * 0.22 * strength);
        put(Math.round(px + dx), Math.round(py + dy), GLOW, edge * 0.025 * strength);
      }
    }
  }
}

// The eye: a dark centre ringed by the brightest cloud.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < 96) {
      const ring = clamp01((d - 44) / 34);
      put(x, y, [8, 20, 38], clamp01((96 - d) / 26) * (1 - ring * 0.35));
      if (d > 52 && d < 92) put(x, y, CLOUD, clamp01(1 - Math.abs(d - 72) / 22) * 0.85);
    }
  }
}

// Vignette, so the swirl sits on the tile rather than floating.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - cx, y - cy) / (S / 2);
    if (d > 0.72) put(x, y, [6, 14, 28], clamp01((d - 0.72) / 0.5) * 0.5);
  }
}

// --- PNG encode (8-bit RGB, filter type 0 per scanline) ---
const raw = Buffer.alloc(S * (S * 3 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 3 + 1)] = 0;
  for (let x = 0; x < S * 3; x++) {
    raw[y * (S * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(buf[y * S * 3 + x])));
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE = null;
function crc32(b) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(process.argv[2], png);
console.log('wrote', process.argv[2], (png.length / 1024).toFixed(0) + ' KB');

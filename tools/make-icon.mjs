// Draws the app icon — a coin with clock ticks and a pound sign — into a raw
// RGB buffer and writes it out as a PNG with Node's zlib, no image deps.
//   node tools/make-icon.mjs assets/icon.png
import zlib from 'zlib';
import fs from 'fs';

const S = 1024;
const buf = new Float64Array(S * S * 3);

const MINT = [61, 220, 151];
const MINT_DEEP = [26, 168, 116];
const INK = [10, 17, 22];

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function put(x, y, colour, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 3;
  const a = clamp01(alpha);
  buf[i] = mix(buf[i], colour[0], a);
  buf[i + 1] = mix(buf[i + 1], colour[1], a);
  buf[i + 2] = mix(buf[i + 2], colour[2], a);
}

// A round brush with a one-pixel feathered edge: crisp at icon size, no
// staircase on the curves.
function stamp(x, y, radius, colour, alpha = 1) {
  const r = Math.ceil(radius + 1);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > radius + 1) continue;
      put(Math.round(x) + dx, Math.round(y) + dy, colour, clamp01(radius + 0.5 - d) * alpha);
    }
  }
}

function line(x0, y0, x1, y1, width, colour) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stamp(mix(x0, x1, t), mix(y0, y1, t), width / 2, colour);
  }
}

function arc(cx, cy, radius, from, to, width, colour) {
  const steps = Math.ceil(Math.abs(to - from) * radius * 2);
  for (let i = 0; i <= steps; i++) {
    const angle = mix(from, to, i / steps);
    stamp(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), width / 2, colour);
  }
}

function disc(cx, cy, radius, colour) {
  for (let y = Math.floor(cy - radius - 1); y <= cy + radius + 1; y++) {
    for (let x = Math.floor(cx - radius - 1); x <= cx + radius + 1; x++) {
      put(x, y, colour, clamp01(radius + 0.5 - Math.hypot(x - cx, y - cy)));
    }
  }
}

// Background: near-black with a green cast towards the bottom right, so the
// coin has something to sit on without a hard edge.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = clamp01((x / S) * 0.4 + (y / S) * 0.6);
    const i = (y * S + x) * 3;
    buf[i] = mix(14, 12, t);
    buf[i + 1] = mix(17, 38, t);
    buf[i + 2] = mix(22, 30, t);
  }
}

const cx = S / 2;
const cy = S / 2;

// The coin, with a slightly deeper rim so it reads as a disc rather than a
// flat circle.
disc(cx, cy, 372, MINT_DEEP);
disc(cx, cy, 352, MINT);

// Clock ticks around the rim: this is a coin that measures time.
for (let hour = 0; hour < 12; hour++) {
  const angle = (hour / 12) * Math.PI * 2 - Math.PI / 2;
  const long = hour % 3 === 0;
  const inner = long ? 268 : 288;
  line(
    cx + inner * Math.cos(angle),
    cy + inner * Math.sin(angle),
    cx + 318 * Math.cos(angle),
    cy + 318 * Math.sin(angle),
    long ? 26 : 16,
    INK,
  );
}

// A pound sign, drawn from the four strokes it's actually made of: the top
// bowl, the stem, the crossbar and the base.
const stem = 36;
arc(cx + 2, cy - 62, 85, Math.PI * 0.18, -Math.PI * 1.18, stem, INK); // top bowl
line(cx - 83, cy - 62, cx - 83, cy + 96, stem, INK); // stem
line(cx - 118, cy + 20, cx + 42, cy + 20, 28, INK); // crossbar
line(cx - 118, cy + 96, cx + 117, cy + 96, stem, INK); // base

// --- PNG encode (8-bit RGB, filter type 0 per scanline) ---
const raw = Buffer.alloc(S * (S * 3 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 3 + 1)] = 0;
  for (let x = 0; x < S * 3; x++) {
    raw[y * (S * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(buf[y * S * 3 + x])));
  }
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 2;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2] || 'assets/icon.png';
fs.writeFileSync(out, png);
console.log('wrote', out, `${(png.length / 1024).toFixed(0)} KB`);

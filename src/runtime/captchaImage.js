// src/runtime/captchaImage.js
// Reiner JS-CAPTCHA-Generator – keine nativen Abhängigkeiten.
// 5x7-Bitmap-Font → PNG-Encoding über node:zlib. Wellen-Verzerrung,
// Zeichen-Scherung, Rauschpixel und Linien machen das Bild für einfache
// Bot-/OCR-Automatisierung schwer lesbar.
import zlib from 'node:zlib';

// Zeichensatz ohne mehrdeutige Zeichen (0/O, 1/I/l) – für Menschen und OCR gleichermaßen.
const CHARSET = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randomPick = (list) => list[Math.floor(Math.random() * list.length)];

// --- 5x7-Bitmap-Font (jedes Zeichen = 7 Zeilen à 5 Pixel) ---
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};

// --- PNG-Encoder (reines JS, Kompression via node:zlib) ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
};

const encodePng = (width, height, rgba) => {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bit-Tiefe
  ihdr[9] = 6;  // Farbtyp: RGBA
  ihdr[10] = 0; // Kompression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // kein Interlacing
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // Filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
};

// --- Rendering-Parameter ---
const SCALE = 6;          // ein Font-Pixel = 6×6 Bildpixel
const GLYPH_W = 5;
const GLYPH_H = 7;
const CHAR_W = GLYPH_W * SCALE; // 30
const CHAR_H = GLYPH_H * SCALE; // 42
const GAP = 9;
const PAD = 22;

const BACKGROUNDS = [
  [0xF4, 0xF1, 0xE6], [0xE9, 0xF3, 0xF0], [0xEF, 0xED, 0xF6], [0xF6, 0xEF, 0xE9], [0xE9, 0xF1, 0xF9]
];
const TEXT_COLORS = [
  [0x1F, 0x2D, 0x3D], [0x7A, 0x1F, 0x2B], [0x14, 0x4B, 0x3E], [0x4A, 0x21, 0x1E],
  [0x1E, 0x3A, 0x5F], [0x5A, 0x2A, 0x00], [0x2C, 0x2C, 0x2C], [0x5B, 0x1E, 0x4A]
];

const drawLine = (x0, y0, x1, y1, plot) => {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    plot(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
};

const renderCaptcha = (text) => {
  const chars = String(text || '').toUpperCase().split('');
  const width = PAD * 2 + chars.length * CHAR_W + Math.max(0, chars.length - 1) * GAP;
  const height = PAD * 2 + CHAR_H;
  const rgba = new Uint8Array(width * height * 4);
  const bg = randomPick(BACKGROUNDS);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255;
  }

  const setPx = (x, y, [r, g, b], alpha = 255) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 4;
    if (alpha >= 255) { rgba[index] = r; rgba[index + 1] = g; rgba[index + 2] = b; rgba[index + 3] = 255; return; }
    const a = alpha / 255;
    rgba[index] = Math.round(r * a + rgba[index] * (1 - a));
    rgba[index + 1] = Math.round(g * a + rgba[index + 1] * (1 - a));
    rgba[index + 2] = Math.round(b * a + rgba[index + 2] * (1 - a));
  };

  // Rauschpixel im Hintergrund
  const noiseCount = Math.floor(width * height * 0.015);
  for (let i = 0; i < noiseCount; i += 1) {
    setPx(randomInt(0, width - 1), randomInt(0, height - 1),
      Math.random() < 0.5 ? [0x9C, 0x9C, 0x9C] : [0xCF, 0xCF, 0xCF], randomInt(50, 150));
  }

  // Zeichen mit Scherung + vertikalem Offset
  chars.forEach((char, index) => {
    const glyph = GLYPHS[char] || GLYPHS.A;
    const color = randomPick(TEXT_COLORS);
    const shear = Math.random() * 2.4 - 1.2;
    const yOff = randomInt(-2, 2);
    const xBase = PAD + index * (CHAR_W + GAP);
    for (let row = 0; row < GLYPH_H; row += 1) {
      const rowShift = Math.round(shear * (row - (GLYPH_H - 1) / 2));
      for (let col = 0; col < GLYPH_W; col += 1) {
        if (glyph[row][col] !== '1') continue;
        const x0 = xBase + col * SCALE + rowShift * SCALE * 0.5;
        const y0 = PAD + row * SCALE + yOff;
        for (let yy = 0; yy < SCALE; yy += 1) {
          for (let xx = 0; xx < SCALE; xx += 1) setPx(Math.round(x0) + xx, y0 + yy, color);
        }
      }
    }
  });

  // Störlinien über alles
  const lineCount = randomInt(2, 3);
  for (let l = 0; l < lineCount; l += 1) {
    const x1 = randomInt(0, width - 1);
    const y1 = randomInt(0, height - 1);
    const x2 = randomInt(0, width - 1);
    const y2 = randomInt(0, height - 1);
    const color = randomPick(TEXT_COLORS);
    drawLine(x1, y1, x2, y2, (x, y) => setPx(x, y, color, randomInt(90, 170)));
  }

  // Wellen-Verzerrung (verschiebt Zeilen sinusförmig)
  const phase = Math.random() * Math.PI * 2;
  const freq = 0.05 + Math.random() * 0.04;
  const amp = randomInt(2, 4);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shift = Math.round(amp * Math.sin(x * freq + phase));
      const srcY = Math.max(0, Math.min(height - 1, y + shift));
      const si = (srcY * width + x) * 4;
      const di = (y * width + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }

  return encodePng(width, height, out);
};

export const DEFAULT_LENGTH = 4;

/**
 * Erzeugt ein CAPTCHA: { text, buffer }.
 * - text: die erwartete Zeichenfolge (nur serverseitig verwenden!)
 * - buffer: PNG-Puffer, der als Bild an den Nutzer gesendet wird
 */
export const generateCaptcha = ({ length = DEFAULT_LENGTH } = {}) => {
  const count = Math.max(3, Math.min(6, Math.floor(Number(length) || DEFAULT_LENGTH)));
  const text = Array.from({ length: count }, () => randomPick(CHARSET)).join('');
  return { text, buffer: renderCaptcha(text) };
};

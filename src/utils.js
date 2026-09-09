'use strict';
/* أدوات مشتركة: تمثيل الصورة الأساسي، تحويلات لونية، ضغط RLE/ASCII85، عوامة نصفية... */

const sharp = require('sharp');

sharp.cache({ memory: 256 });
sharp.concurrency(Math.max(1, Math.min(4, require('os').cpus().length)));

/** الصورة الأساسية (canonical): RGBA 8-بت + بيانات عائمة خطية اختيارية لصور HDR */
function makeImage(width, height) {
  const n = width * height;
  return {
    width,
    height,
    rgba: new Uint8ClampedArray(n * 4),
    float: null, // {data: Float32Array(n*3) خطي [0..∞)}
    meta: {},
  };
}

/* ---------- جداول تحويل لوني sRGB <-> خطي ---------- */
const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(v) {
  const c = v <= 0 ? 0 : v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return c;
}

/** RGBA 8-بت -> عوامات خطية (3 قنوات) */
function rgbaToFloat(rgba, w, h) {
  const n = w * h;
  const out = new Float32Array(n * 3);
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
    out[q] = SRGB_TO_LIN[rgba[p]];
    out[q + 1] = SRGB_TO_LIN[rgba[p + 1]];
    out[q + 2] = SRGB_TO_LIN[rgba[p + 2]];
  }
  return out;
}

/** عوامات خطية -> RGBA 8-بت مع تعيين نغمي بسيط للقيم فوق 1 */
function floatToRgba(data, w, h) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
    for (let c = 0; c < 3; c++) {
      let v = data[q + c];
      if (!Number.isFinite(v) || v < 0) v = 0;
      if (v > 1) v = 1 - Math.exp(-v); // تعيين نغمي لطيف للقيم العالية
      out[p + c] = Math.round(linearToSrgb(v) * 255);
    }
    out[p + 3] = 255;
  }
  return out;
}

/* ---------- عوامة نصفية (IEEE 754 half) ---------- */
function halfToFloat(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  let x;
  if (e === 0) x = f * Math.pow(2, -24);
  else if (e === 31) x = f ? NaN : Infinity;
  else x = (1 + f / 1024) * Math.pow(2, e - 15);
  return s ? -x : x;
}
const HTF = new Float32Array(65536);
for (let i = 0; i < 65536; i++) HTF[i] = halfToFloat(i);
function halfToFloatFast(h) { return HTF[h >>> 0]; }

function floatToHalf(v) {
  if (Number.isNaN(v)) return 0x7e00;
  if (v === Infinity) return 0x7c00;
  if (v === -Infinity) return 0xfc00;
  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);
  f32[0] = v;
  const x = i32[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) return bits | 0x7c00;
  if (e < 113) { m |= 0x0800; bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1); return bits; }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
}

/* ---------- ASCII85 (لملفات EPS) ---------- */
function ascii85Encode(bytes) {
  let out = '';
  const n = bytes.length;
  let i = 0;
  const chunk = [0, 0, 0, 0];
  while (i < n) {
    let word = 0;
    let cnt = Math.min(4, n - i);
    for (let j = 0; j < 4; j++) chunk[j] = j < cnt ? bytes[i + j] : 0;
    word = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    const digits = [];
    for (let j = 0; j < 5; j++) { digits.unshift(word % 85); word = Math.floor(word / 85); }
    for (let j = 0; j <= cnt; j++) out += String.fromCharCode(digits[j] + 33);
    i += 4;
  }
  return out;
}

/* ---------- PackBits (PSD/TIFF/ICI) ---------- */
function packBits(src, off, len) {
  const out = [];
  let i = off;
  const end = off + len;
  while (i < end) {
    // بحث عن سلسلة متكررة
    let run = 1;
    while (i + run < end && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 3 || i + run === end) {
      out.push((257 - run) & 0xff, src[i]);
      i += run;
    } else {
      // سلسلة حرفية
      let lit = 1;
      while (i + lit < end && lit < 128 && (i + lit + 2 >= end || src[i + lit] !== src[i + lit + 1] || src[i + lit] !== src[i + lit + 2])) lit++;
      out.push(lit - 1);
      for (let j = 0; j < lit; j++) out.push(src[i + j]);
      i += lit;
    }
  }
  return Buffer.from(out);
}
function unpackBits(src, off, len, expectedLen) {
  const out = Buffer.alloc(expectedLen);
  let ip = off, op = 0;
  const end = off + len;
  while (ip < end && op < expectedLen) {
    const n = src.readInt8(ip); ip++;
    if (n >= 0) {
      const cnt = n + 1;
      src.copy(out, op, ip, ip + cnt);
      op += cnt; ip += cnt;
    } else if (n > -128) {
      const cnt = 1 - n;
      out.fill(src[ip], op, op + cnt); ip++;
      op += cnt;
    }
  }
  return out;
}

/* ---------- RLE بأسلوب PCX/TGA ---------- */
function rleEncodePCX(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const b = src[i];
    let run = 1;
    while (run < 63 && i + run < src.length && src[i + run] === b) run++;
    if (run > 1 || (b & 0xc0) === 0xc0) {
      out.push(0xc0 | run, b);
      i += run;
    } else { out.push(b); i++; }
  }
  return Buffer.from(out);
}
function rleDecodePCX(src, expectedLen) {
  const out = Buffer.alloc(expectedLen);
  let ip = 0, op = 0;
  while (op < expectedLen && ip < src.length) {
    let b = src[ip++];
    if ((b & 0xc0) === 0xc0) {
      const cnt = b & 0x3f;
      const v = src[ip++];
      out.fill(v, op, op + cnt);
      op += cnt;
    } else out[op++] = b;
  }
  return out;
}
function rleEncodeTGA(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run * 4 < n && run < 128 && src[i] === src[i + run * 4] && src[i + 1] === src[i + run * 4 + 1] && src[i + 2] === src[i + run * 4 + 2] && src[i + 3] === src[i + run * 4 + 3]) run++;
    if (run > 1) {
      out.push(0x80 | (run - 1));
      for (let c = 0; c < 4; c++) out.push(src[i + c]);
      i += run * 4;
    } else {
      let lit = 1;
      while (i + lit * 4 < n && lit < 128) {
        if (i + (lit + 1) * 4 < n && src[i + lit * 4] === src[i + (lit + 1) * 4] && src[i + lit * 4 + 1] === src[i + (lit + 1) * 4 + 1] && src[i + lit * 4 + 2] === src[i + (lit + 1) * 4 + 2] && src[i + lit * 4 + 3] === src[i + (lit + 1) * 4 + 3]) break;
        lit++;
      }
      out.push(lit - 1);
      for (let j = 0; j < lit * 4; j++) out.push(src[i + j]);
      i += lit * 4;
    }
  }
  return Buffer.from(out);
}

/* ---------- XCF RLE (لوحات مستقلة + أطوال 16-بت) ---------- */
function xcfRleTile(rgba, w, h) {
  const parts = [];
  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < h; y++) {
      const row = Buffer.alloc(w);
      for (let x = 0; x < w; x++) row[x] = rgba[(y * w + x) * 4 + c];
      const rle = packBits(row, 0, w);
      const head = Buffer.alloc(2);
      if (rle.length >= 0x8000) throw new Error('صف RLE طويل جداً');
      head.writeUInt16BE(rle.length, 0);
      parts.push(head, rle);
    }
  }
  return Buffer.concat(parts);
}
function xcfRleUnTile(buf, off, w, h, bpp) {
  const px = Buffer.alloc(w * h * bpp);
  let ip = off;
  for (let c = 0; c < bpp; c++) {
    for (let y = 0; y < h; y++) {
      const len = buf.readUInt16BE(ip); ip += 2;
      if (len === 0) break; // انتهت البيانات مبكراً
      const row = unpackBits(buf, ip, len, w);
      ip += len;
      for (let x = 0; x < w; x++) px[(y * w + x) * bpp + c] = row[x];
    }
  }
  return { px, end: ip };
}

/* ---------- خلط/تسطيح ---------- */
function flatten(rgba, w, h, bg) {
  const b = hexToRgb(bg || '#ffffff');
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const a = rgba[p + 3] / 255;
    out[p] = rgba[p] * a + b.r * (1 - a);
    out[p + 1] = rgba[p + 1] * a + b.g * (1 - a);
    out[p + 2] = rgba[p + 2] * a + b.b * (1 - a);
    out[p + 3] = 255;
  }
  return out;
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/* ---------- قياسات وتحجيم عبر sharp ---------- */
async function resizeIfNeeded(img, maxDim) {
  if (!maxDim || (img.width <= maxDim && img.height <= maxDim)) return img;
  const scale = maxDim / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const buf = await sharp(Buffer.from(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer();
  const out = makeImage(w, h);
  out.rgba = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length);
  if (img.float) {
    const fscaled = await sharp(Buffer.from(img.float.data.buffer, img.float.data.byteOffset, img.float.data.byteLength), {
      raw: { width: img.width, height: img.height, channels: 3, depth: 'float' },
    }).resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer();
    out.float = { data: new Float32Array(fscaled.buffer, fscaled.byteOffset, fscaled.length / 4) };
  }
  out.meta = { ...img.meta, resized: true };
  return out;
}

/* ---------- توقيعات الملفات ---------- */
function startsWith(buf, arr, off = 0) {
  if (buf.length < off + arr.length) return false;
  for (let i = 0; i < arr.length; i++) if (buf[off + i] !== arr[i]) return false;
  return true;
}
function ascii(buf, off, len) {
  let s = '';
  const end = Math.min(buf.length, off + len);
  for (let i = off; i < end; i++) s += String.fromCharCode(buf[i]);
  return s;
}
function findAscii(buf, needle, from = 0, to = buf.length - needle.length) {
  const n = Buffer.from(needle, 'latin1');
  const lim = Math.min(to, buf.length - n.length);
  for (let i = from; i <= lim; i++) {
    let ok = true;
    for (let j = 0; j < n.length; j++) if (buf[i + j] !== n[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/** تخمين نوع الملف من التوقيع — يعيد امتداداً من قائمة الصيغ أو null */
function sniffFormat(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(buf, [0x42, 0x4d])) return 'bmp';
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) {
    // TIFF أو DNG أو CR2
    if (findAscii(buf, 'DNG', 0, 4096) !== -1) return 'dng';
    if (findAscii(buf, 'Canon', 0, 65536) !== -1) return 'cr2';
    return 'tif';
  }
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46])) { // RIFF
    const form = ascii(buf, 8, 4);
    if (form === 'WEBP') return 'webp';
    if (form === 'CDR' || form === 'cdr' || form === 'CDR4' || form.startsWith('CDR')) return 'cdr';
    return null;
  }
  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)) {
      // mif1 قد يكون AVIF أيضاً — نفحص تواجد av01
      if (brand === 'mif1' && findAscii(buf, 'av01', 0, 4096) !== -1) return 'avif';
      if (findAscii(buf, 'mjp2', 0, 256) !== -1) return 'mj2';
      return 'heic';
    }
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'mjp2' || brand === 'jp2 ') return 'mj2';
  }
  if (startsWith(buf, [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20])) { // jp2 signature box
    if (findAscii(buf, 'mjp2', 0, 256) !== -1) return 'mj2';
    if (findAscii(buf, 'jpm ', 0, 256) !== -1) return 'jpm';
    return 'jp2';
  }
  if (startsWith(buf, [0xff, 0x4f, 0xff, 0x51])) return 'j2k';
  if (startsWith(buf, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return 'jxl';
  if (startsWith(buf, [0xff, 0x0a])) return 'jxl';
  if (ascii(buf, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(buf, 0, 5) === '%!PS-') return 'eps';
  if (startsWith(buf, [0x38, 0x42, 0x50, 0x53])) return 'psd';
  if (startsWith(buf, [0x67, 0x69, 0x6d, 0x70, 0x20, 0x78, 0x63, 0x66])) return 'xcf';
  if (startsWith(buf, [0x44, 0x44, 0x53, 0x20])) return 'dds';
  if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  if (startsWith(buf, [0x00, 0x00, 0x02, 0x00])) return 'cur';
  if (ascii(buf, 0, 4) === 'icns') return 'icns';
  if (startsWith(buf, [0x76, 0x2f, 0x31, 0x01])) return 'exr';
  if (ascii(buf, 0, 10) === '#?RADIANCE' || ascii(buf, 0, 6) === '#?RGBE') return 'hdr';
  if (ascii(buf, 0, 8) === 'SIMPLE  =') return 'fits';
  if (buf[0] === 0x50 && buf[1] >= 0x31 && buf[1] <= 0x37) return 'pnm';
  if (buf[0] === 0x0a && buf[1] >= 0x00 && buf[1] <= 0x05) return 'pcx';
  if (buf[0] === 0x01 && buf[1] === 0xda) return 'sgi';
  if (startsWith(buf, [0xd7, 0xcd, 0xc6, 0x9a])) return 'wmf';
  if (startsWith(buf, [0x01, 0x00, 0x09, 0x00]) || startsWith(buf, [0x02, 0x00, 0x09, 0x00]) || startsWith(buf, [0x01, 0x00, 0x10, 0x00])) return 'wmf';
  if (startsWith(buf, [0x01, 0x00, 0x00, 0x00]) && ascii(buf, 40, 4) === ' EMF') return 'emf';
  if (findAscii(buf, 'TRUEVISION-XFILE', buf.length - 26) === buf.length - 18) return 'tga';
  return null;
}

/* ---------- أدوات متفرقة ---------- */
function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
function humanSize(n) {
  if (n < 1024) return `${n} بايت`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} ك.ب`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(2)} م.ب`;
  return `${(n / 1073741824).toFixed(2)} ج.ب`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** يعيد Buffer من Uint8ClampedArray دون نسخ زائد */
function u8ToBuffer(u8) {
  if (Buffer.isBuffer(u8)) return u8;
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

module.exports = {
  makeImage, rgbaToFloat, floatToRgba, halfToFloatFast, floatToHalf,
  ascii85Encode, packBits, unpackBits, rleEncodePCX, rleDecodePCX, rleEncodeTGA,
  xcfRleTile, xcfRleUnTile, flatten, hexToRgb, resizeIfNeeded, sharp,
  sniffFormat, startsWith, ascii, findAscii, clampByte, humanSize, sleep,
  linearToSrgb, u8ToBuffer,
};

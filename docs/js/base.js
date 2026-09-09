'use strict';
/* base.js — بديل Buffer للمتصفح + أدوات أساسية + كاتب ZIP (تخزين بلا ضغط) */
(function () {
  if (window.Buffer) return;

  const enc = new TextEncoder();
  const dec = new TextDecoder('latin1');
  const decU8 = new TextDecoder('utf8');

  function need(len, off, name) {
    if (off + len > this.length) throw new Error(`قراءة خارج الحدود (${name} عند ${off})`);
  }
  const P = Uint8Array.prototype;
  const dv = (o) => new DataView(o.buffer, o.byteOffset, o.byteLength);

  Object.defineProperties(P, {
    readUInt8:   { value: function (o = 0) { need.call(this, 1, o, 'u8'); return dv(this).getUint8(o); } },
    readInt8:    { value: function (o = 0) { need.call(this, 1, o, 'i8'); return dv(this).getInt8(o); } },
    readUInt16LE:{ value: function (o = 0) { need.call(this, 2, o, 'u16'); return dv(this).getUint16(o, true); } },
    readUInt16BE:{ value: function (o = 0) { need.call(this, 2, o, 'u16'); return dv(this).getUint16(o, false); } },
    readInt16LE: { value: function (o = 0) { need.call(this, 2, o, 'i16'); return dv(this).getInt16(o, true); } },
    readInt16BE: { value: function (o = 0) { need.call(this, 2, o, 'i16'); return dv(this).getInt16(o, false); } },
    readUInt32LE:{ value: function (o = 0) { need.call(this, 4, o, 'u32'); return dv(this).getUint32(o, true); } },
    readUInt32BE:{ value: function (o = 0) { need.call(this, 4, o, 'u32'); return dv(this).getUint32(o, false); } },
    readInt32LE: { value: function (o = 0) { need.call(this, 4, o, 'i32'); return dv(this).getInt32(o, true); } },
    readInt32BE: { value: function (o = 0) { need.call(this, 4, o, 'i32'); return dv(this).getInt32(o, false); } },
    readFloatLE: { value: function (o = 0) { need.call(this, 4, o, 'f32'); return dv(this).getFloat32(o, true); } },
    readFloatBE: { value: function (o = 0) { need.call(this, 4, o, 'f32'); return dv(this).getFloat32(o, false); } },
    readDoubleLE:{ value: function (o = 0) { need.call(this, 8, o, 'f64'); return dv(this).getFloat64(o, true); } },
    readDoubleBE:{ value: function (o = 0) { need.call(this, 8, o, 'f64'); return dv(this).getFloat64(o, false); } },
    readBigUInt64LE:{ value: function (o = 0) { need.call(this, 8, o, 'u64'); return dv(this).getBigUint64(o, true); } },
    readBigUInt64BE:{ value: function (o = 0) { need.call(this, 8, o, 'u64'); return dv(this).getBigUint64(o, false); } },
    writeUInt8:   { value: function (v, o = 0) { dv(this).setUint8(o, v >>> 0); } },
    writeInt8:    { value: function (v, o = 0) { dv(this).setInt8(o, v); } },
    writeUInt16LE:{ value: function (v, o = 0) { dv(this).setUint16(o, v >>> 0, true); } },
    writeUInt16BE:{ value: function (v, o = 0) { dv(this).setUint16(o, v >>> 0, false); } },
    writeInt16LE: { value: function (v, o = 0) { dv(this).setInt16(o, v, true); } },
    writeInt32LE: { value: function (v, o = 0) { dv(this).setInt32(o, v, true); } },
    writeInt32BE: { value: function (v, o = 0) { dv(this).setInt32(o, v, false); } },
    writeUInt32LE:{ value: function (v, o = 0) { dv(this).setUint32(o, v >>> 0, true); } },
    writeUInt32BE:{ value: function (v, o = 0) { dv(this).setUint32(o, v >>> 0, false); } },
    writeFloatLE: { value: function (v, o = 0) { dv(this).setFloat32(o, v, true); } },
    writeFloatBE: { value: function (v, o = 0) { dv(this).setFloat32(o, v, false); } },
    writeDoubleBE:{ value: function (v, o = 0) { dv(this).setFloat64(o, v, false); } },
    writeBigUInt64LE:{ value: function (v, o = 0) { dv(this).setBigUint64(o, BigInt(v), true); } },
    copy: {
      value: function (target, tStart = 0, sStart = 0, sEnd = this.length) {
        const src = this.subarray(sStart, sEnd);
        target.set(src, tStart);
        return src.length;
      },
    },
    slice: { value: function (a = 0, b = this.length) { return this.subarray(a, b); } },
    indexOf: {
      value: function (needle, from = 0) {
        if (typeof needle === 'number') {
          for (let i = from; i < this.length; i++) if (this[i] === (needle & 0xff)) return i;
          return -1;
        }
        const n = typeof needle === 'string' ? Buffer.from(needle, 'latin1') : needle;
        outer: for (let i = from; i <= this.length - n.length; i++) {
          for (let j = 0; j < n.length; j++) if (this[i + j] !== n[j]) continue outer;
          return i;
        }
        return -1;
      },
    },
    toString: {
      value: function (en = 'utf8', start = 0, end = this.length) {
        const sub = this.subarray(start, end);
        if (en === 'latin1' || en === 'binary' || en === 'ascii') return dec.decode(sub);
        if (en === 'hex') return Array.from(sub, (b) => b.toString(16).padStart(2, '0')).join('');
        return decU8.decode(sub);
      },
    },
    write: {
      value: function (str, off = 0, len, en) {
        if (typeof len === 'string') { en = len; len = undefined; } // صيغة Node: write(str, offset, encoding)
        if (len === undefined) len = this.length - off;
        const bytes = en === 'latin1' || en === 'binary' || en === 'ascii'
          ? Uint8Array.from(str, (c) => c.charCodeAt(0) & 0xff)
          : enc.encode(str);
        const n = Math.min(bytes.length, len);
        this.set(bytes.subarray(0, n), off);
        return n;
      },
    },
  });

  const Buffer = {
    isBuffer: (x) => x instanceof Uint8Array,
    from(x, en) {
      if (typeof x === 'string') {
        if (en === 'latin1' || en === 'binary' || en === 'ascii') return Uint8Array.from(x, (c) => c.charCodeAt(0) & 0xff);
        if (en === 'hex') {
          const out = new Uint8Array(x.length >> 1);
          for (let i = 0; i < out.length; i++) out[i] = parseInt(x.substr(i * 2, 2), 16);
          return out;
        }
        return enc.encode(x);
      }
      if (x instanceof ArrayBuffer) return new Uint8Array(x);
      if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); // نسخة مثل Node
      return new Uint8Array(x);
    },
    alloc(n, fillv = 0) { const b = new Uint8Array(n); if (fillv !== 0) b.fill(fillv); return b; },
    allocUnsafe(n) { return new Uint8Array(n); },
    concat(list) {
      let n = 0;
      for (const it of list) n += it.length;
      const out = new Uint8Array(n);
      let o = 0;
      for (const it of list) { out.set(it, o); o += it.length; }
      return out;
    },
  };
  window.Buffer = Buffer;
})();

/* ================= أدوات أساسية (منفذة من src/utils.js) ================= */
const IC = window.IC = {
  version: '1.0.0-web',
};

IC.makeImage = function (width, height) {
  return { width, height, rgba: new Uint8ClampedArray(width * height * 4), float: null, meta: {} };
};

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(v) { return v <= 0 ? 0 : v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }

IC.rgbaToFloat = function (rgba, w, h) {
  const n = w * h;
  const out = new Float32Array(n * 3);
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
    out[q] = SRGB_TO_LIN[rgba[p]]; out[q + 1] = SRGB_TO_LIN[rgba[p + 1]]; out[q + 2] = SRGB_TO_LIN[rgba[p + 2]];
  }
  return out;
};
IC.floatToRgba = function (data, w, h) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
    for (let c = 0; c < 3; c++) {
      let v = data[q + c];
      if (!Number.isFinite(v) || v < 0) v = 0;
      if (v > 1) v = 1 - Math.exp(-v);
      out[p + c] = Math.round(linearToSrgb(v) * 255);
    }
    out[p + 3] = 255;
  }
  return out;
};

/* عوامة نصفية */
const HTF = new Float32Array(65536);
(function () {
  for (let h = 0; h < 65536; h++) {
    const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
    let x;
    if (e === 0) x = f * Math.pow(2, -24);
    else if (e === 31) x = f ? NaN : Infinity;
    else x = (1 + f / 1024) * Math.pow(2, e - 15);
    HTF[h] = s ? -x : x;
  }
})();
IC.halfToFloatFast = (h) => HTF[h >>> 0];
const _f32 = new Float32Array(1), _i32 = new Int32Array(_f32.buffer);
IC.floatToHalf = function (v) {
  if (Number.isNaN(v)) return 0x7e00;
  if (v === Infinity) return 0x7c00;
  if (v === -Infinity) return 0xfc00;
  _f32[0] = v;
  const x = _i32[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) return bits | 0x7c00;
  if (e < 113) { m |= 0x0800; bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1); return bits; }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
};

/* ASCII85 وRLE */
IC.ascii85Encode = function (bytes) {
  let out = '';
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const cnt = Math.min(4, n - i);
    let word = 0;
    for (let j = 0; j < 4; j++) word = (word << 8) | (j < cnt ? bytes[i + j] : 0);
    word = word >>> 0;
    const digits = [];
    for (let j = 0; j < 5; j++) { digits.unshift(word % 85); word = Math.floor(word / 85); }
    for (let j = 0; j <= cnt; j++) out += String.fromCharCode(digits[j] + 33);
    i += 4;
  }
  return out;
};
IC.packBits = function (src, off, len) {
  const out = [];
  let i = off;
  const end = off + len;
  while (i < end) {
    let run = 1;
    while (i + run < end && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 3 || i + run === end) { out.push((257 - run) & 0xff, src[i]); i += run; }
    else {
      let lit = 1;
      while (i + lit < end && lit < 128 && (i + lit + 2 >= end || src[i + lit] !== src[i + lit + 1] || src[i + lit] !== src[i + lit + 2])) lit++;
      out.push(lit - 1);
      for (let j = 0; j < lit; j++) out.push(src[i + j]);
      i += lit;
    }
  }
  return Buffer.from(out);
};
IC.unpackBits = function (src, off, len, expectedLen) {
  const out = Buffer.alloc(expectedLen);
  let ip = off, op = 0;
  const end = off + len;
  while (ip < end && op < expectedLen) {
    const n = src.readInt8(ip); ip++;
    if (n >= 0) { const cnt = n + 1; src.copy(out, op, ip, ip + cnt); op += cnt; ip += cnt; }
    else if (n > -128) { const cnt = 1 - n; out.fill(src[ip], op, op + cnt); ip++; op += cnt; }
  }
  return out;
};
IC.rleEncodePCX = function (src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const b = src[i];
    let run = 1;
    while (run < 63 && i + run < src.length && src[i + run] === b) run++;
    if (run > 1 || (b & 0xc0) === 0xc0) { out.push(0xc0 | run, b); i += run; }
    else { out.push(b); i++; }
  }
  return Buffer.from(out);
};
IC.rleDecodePCX = function (src, expectedLen) {
  const out = Buffer.alloc(expectedLen);
  let ip = 0, op = 0;
  while (op < expectedLen && ip < src.length) {
    const b = src[ip++];
    if ((b & 0xc0) === 0xc0) { const cnt = b & 0x3f; out.fill(src[ip++], op, op + cnt); op += cnt; }
    else out[op++] = b;
  }
  return out;
};
IC.xcfRleTile = function (rgba, w, h) {
  const parts = [];
  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < h; y++) {
      const row = Buffer.alloc(w);
      for (let x = 0; x < w; x++) row[x] = rgba[(y * w + x) * 4 + c];
      const rle = IC.packBits(row, 0, w);
      const head = Buffer.alloc(2);
      if (rle.length >= 0x8000) throw new Error('صف RLE طويل جداً');
      head.writeUInt16BE(rle.length, 0);
      parts.push(head, rle);
    }
  }
  return Buffer.concat(parts);
};
IC.xcfRleUnTile = function (buf, off, w, h, bpp) {
  const px = Buffer.alloc(w * h * bpp);
  let ip = off;
  for (let c = 0; c < bpp; c++) {
    for (let y = 0; y < h; y++) {
      const len = buf.readUInt16BE(ip); ip += 2;
      if (len === 0) break;
      const row = IC.unpackBits(buf, ip, len, w);
      ip += len;
      for (let x = 0; x < w; x++) px[(y * w + x) * bpp + c] = row[x];
    }
  }
  return { px, end: ip };
};

/* تسطيح وألوان */
IC.hexToRgb = function (hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
};
IC.flatten = function (rgba, w, h, bg) {
  const b = IC.hexToRgb(bg || '#ffffff');
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
};
IC.hasAlpha = function (img) {
  const a = img.rgba;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 255) return true;
  return false;
};

/* canvas helpers */
IC.createCanvas = function (w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
IC.canvasToImage = function (canvas) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const img = IC.makeImage(canvas.width, canvas.height);
  img.rgba = new Uint8ClampedArray(d.data);
  return img;
};
IC.imageToCanvas = function (img) {
  const c = IC.createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.rgba);
  ctx.putImageData(id, 0, 0);
  return c;
};
IC.resizeIfNeeded = function (img, maxDim) {
  if (!maxDim || (img.width <= maxDim && img.height <= maxDim)) return Promise.resolve(img);
  const scale = maxDim / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const src = IC.imageToCanvas(img);
  const dst = IC.createCanvas(w, h);
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const out = IC.canvasToImage(dst);
  out.float = null;
  return Promise.resolve(out);
};

/* توقيعات */
IC.ascii = (buf, off, len) => {
  let s = '';
  const end = Math.min(buf.length, off + len);
  for (let i = off; i < end; i++) s += String.fromCharCode(buf[i]);
  return s;
};
IC.findAscii = function (buf, needle, from = 0, to) {
  if (to === undefined) to = buf.length - needle.length;
  const lim = Math.min(to, buf.length - needle.length);
  outer: for (let i = from; i <= lim; i++) {
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
};
IC.startsWith = function (buf, arr, off = 0) {
  if (buf.length < off + arr.length) return false;
  for (let i = 0; i < arr.length; i++) if (buf[off + i] !== arr[i]) return false;
  return true;
};
IC.sniffFormat = function (buf) {
  if (!buf || buf.length < 12) return null;
  const A = IC.ascii, S = IC.startsWith, F = IC.findAscii;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (S(buf, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (S(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (S(buf, [0x42, 0x4d])) return 'bmp';
  if (S(buf, [0x49, 0x49, 0x2a, 0x00]) || S(buf, [0x4d, 0x4d, 0x00, 0x2a])) return 'tif';
  if (A(buf, 0, 4) === 'RIFF') {
    const form = A(buf, 8, 4);
    if (form === 'WEBP') return 'webp';
    if (form.startsWith('CDR')) return 'cdr';
    return null;
  }
  if (A(buf, 4, 4) === 'ftyp') {
    const brand = A(buf, 8, 4);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'mjp2') return 'mj2';
  }
  if (S(buf, [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20])) return 'jp2';
  if (S(buf, [0xff, 0x4f, 0xff, 0x51]) || S(buf, [0xff, 0x0a]) || S(buf, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return 'jxl';
  if (A(buf, 0, 5) === '%PDF-') return 'pdf';
  if (A(buf, 0, 5) === '%!PS-') return 'eps';
  if (S(buf, [0x38, 0x42, 0x50, 0x53])) return 'psd';
  if (S(buf, [0x67, 0x69, 0x6d, 0x70, 0x20, 0x78, 0x63, 0x66])) return 'xcf';
  if (S(buf, [0x44, 0x44, 0x53, 0x20])) return 'dds';
  if (S(buf, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  if (S(buf, [0x00, 0x00, 0x02, 0x00])) return 'cur';
  if (A(buf, 0, 4) === 'icns') return 'icns';
  if (S(buf, [0x76, 0x2f, 0x31, 0x01])) return 'exr';
  if (A(buf, 0, 10) === '#?RADIANCE' || A(buf, 0, 6) === '#?RGBE') return 'hdr';
  if (A(buf, 0, 8) === 'SIMPLE  =') return 'fits';
  if (buf[0] === 0x50 && buf[1] >= 0x31 && buf[1] <= 0x37) return 'pnm';
  if (buf[0] === 0x0a && buf[1] <= 0x05) return 'pcx';
  if (buf[0] === 0x01 && buf[1] === 0xda) return 'sgi';
  if (S(buf, [0xd7, 0xcd, 0xc6, 0x9a]) || S(buf, [0x01, 0x00, 0x09, 0x00]) || S(buf, [0x02, 0x00, 0x09, 0x00]) || S(buf, [0x01, 0x00, 0x10, 0x00])) return 'wmf';
  if (S(buf, [0x01, 0x00, 0x00, 0x00]) && buf.length > 44 && A(buf, 40, 4) === ' EMF') return 'emf';
  return null;
};

/* ضغط zlib عبر Streams API */
IC.zlibInflate = async function (buf) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
IC.zlibDeflate = async function (buf) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([buf]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
IC.gunzip = async function (buf) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
IC.gzip = async function (buf) {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/* ================= كاتب ZIP (تخزين) ================= */
IC.ZipWriter = class {
  constructor() { this.entries = []; }
  add(name, bytes) {
    this.entries.push({ name: new TextEncoder().encode(name), bytes });
  }
  async build() {
    const parts = [];
    const central = [];
    let offset = 0;
    const crcTable = IC._crcTable || (IC._crcTable = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
      }
      return t;
    })());
    const crc32 = (u8) => {
      let c = -1;
      for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
      return (c ^ -1) >>> 0;
    };
    for (const e of this.entries) {
      const crc = crc32(e.bytes);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(0, 8); // store
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(e.bytes.length, 18);
      local.writeUInt32LE(e.bytes.length, 22);
      local.writeUInt16LE(e.name.length, 26);
      parts.push(local, e.name, e.bytes);
      const cdr = Buffer.alloc(46);
      cdr.writeUInt32LE(0x02014b50, 0);
      cdr.writeUInt16LE(20, 4);
      cdr.writeUInt16LE(20, 6);
      cdr.writeUInt16LE(0x0800, 8);
      cdr.writeUInt32LE(crc, 16);
      cdr.writeUInt32LE(e.bytes.length, 20);
      cdr.writeUInt32LE(e.bytes.length, 24);
      cdr.writeUInt16LE(e.name.length, 28);
      cdr.writeUInt32LE(offset, 42);
      central.push(cdr);
      offset += 30 + e.name.length + e.bytes.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) centralSize += c.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    return Buffer.concat([...parts, ...central, eocd]);
  }
};

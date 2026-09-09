'use strict';
/* ترميز الصورة الأساسية (RGBA) إلى جميع الصيغ القابلة للكتابة */

const zlib = require('zlib');
const U = require('./utils');
const { makeImage } = U;

const FLATTENED = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'bmp', 'dib', 'pcx', 'ppm', 'pgm', 'pbm', 'pnm', 'eps', 'wmf', 'emf', 'dng', 'raw', 'gif', 'pdf', 'fits', 'fits.gz']);
const ALPHA_OK = new Set(['png', 'webp', 'avif', 'tif', 'tiff', 'ico', 'cur', 'icns', 'psd', 'psb', 'xcf', 'tga', 'dds', 'pam', 'svg', 'exr', 'hdr', 'sgi', 'rgb', 'rgba', 'jxl', 'heic', 'heif', 'ai']);

function hasAlpha(img) {
  const a = img.rgba;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 255) return true;
  return false;
}

/** يجهز RGBA النهائي حسب الصيغة (تسطيح/خلفية) */
function prepareRgba(img, ext, opts) {
  const alphaAllowed = ALPHA_OK.has(ext);
  if (alphaAllowed) return img.rgba;
  return U.flatten(img.rgba, img.width, img.height, opts.background);
}

function sharpInput(rgba, w, h) {
  return U.sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: w, height: h, channels: 4 } });
}

/* ================= عائلة sharp ================= */
async function encJpeg(img, opts) {
  return sharpInput(img.rgba, img.width, img.height)
    .flatten({ background: opts.background })
    .jpeg({ quality: opts.quality, mozjpeg: true, chromaSubsampling: opts.quality >= 90 ? '4:4:4' : '4:2:0' })
    .toBuffer();
}
async function encPng(img, opts) {
  return sharpInput(img.rgba, img.width, img.height)
    .png({ compressionLevel: 9, effort: 7 })
    .toBuffer();
}
async function encWebp(img, opts) {
  return sharpInput(img.rgba, img.width, img.height)
    .webp({ quality: opts.quality, effort: 4 })
    .toBuffer();
}
async function encAvif(img, opts) {
  return sharpInput(img.rgba, img.width, img.height)
    .avif({ quality: Math.min(opts.quality, 85), effort: 3 })
    .toBuffer();
}
async function encGif(img, opts) {
  return sharpInput(img.rgba, img.width, img.height)
    .flatten({ background: opts.background })
    .gif()
    .toBuffer();
}
async function encTiff(img, opts) {
  return sharpInput(img.rgba, img.width, img.height)
    .tiff({ compression: 'deflate', quality: opts.quality })
    .toBuffer();
}

/* ================= BMP / DIB ================= */
function buildDib(rgba, w, h, withAlpha) {
  const bpp = withAlpha ? 32 : 24;
  const rowSize = Math.floor((bpp * w + 31) / 32) * 4;
  const pxSize = rowSize * h;
  const hdrSize = 40;
  const total = hdrSize + (withAlpha ? 12 : 0) + pxSize;
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(hdrSize, 0);
  buf.writeInt32LE(w, 4);
  buf.writeInt32LE(h, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(bpp, 14);
  buf.writeUInt32LE(withAlpha ? 3 : 0, 16); // BI_BITFIELDS / BI_RGB
  buf.writeUInt32LE(pxSize, 20);
  buf.writeUInt32LE(2835, 24); // 72 dpi
  buf.writeUInt32LE(2835, 28);
  let px = hdrSize;
  if (withAlpha) {
    buf.writeUInt32LE(0x00ff0000, px); buf.writeUInt32LE(0x0000ff00, px + 4); buf.writeUInt32LE(0x000000ff, px + 8);
    px += 12;
  }
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    const dstRow = px + y * rowSize;
    for (let x = 0; x < w; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * (bpp / 8);
      buf[d] = rgba[s + 2];
      buf[d + 1] = rgba[s + 1];
      buf[d + 2] = rgba[s];
      buf[d + 3] = withAlpha ? rgba[s + 3] : 0;
    }
  }
  return buf;
}
async function encBmp(img, opts) {
  const rgba = prepareRgba(img, 'bmp', opts);
  const withAlpha = ALPHA_OK.has('bmp') && hasAlpha(img);
  const dib = buildDib(rgba, img.width, img.height, withAlpha);
  const fileHeader = Buffer.alloc(14);
  fileHeader.write('BM', 0, 'latin1');
  fileHeader.writeUInt32LE(14 + dib.length, 2);
  fileHeader.writeUInt32LE(14 + 40 + (withAlpha ? 12 : 0), 10);
  return Buffer.concat([fileHeader, dib]);
}
async function encDib(img, opts) {
  const rgba = prepareRgba(img, 'dib', opts);
  return buildDib(rgba, img.width, img.height, false); // DIB يُكتب مسطّحاً 24-بت
}

/* ================= ICO / CUR ================= */
async function icoEntries(img) {
  const sizes = [256, 128, 64, 48, 32, 24, 16].filter((s) => s <= Math.max(img.width, img.height) || s <= 64);
  const seen = new Set();
  const out = [];
  for (const s of sizes) {
    if (seen.has(s)) continue;
    seen.add(s);
    const scale = Math.min(1, s / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const png = await sharpInput(img.rgba, img.width, img.height).resize(w, h, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    out.push({ w, h, png });
  }
  return out;
}
async function encIco(img) {
  const entries = await icoEntries(img);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(entries.length, 4);
  const dirSize = 16 * entries.length;
  let offset = 6 + dirSize;
  const dirs = [];
  const blobs = [];
  for (const e of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = e.w >= 256 ? 0 : e.w;
    dir[1] = e.h >= 256 ? 0 : e.h;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(e.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dirs.push(dir);
    blobs.push(e.png);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}
async function encCur(img) {
  // المؤشرات: 32×32 مع نقطة ساخنة
  const png = await sharpInput(img.rgba, img.width, img.height)
    .resize(32, 32, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(2, 2); // CUR
  header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = 32; dir[1] = 32;
  dir.writeUInt16LE(0, 4); // hotspot X (في CUR تكون حقول planes/bitcount نقطة السخونة)
  dir.writeUInt16LE(0, 6); // hotspot Y
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, dir, png]);
}

/* ================= ICNS ================= */
const ICNS_ORDER = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
];
async function encIcns(img) {
  const maxSide = Math.max(img.width, img.height);
  const chunks = [];
  for (const [type, size] of ICNS_ORDER) {
    if (size > maxSide && size > 16) continue; // لا تكبّر
    const scale = Math.min(1, size / maxSide);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const png = await sharpInput(img.rgba, img.width, img.height).resize(w, h, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const bodyLen = chunks.reduce((a, b) => a + b.length, 0);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(8 + bodyLen, 0);
  return Buffer.concat([Buffer.from('icns', 'latin1'), lenBuf, ...chunks]);
}

/* ================= TGA ================= */
async function encTga(img, opts) {
  const w = img.width, h = img.height;
  const alpha = hasAlpha(img);
  const bytesPer = alpha ? 4 : 3;
  const line = Buffer.alloc(w * bytesPer);
  const parts = [];
  const header = Buffer.alloc(18);
  header[2] = 10; // RLE truecolor
  header.writeUInt16LE(w, 12);
  header.writeUInt16LE(h, 14);
  header[16] = bytesPer * 8;
  header[17] = 0x20 | (alpha ? 8 : 0); // أصل علوي + بتات ألفا
  parts.push(header);
  for (let y = 0; y < h; y++) {
    const srcRow = y * w * 4; // الأصل أعلى-يسار (descriptor 0x20)
    for (let x = 0; x < w; x++) {
      const s = srcRow + x * 4;
      if (alpha) {
        line[x * 4] = img.rgba[s + 2]; line[x * 4 + 1] = img.rgba[s + 1]; line[x * 4 + 2] = img.rgba[s]; line[x * 4 + 3] = img.rgba[s + 3];
      } else {
        line[x * 3] = img.rgba[s + 2]; line[x * 3 + 1] = img.rgba[s + 1]; line[x * 3 + 2] = img.rgba[s];
      }
    }
    parts.push(tgaRleLine(line, bytesPer));
  }
  const footer = Buffer.alloc(26);
  footer.write('TRUEVISION-XFILE.\x00', 0, 'latin1');
  parts.push(footer);
  return Buffer.concat(parts);
}
function tgaRleLine(line, bytesPer) {
  const out = [];
  const n = line.length;
  let i = 0;
  const eq = (a, b) => {
    for (let c = 0; c < bytesPer; c++) if (line[a + c] !== line[b + c]) return false;
    return true;
  };
  while (i < n) {
    let run = 1;
    while (i + run * bytesPer < n && run < 128 && eq(i, i + run * bytesPer)) run++;
    if (run > 1) {
      out.push(0x80 | (run - 1));
      for (let c = 0; c < bytesPer; c++) out.push(line[i + c]);
      i += run * bytesPer;
    } else {
      let lit = 1;
      while (i + lit * bytesPer < n && lit < 128) {
        if (i + (lit + 1) * bytesPer < n && eq(i + lit * bytesPer, i + (lit + 1) * bytesPer)) break;
        lit++;
      }
      out.push(lit - 1);
      for (let j = 0; j < lit * bytesPer; j++) out.push(line[i + j]);
      i += lit * bytesPer;
    }
  }
  return Buffer.from(out);
}

/* ================= PCX ================= */
async function encPcx(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const bpl = w % 2 ? w + 1 : w;
  const header = Buffer.alloc(128);
  header[0] = 0x0a;
  header[1] = 5; // إصدار 3.0 24-بت
  header[2] = 1; // RLE
  header[3] = 8; // bpp
  header.writeUInt16LE(0, 4); header.writeUInt16LE(0, 6);
  header.writeUInt16LE(w - 1, 8); header.writeUInt16LE(h - 1, 10);
  header.writeUInt16LE(72, 12); header.writeUInt16LE(72, 14); // dpi
  header.writeUInt16LE(3, 65); // planes
  header.writeUInt16LE(bpl, 66);
  header.writeUInt16LE(1, 68); // palette info
  const parts = [header];
  const row = Buffer.alloc(3 * bpl);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      row[x] = rgba[s];
      row[bpl + x] = rgba[s + 1];
      row[2 * bpl + x] = rgba[s + 2];
    }
    parts.push(U.rleEncodePCX(row));
  }
  return Buffer.concat(parts);
}

/* ================= PNM / PAM ================= */
async function encPnm(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const head = Buffer.from(`P6\n# محول الصور الاحترافي\n${w} ${h}\n255\n`, 'latin1');
  const data = Buffer.alloc(w * h * 3);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    data[i * 3] = rgba[p]; data[i * 3 + 1] = rgba[p + 1]; data[i * 3 + 2] = rgba[p + 2];
  }
  return Buffer.concat([head, data]);
}
async function encPgm(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const head = Buffer.from(`P5\n${w} ${h}\n255\n`, 'latin1');
  const data = Buffer.alloc(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    data[i] = Math.round(0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]);
  }
  return Buffer.concat([head, data]);
}
async function encPbm(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const head = Buffer.from(`P4\n${w} ${h}\n`, 'latin1');
  const rowBytes = Math.ceil(w / 8);
  const data = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const lum = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
      if (lum < 128) data[y * rowBytes + (x >> 3)] |= (0x80 >> (x & 7)); // 1 = أسود
    }
  }
  return Buffer.concat([head, data]);
}
async function encPam(img) {
  const w = img.width, h = img.height;
  const alpha = hasAlpha(img);
  const head = Buffer.from(`P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH ${alpha ? 4 : 3}\nMAXVAL 255\nTUPLTYPE ${alpha ? 'RGB_ALPHA' : 'RGB'}\nENDHDR\n`, 'latin1');
  const data = Buffer.alloc(w * h * (alpha ? 4 : 3));
  for (let i = 0, p = 0, q = 0; i < w * h; i++, p += 4) {
    data[q++] = img.rgba[p]; data[q++] = img.rgba[p + 1]; data[q++] = img.rgba[p + 2];
    if (alpha) data[q++] = img.rgba[p + 3];
  }
  return Buffer.concat([head, data]);
}
async function encPnmGeneric(img, opts) { return encPnm(img, opts); }

/* ================= HDR (Radiance) ================= */
async function encHdr(img) {
  const w = img.width, h = img.height;
  const fdata = img.float ? img.float.data : U.rgbaToFloat(img.rgba, w, h);
  return buildHdrDirect(w, h, fdata);
}
function buildHdrDirect(w, h, fdata) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
  const parts = [head];
  const rgbBuf = Buffer.alloc(w * 4); // 3 قنوات + بايت الأس لكل بكسل
  for (let y = 0; y < h; y++) {
    parts.push(Buffer.from([2, 2, (w >> 8) & 0xff, w & 0xff])); // طول السطر = العرض
    for (let x = 0; x < w; x++) {
      const q = (y * w + x) * 3;
      const r = Math.max(0, fdata[q]), g = Math.max(0, fdata[q + 1]), b = Math.max(0, fdata[q + 2]);
      const m = Math.max(r, g, b);
      if (m < 1e-32 || !Number.isFinite(m)) {
        rgbBuf[x * 4] = rgbBuf[x * 4 + 1] = rgbBuf[x * 4 + 2] = rgbBuf[x * 4 + 3] = 0;
      } else {
        const e = Math.ceil(Math.log2(m)); // m ∈ (2^(e-1), 2^e]
        const scale = 255 / Math.pow(2, e);
        rgbBuf[x * 4] = Math.min(255, Math.round(r * scale));
        rgbBuf[x * 4 + 1] = Math.min(255, Math.round(g * scale));
        rgbBuf[x * 4 + 2] = Math.min(255, Math.round(b * scale));
        rgbBuf[x * 4 + 3] = e + 128;
      }
    }
    for (let c = 0; c < 4; c++) {
      const plane = Buffer.alloc(w);
      for (let x = 0; x < w; x++) plane[x] = rgbBuf[x * 4 + c];
      parts.push(hdrRleRow(plane));
    }
  }
  return Buffer.concat(parts);
}
function hdrRleRow(plane) {
  const out = [];
  const w = plane.length;
  let x = 0;
  while (x < w) {
    // ابحث عن تكرار
    let run = 1;
    while (x + run < w && run < 127 && plane[x + run] === plane[x]) run++;
    if (run >= 4) {
      out.push(128 + run, plane[x]);
      x += run;
    } else {
      let lit = 1;
      while (x + lit < w && lit < 127) {
        let rep = 1;
        while (x + lit + rep < w && rep < 4 && plane[x + lit + rep] === plane[x + lit]) break;
        if (x + lit + 2 < w && plane[x + lit] === plane[x + lit + 1] && plane[x + lit] === plane[x + lit + 2]) break;
        lit++;
      }
      out.push(lit);
      for (let k = 0; k < lit; k++) out.push(plane[x + k]);
      x += lit;
    }
  }
  return Buffer.from(out);
}

/* ================= EXR (ZIPS half) ================= */
async function encExr(img) {
  const w = img.width, h = img.height;
  const alpha = hasAlpha(img);
  const fdata = img.float ? img.float.data : U.rgbaToFloat(img.rgba, w, h);
  // قنوات مرتبة أبجدياً كما تتطلب المواصفة: A,B,G,R
  const chans = alpha ? [
    { name: 'A', src: (i) => img.rgba[i * 4 + 3] / 255 },
    { name: 'B', src: (i) => fdata[i * 3 + 2] },
    { name: 'G', src: (i) => fdata[i * 3 + 1] },
    { name: 'R', src: (i) => fdata[i * 3] },
  ] : [
    { name: 'B', src: (i) => fdata[i * 3 + 2] },
    { name: 'G', src: (i) => fdata[i * 3 + 1] },
    { name: 'R', src: (i) => fdata[i * 3] },
  ];
  const header = [];
  const putStr = (s) => header.push(Buffer.from(s + '\0', 'latin1'));
  const putU32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); header.push(b); };
  const putAttr = (name, type, payload) => { putStr(name); putStr(type); putU32(payload.length); header.push(payload); };
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; };
  const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; };
  // magic + version (ZIPS=3 يعني long names? لا — الإصدار: bit11 = non-image؟ اكتب 2)
  const magic = Buffer.from([0x76, 0x2f, 0x31, 0x01]);
  const version = u32(2);
  // chlist — لكل قناة: الاسم، النوع(half=1)، pLinear+محجوز، xSampling، ySampling
  const chlist = [];
  for (const c of chans) {
    const name = Buffer.from(c.name + '\0', 'latin1');
    chlist.push(name, i32(1), u32(1), i32(1), i32(1));
  }
  chlist.push(Buffer.from([0]));
  putAttr('channels', 'chlist', Buffer.concat(chlist));
  putAttr('compression', 'compression', Buffer.from([3])); // ZIP
  putAttr('dataWindow', 'box2i', Buffer.concat([i32(0), i32(0), i32(w - 1), i32(h - 1)]));
  putAttr('displayWindow', 'box2i', Buffer.concat([i32(0), i32(0), i32(w - 1), i32(h - 1)]));
  putAttr('lineOrder', 'lineOrder', Buffer.from([0])); // INCREASING_Y
  putAttr('pixelAspectRatio', 'float', f32(1));
  putAttr('screenWindowCenter', 'v2f', Buffer.concat([f32(0), f32(0)]));
  putAttr('screenWindowWidth', 'float', f32(1));
  header.push(Buffer.from([0])); // نهاية الترويسة
  const headBuf = Buffer.concat([magic, version, ...header]);
  // كتل: ZIP = 16 سطراً لكل كتلة
  const LINES = 16;
  const blocks = [];
  for (let yStart = 0; yStart < h; yStart += LINES) {
    const nLines = Math.min(LINES, h - yStart);
    const planar = [];
    for (let c = 0; c < chans.length; c++) {
      const plane = Buffer.alloc(w * nLines * 2);
      for (let li = 0; li < nLines; li++) {
        const rowOff = (yStart + li) * w;
        for (let x = 0; x < w; x++) {
          const v = chans[c].src(rowOff + x);
          plane.writeUInt16LE(U.floatToHalf(v), (li * w + x) * 2);
        }
      }
      planar.push(plane);
    }
    const raw = Buffer.concat(planar);
    // المتنبئ: دلتا تراكمية عكسية (نطرح السابق)
    let prev = 0;
    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i];
      raw[i] = (cur - prev) & 0xff;
      prev = cur;
    }
    const comp = zlib.deflateSync(raw, { level: 6 });
    const chunk = Buffer.alloc(8);
    chunk.writeUInt32LE(yStart, 0);
    chunk.writeUInt32LE(comp.length, 4);
    blocks.push({ chunk, data: comp });
  }
  const offsetCount = blocks.length;
  const tableSize = offsetCount * 8;
  const headerSize = headBuf.length;
  const table = Buffer.alloc(tableSize);
  let off = headerSize + tableSize;
  blocks.forEach((b, i) => {
    table.writeBigUInt64LE(BigInt(off), i * 8);
    off += b.chunk.length + b.data.length;
  });
  return Buffer.concat([headBuf, table, ...blocks.flatMap((b) => [b.chunk, b.data])]);
}

/* ================= FITS ================= */
async function encFits(img) {
  const w = img.width, h = img.height;
  const fdata = img.float ? img.float.data : U.rgbaToFloat(img.rgba, w, h);
  const cards = [];
  const add = (key, value, comment) => {
    let card = key.padEnd(8, ' ');
    if (value !== undefined) card += '= ' + String(value).padStart(20);
    if (comment) card += ' / ' + comment;
    cards.push(card.padEnd(80, ' ').slice(0, 80));
  };
  add('SIMPLE', 'T', 'conforms to FITS standard');
  add('BITPIX', -32, '32-bit float');
  add('NAXIS', 2);
  add('NAXIS1', w);
  add('NAXIS2', h);
  add('BSCALE', 1);
  add('BZERO', 0);
  add('CREATOR', "'ImageConverter Pro'");
  cards.push('END'.padEnd(80));
  let headerBlock = Buffer.from(cards.join(''), 'latin1');
  const padded = Math.ceil(headerBlock.length / 2880) * 2880;
  headerBlock = Buffer.concat([headerBlock, Buffer.alloc(padded - headerBlock.length)]);
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = (fdata[i * 3] + fdata[i * 3 + 1] + fdata[i * 3 + 2]) / 3;
    data.writeFloatBE(v, i * 4);
  }
  return Buffer.concat([headerBlock, data]);
}

/* ================= SGI / RGB / RGBA ================= */
async function encSgi(img, opts, forceChannels) {
  const w = img.width, h = img.height;
  const alpha = forceChannels ? forceChannels === 4 : hasAlpha(img);
  const z = alpha ? 4 : 3;
  const rgba = alpha ? img.rgba : U.flatten(img.rgba, w, h, opts.background);
  const head = Buffer.alloc(512);
  head.writeUInt16BE(474, 0);
  head.writeUInt16BE(1, 2); // RLE
  head.writeUInt16BE(1, 4); // bpc
  head.writeUInt16BE(3, 6); // dimension
  head.writeUInt16BE(w, 8);
  head.writeUInt16BE(h, 10);
  head.writeUInt16BE(z, 12);
  head.writeUInt16BE(0, 14); // pixmin
  head.writeUInt16BE(255, 16); // pixmax
  head.write('ImageConverter Pro', 20, 'latin1');
  head.writeUInt32BE(0, 500); // colormap normal
  const tables = Buffer.alloc(h * z * 8);
  const bodies = [];
  let bodyOff = 512 + tables.length;
  const planes = [Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w)];
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < z; c++) {
      const row = (h - 1 - y) * w * 4; // SGI يخزن من الأسفل
      for (let x = 0; x < w; x++) planes[c][x] = rgba[row + x * 4 + c];
      const body = sgiRleRow(planes[c]);
      tables.writeUInt32BE(bodyOff, (y * z + c) * 8);
      tables.writeUInt32BE(body.length, (y * z + c) * 8 + 4);
      bodies.push(body);
      bodyOff += body.length;
    }
  }
  return Buffer.concat([head, tables, ...bodies]);
}
function sgiRleRow(plane) {
  const out = [];
  const w = plane.length;
  let x = 0;
  while (x < w) {
    let run = 1;
    while (x + run < w && run < 126 && plane[x + run] === plane[x]) run++;
    if (run >= 2) {
      out.push(128 + run - 1, plane[x]);
      x += run;
    } else {
      let lit = 1;
      while (x + lit < w && lit < 126) {
        if (x + lit + 1 < w && plane[x + lit] === plane[x + lit + 1]) break;
        lit++;
      }
      out.push(lit - 1);
      for (let k = 0; k < lit; k++) out.push(plane[x + k]);
      x += lit;
    }
  }
  return Buffer.from(out);
}

/* ================= DDS ================= */
async function encDds(img) {
  const w = img.width, h = img.height;
  const alpha = hasAlpha(img);
  const header = Buffer.alloc(128);
  header.write('DDS ', 0, 'latin1');
  header.writeUInt32LE(124, 4);
  header.writeUInt32LE(0x0000100f, 8); // caps: complex|texture|mipmap? نكتب texture فقط
  header.writeUInt32LE(h, 12);
  header.writeUInt32LE(w, 16);
  header.writeUInt32LE(w * h * 4, 20); // pitch
  header.writeUInt32LE(0, 24); // mipmaps
  header.writeUInt32LE(0, 28);
  // pixel format
  header.writeUInt32LE(32, 76);
  header.writeUInt32LE(alpha ? 0x41 : 0x40, 80); // DDPF_RGBA / DDPF_RGB
  header.writeUInt32LE(32, 88);
  header.writeUInt32LE(0x00ff0000, 92);
  header.writeUInt32LE(0x0000ff00, 96);
  header.writeUInt32LE(0x000000ff, 100);
  header.writeUInt32LE(alpha ? 0xff000000 : 0, 104);
  header.writeUInt32LE(0x1000, 108); // DDSCAPS_TEXTURE
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h * 4; i++) data[i] = img.rgba[i];
  return Buffer.concat([header, data]);
}

/* ================= SVG ================= */
let _potrace = null;
async function potraceModule() {
  if (!_potrace) _potrace = require('potrace');
  return _potrace;
}
async function encSvg(img, opts) {
  if (opts.vectorize) {
    try {
      const potrace = await potraceModule();
      const png = await encPng(img, opts);
      const svg = await new Promise((resolve, reject) => {
        potrace.trace(png, {
          threshold: opts.threshold || 128,
          color: opts.vectorColor || '#000000',
          background: 'transparent',
          turdSize: 2,
        }, (err, svgStr) => (err ? reject(err) : resolve(svgStr)));
      });
      return Buffer.from(svg, 'utf8');
    } catch (e) {
      // فشل التحويل المتجهي → تضمين
    }
  }
  const png = await encPng(img, opts);
  const b64 = png.toString('base64');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${img.width}" height="${img.height}" viewBox="0 0 ${img.width} ${img.height}">\n<image width="${img.width}" height="${img.height}" xlink:href="data:image/png;base64,${b64}"/>\n</svg>\n`;
  return Buffer.from(svg, 'utf8');
}

/* ================= PDF / AI ================= */
async function encPdf(img, opts, ext = 'pdf') {
  const { PDFDocument } = require('pdf-lib');
  const w = img.width, h = img.height;
  const alpha = hasAlpha(img) && ALPHA_OK.has(ext);
  const pdf = await PDFDocument.create();
  if (ext === 'ai') {
    pdf.setTitle(img.meta.baseName || 'Image');
    pdf.setCreator('ImageConverter Pro');
  }
  let embedded;
  if (alpha) {
    const png = await encPng(img, opts);
    embedded = await pdf.embedPng(png);
  } else {
    const jpg = await sharpInput(U.flatten(img.rgba, w, h, opts.background), w, h)
      .jpeg({ quality: Math.max(opts.quality, 85), mozjpeg: true }).toBuffer();
    embedded = await pdf.embedJpg(jpg);
  }
  const page = pdf.addPage([w, h]);
  page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  const bytes = await pdf.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/* ================= EPS ================= */
async function encEps(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    rgb[i * 3] = rgba[p]; rgb[i * 3 + 1] = rgba[p + 1]; rgb[i * 3 + 2] = rgba[p + 2];
  }
  const ps = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%Creator: ImageConverter Pro',
    `%%BoundingBox: 0 0 ${w} ${h}`,
    `%%HiResBoundingBox: 0 0 ${w} ${h}`,
    '%%EndComments',
    '%%BeginProlog',
    '/imgstr 1 string def',
    '%%EndProlog',
    'gsave',
    `0 ${h} translate`,
    `${w} ${-h} scale`,
    `${w} ${h} 8`,
    `[${w} 0 0 ${h} 0 0]`,
    '{ currentfile imgstr readhexstring pop } false 3',
    'colorimage',
  ];
  const hex = rgb.toString('hex').toUpperCase();
  for (let i = 0; i < hex.length; i += 120) ps.push(hex.slice(i, i + 120));
  ps.push('grestore', '%%EOF', '');
  return Buffer.from(ps.join('\n'), 'latin1');
}

/* ================= WMF / EMF ================= */
async function encWmf(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const dib = buildDib(rgba, w, h, false);
  const records = [];
  const rec = (fn, params) => {
    const size = (3 + params.length) * 2;
    const b = Buffer.alloc(size);
    b.writeUInt32LE(size / 2, 0);
    b.writeUInt16LE(fn, 4);
    params.forEach((p, i) => b.writeInt16LE(p, 6 + i * 2));
    records.push(b);
  };
  rec(0x020b, [0, 0]); // SETWINDOWORG y,x
  rec(0x020c, [h, w]); // SETWINDOWEXT y,x
  // STRETCHDIB: rop(low,high), usage, srcH, srcW, ySrc, xSrc, dstH, dstW, yDst, xDst, DIB
  const params = [0x0020, 0x00cc, 0, h, w, 0, 0, h, w, 0, 0];
  const sizeWords = 3 + params.length + dib.length / 2;
  const recBuf = Buffer.alloc(6 + params.length * 2 + dib.length);
  recBuf.writeUInt32LE(sizeWords, 0);
  recBuf.writeUInt16LE(0x0f43, 4);
  params.forEach((p, i) => recBuf.writeInt16LE(p, 6 + i * 2));
  dib.copy(recBuf, 6 + params.length * 2);
  records.push(recBuf);
  const eof = Buffer.alloc(6);
  eof.writeUInt32LE(3, 0);
  eof.writeUInt16LE(0, 4);
  records.push(eof);
  const body = Buffer.concat(records);
  const totalWords = 9 + body.length / 2;
  const stdHeader = Buffer.alloc(18);
  stdHeader.writeUInt16LE(1, 0); // type memory
  stdHeader.writeUInt16LE(9, 2);
  stdHeader.writeUInt16LE(0x0300, 4);
  stdHeader.writeUInt32LE(totalWords, 6);
  stdHeader.writeUInt16LE(0, 10);
  stdHeader.writeUInt32LE(totalWords, 12); // MaxRecord (32-بت)
  stdHeader.writeUInt16LE(0, 16);
  // Placeable header
  const ph = Buffer.alloc(22);
  ph.writeUInt32LE(0x9ac6cdd7, 0);
  ph.writeUInt16LE(0, 4);
  ph.writeInt16LE(0, 6); ph.writeInt16LE(0, 8);
  ph.writeInt16LE(w, 10); ph.writeInt16LE(h, 12);
  ph.writeUInt16LE(96, 14); // وحدات لكل بوصة
  ph.writeUInt32LE(0, 16);
  let checksum = 0;
  for (let i = 0; i < 10; i++) checksum ^= ph.readInt16LE(i * 2);
  ph.writeInt16LE(checksum, 20);
  return Buffer.concat([ph, stdHeader, body]);
}
async function encEmf(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const dib = buildDib(rgba, w, h, false);
  const cbBmi = 40; // 24-بت BI_RGB بلا لوحة ألوان
  const cbBits = dib.length - cbBmi;
  const recSize = 80 + cbBmi + cbBits;
  const total = 88 + recSize + 20;
  const buf = Buffer.alloc(total);
  let p = 0;
  // EMR_HEADER
  buf.writeUInt32LE(1, p); buf.writeUInt32LE(88, p + 4);
  buf.writeInt32LE(0, p + 8); buf.writeInt32LE(0, p + 12);
  buf.writeInt32LE(w - 1, p + 16); buf.writeInt32LE(h - 1, p + 20);
  buf.writeInt32LE(0, p + 24); buf.writeInt32LE(0, p + 28);
  buf.writeInt32LE(Math.round(w * 2540 / 96), p + 32);
  buf.writeInt32LE(Math.round(h * 2540 / 96), p + 36);
  buf.writeUInt32LE(0x464d4520, p + 40); // ' EMF'
  buf.writeUInt32LE(0x00010000, p + 44);
  buf.writeUInt32LE(total, p + 48);
  buf.writeUInt32LE(3, p + 52); // records
  buf.writeUInt16LE(1, p + 56); // handles
  buf.writeUInt16LE(0, p + 58); // reserved
  buf.writeUInt32LE(0, p + 60); // nDescription
  buf.writeUInt32LE(0, p + 64); // offDescription
  buf.writeUInt32LE(0, p + 68); // nPalEntries
  buf.writeInt32LE(1920, p + 72); buf.writeInt32LE(1080, p + 76); // szlDevice
  buf.writeInt32LE(508, p + 80); buf.writeInt32LE(285, p + 84); // szlMillimeters
  p = 88;
  // EMR_STRETCHDIBITS
  buf.writeUInt32LE(81, p); buf.writeUInt32LE(recSize, p + 4);
  buf.writeInt32LE(0, p + 8); buf.writeInt32LE(0, p + 12);
  buf.writeInt32LE(w - 1, p + 16); buf.writeInt32LE(h - 1, p + 20);
  buf.writeInt32LE(0, p + 24); buf.writeInt32LE(0, p + 28); // xDest,yDest
  buf.writeInt32LE(0, p + 32); buf.writeInt32LE(0, p + 36); // xSrc,ySrc
  buf.writeInt32LE(w, p + 40); buf.writeInt32LE(h, p + 44); // cxSrc,cySrc
  buf.writeUInt32LE(80, p + 48); // offBmiSrc
  buf.writeUInt32LE(cbBmi, p + 52);
  buf.writeUInt32LE(80 + cbBmi, p + 56); // offBitsSrc
  buf.writeUInt32LE(cbBits, p + 60);
  buf.writeUInt32LE(0, p + 64); // usage
  buf.writeUInt32LE(0x00cc0020, p + 68); // SRCCOPY
  buf.writeInt32LE(w, p + 72); buf.writeInt32LE(h, p + 76); // cxDest,cyDest
  dib.copy(buf, p + 80);
  p += recSize;
  // EMR_EOF
  buf.writeUInt32LE(14, p); buf.writeUInt32LE(20, p + 4);
  buf.writeUInt32LE(0, p + 8); buf.writeUInt32LE(16, p + 12); buf.writeUInt32LE(20, p + 16);
  return buf;
}

/* ================= PSD / PSB ================= */
async function encPsd(img, opts, psb = false) {
  const { createCanvas } = require('@napi-rs/canvas');
  const agPsd = require('ag-psd');
  const { initializeCanvas } = require('ag-psd/initialize-canvas');
  initializeCanvas((w2, h2) => createCanvas(w2, h2));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.rgba);
  ctx.putImageData(id, 0, 0);
  const psd = {
    width: img.width,
    height: img.height,
    channels: 3,
    bits: 8,
    colorMode: 3, // RGB
    canvas,
  };
  const out = agPsd.writePsd(psd, { psb, compress: true, generateThumbnail: false });
  return Buffer.from(out);
}

/* ================= XCF ================= */
async function encXcf(img) {
  const w = img.width, h = img.height;
  const chunks = [];
  const head = Buffer.alloc(14 + 12);
  head.write('gimp xcf v001\0', 0, 'latin1');
  head.writeUInt32LE(w, 14);
  head.writeUInt32LE(h, 18);
  head.writeUInt32LE(0, 22); // RGB
  chunks.push(head);
  const propsEnd = Buffer.alloc(8); // PROP_END
  chunks.push(propsEnd);
  // تخطيط: [ترويسة+خصائص] [إزاحة طبقة u32] [0] [قنوات 0] [Layer] [Hierarchy] [Level] [بلاطات]
  const layerOffPos = chunks.reduce((a, b) => a + b.length, 0);
  const stub = Buffer.alloc(4 + 4 + 4);
  chunks.push(stub); // أماكن الإزاحات
  const layerPos = chunks.reduce((a, b) => a + b.length, 0);
  // Layer
  const name = Buffer.from('Image\0', 'latin1');
  const layer = [];
  const push32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); layer.push(b); };
  push32(w); push32(h); push32(1); // RGBA
  push32(name.length); layer.push(name);
  const prop = (id, payload) => { push32(id); push32(payload.length); layer.push(payload); };
  prop(6, Buffer.from([255, 0, 0, 0])); // OPACITY
  prop(8, Buffer.from([1])); // VISIBLE
  prop(15, (() => { const b = Buffer.alloc(8); b.writeInt32LE(0, 0); b.writeInt32LE(0, 4); return b; })()); // OFFSETS
  prop(17, Buffer.from([1])); // COMPRESSION RLE
  prop(0, Buffer.alloc(0)); // END
  const hierarchyPosRel = layer.reduce((a, b) => a + b.length, 0);
  push32(0); push32(0); // hierarchy ptr (يُرقَّع), mask
  const layerBuf = Buffer.concat(layer);
  chunks.push(layerBuf);
  // Hierarchy
  const hier = [];
  const hpush32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); hier.push(b); };
  hpush32(w); hpush32(h); hpush32(4);
  const levelPosRel = hier.reduce((a, b) => a + b.length, 0);
  hpush32(0); hpush32(0); // level ptr (يُرقَّع), نهاية
  const hierBuf = Buffer.concat(hier);
  chunks.push(hierBuf);
  // Level + بلاطات
  const TILE = 64;
  const cols = Math.ceil(w / TILE), rows = Math.ceil(h / TILE);
  const tileCount = cols * rows;
  const level = [];
  const lpush32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); level.push(b); };
  lpush32(w); lpush32(h);
  const tilesStartRel = level.length * 4 + tileCount * 4 + 4;
  for (let i = 0; i < tileCount; i++) lpush32(0);
  lpush32(0); // نهاية
  const levelHeadBuf = Buffer.concat(level);
  // بلاطات
  const tiles = [];
  const rgba = img.rgba;
  for (let ty = 0; ty < h; ty += TILE) {
    for (let tx = 0; tx < w; tx += TILE) {
      const tw = Math.min(TILE, w - tx), th = Math.min(TILE, h - ty);
      const tileRgba = Buffer.alloc(tw * th * 4);
      for (let y = 0; y < th; y++) {
        const src = ((ty + y) * w + tx) * 4;
        rgba.copy(tileRgba, y * tw * 4, src, src + tw * 4);
      }
      tiles.push(U.xcfRleTile(tileRgba, tw, th));
    }
  }
  const levelAndTiles = Buffer.concat([levelHeadBuf, ...tiles]);
  chunks.push(levelAndTiles);
  const whole = Buffer.concat(chunks);
  // ترقيع الإزاحات
  const layerOff = layerPos;
  const hierarchyOff = layerPos + hierarchyPosRel;
  const levelOff = layerPos + hierarchyPosRel + levelPosRel;
  whole.writeUInt32LE(layerOff, layerOffPos);
  whole.writeUInt32LE(0, layerOffPos + 4);
  whole.writeUInt32LE(0, layerOffPos + 8);
  whole.writeUInt32LE(hierarchyOff, layerOff + hierarchyPosRel);
  whole.writeUInt32LE(levelOff, layerOff + hierarchyPosRel + levelPosRel);
  // إزاحات البلاطات
  const tilesAbsStart = levelOff + tilesStartRel;
  let tOff = tilesAbsStart;
  let idx = 0;
  for (let ty = 0; ty < h; ty += TILE) {
    for (let tx = 0; tx < w; tx += TILE) {
      whole.writeUInt32LE(tOff, levelOff + 8 + idx * 4);
      tOff += tiles[idx].length;
      idx++;
    }
  }
  return whole;
}

/* ================= DNG (خطي) ================= */
async function encDng(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    rgb[i * 3] = rgba[p]; rgb[i * 3 + 1] = rgba[p + 1]; rgb[i * 3 + 2] = rgba[p + 2];
  }
  const makeAscii = (s) => Buffer.from(s + '\0', 'latin1');
  const make = makeAscii('ImageConverter');
  const model = makeAscii('Pro');
  const unique = makeAscii('ImageConverter Pro');
  // عناصر IFD: [tag, type, count, valueBytes, isOffset]
  const entries = [];
  const types = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, SRATIONAL: 10 };
  const entry = (tag, type, count, payload, inline) => entries.push({ tag, type, count, payload, inline });
  entry(254, types.LONG, 1, u32b(0), true); // NewSubFileType
  entry(256, types.LONG, 1, u32b(w), true);
  entry(257, types.LONG, 1, u32b(h), true);
  entry(258, types.SHORT, 3, u16b(8, 8, 8), true);
  entry(259, types.SHORT, 1, u16b(1), true);
  entry(262, types.SHORT, 1, u16b(34892), true); // LinearRaw
  entry(271, types.ASCII, make.length, make, false);
  entry(272, types.ASCII, model.length, model, false);
  entry(273, types.LONG, 1, null, true); // StripOffsets — يُرقَّع
  entry(277, types.SHORT, 1, u16b(3), true);
  entry(278, types.LONG, 1, u32b(h), true);
  entry(279, types.LONG, 1, u32b(rgb.length), true);
  entry(284, types.SHORT, 1, u16b(1), true);
  entry(339, types.SHORT, 3, u16b(1, 1, 1), true); // SampleFormat uint
  entry(50706, types.BYTE, 4, Buffer.from([1, 4, 0, 0]), true); // DNGVersion
  entry(50707, types.BYTE, 4, Buffer.from([1, 1, 0, 0]), true);
  entry(50708, types.ASCII, unique.length, unique, false);
  entry(50721, types.SRATIONAL, 9, colorMatrix(), false); // ColorMatrix1
  entry(50778, types.SHORT, 1, u16b(21), true); // CalibrationIlluminant1 = D65
  entry(50714, types.RATIONAL, 3, Buffer.concat([rat(1, 1), rat(1, 1), rat(1, 1)]), false); // AsShotNeutral
  entries.sort((a, b) => a.tag - b.tag);
  function u32b(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; }
  function u16b(...vs) { const b = Buffer.alloc(vs.length * 2); vs.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b; }
  function rat(n, d) { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.writeUInt32LE(d, 4); return b; }
  function srat(n, d) { const b = Buffer.alloc(8); b.writeInt32LE(n, 0); b.writeInt32LE(d, 4); return b; }
  function colorMatrix() {
    // sRGB (D65) -> XYZ
    const m = [
      [0.4124, 0.3576, 0.1805],
      [0.2126, 0.7152, 0.0722],
      [0.0193, 0.1192, 0.9505],
    ];
    const parts = [];
    for (const row of m) for (const v of row) parts.push(srat(Math.round(v * 10000), 10000));
    return Buffer.concat(parts);
  }
  const ifdCount = entries.length;
  const ifdOff = 8;
  const ifdSize = 2 + ifdCount * 12 + 4;
  // بيانات أكبر من 4 بايت تخزن بعد IFD
  const extraBlobs = [];
  let extraOff = ifdOff + ifdSize;
  const entryBufs = [];
  for (const e of entries) {
    let payload = e.payload;
    let inlineVal;
    if (payload === null) {
      // StripOffsets — يُرقَّع لاحقاً
      inlineVal = Buffer.alloc(4);
    } else if (e.inline && payload.length <= 4) {
      inlineVal = Buffer.alloc(4);
      payload.copy(inlineVal);
    } else {
      inlineVal = u32b(extraOff + extraBlobs.reduce((a, b) => a + b.length, 0));
      extraBlobs.push(payload);
    }
    const eb = Buffer.alloc(12);
    eb.writeUInt16LE(e.tag, 0);
    eb.writeUInt16LE(e.type, 2);
    eb.writeUInt32LE(e.count, 4);
    inlineVal.copy(eb, 8);
    entryBufs.push(eb);
  }
  const extraData = Buffer.concat(extraBlobs);
  const stripOff = ifdOff + ifdSize + extraData.length;
  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(ifdCount, 0);
  entryBufs.forEach((eb, i) => eb.copy(ifd, 2 + i * 12));
  ifd.writeUInt32LE(0, 2 + ifdCount * 12); // لا IFD تالٍ
  const out = Buffer.concat([header, ifd, extraData, rgb]);
  // رقّع StripOffsets (العنصر المرتب حسب tag: 273)
  const idx = entryBufs.findIndex((eb) => eb.readUInt16LE(0) === 273);
  if (idx !== -1) out.writeUInt32LE(stripOff, 8 + 2 + idx * 12 + 8);
  return out;
}

/* ================= RAW (بكسلات) ================= */
async function encRawPixels(img, opts) {
  const w = img.width, h = img.height;
  const rgba = U.flatten(img.rgba, w, h, opts.background);
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    out[i * 3] = rgba[p]; out[i * 3 + 1] = rgba[p + 1]; out[i * 3 + 2] = rgba[p + 2];
  }
  return out;
}

/* ================= HEIC عبر libheif إن توفر مشفّر ================= */
let _heicEncoderAvailable = null;
async function heicEncoderAvailable() {
  if (_heicEncoderAvailable !== null) return _heicEncoderAvailable;
  try {
    const libheif = require('libheif-js');
    _heicEncoderAvailable = typeof libheif.HeifEncoder === 'function';
  } catch (_) {
    _heicEncoderAvailable = false;
  }
  return _heicEncoderAvailable;
}
async function encHeic(img, opts) {
  if (!(await heicEncoderAvailable())) {
    const err = new Error('HEIC_HEIF_ENCODER_MISSING');
    throw err;
  }
  const libheif = require('libheif-js');
  const png = await encPng(img, opts);
  return png; // لن يُستدعى فعلياً إلا إذا توفر المشفّر (يُدار عبر formats.js)
}

/* سجل أجهزة الترميز */
const ENCODERS = {
  jpg: encJpeg, jpeg: encJpeg, jpe: encJpeg, jfif: encJpeg,
  png: encPng, webp: encWebp, avif: encAvif, gif: encGif,
  tif: encTiff, tiff: encTiff,
  bmp: encBmp, dib: encDib,
  ico: encIco, cur: encCur, icns: encIcns,
  svg: encSvg,
  jxl: null, // يُربط ديناميكياً
  psd: (img, o) => encPsd(img, o, false),
  psb: (img, o) => encPsd(img, o, true),
  xcf: encXcf, ai: (img, o) => encPdf(img, o, 'ai'), eps: encEps,
  wmf: encWmf, emf: encEmf,
  pdf: (img, o) => encPdf(img, o, 'pdf'),
  dds: encDds, tga: encTga, pcx: encPcx,
  ppm: encPnm, pnm: encPnmGeneric, pgm: encPgm, pbm: encPbm, pam: encPam,
  hdr: encHdr, exr: encExr,
  fits: encFits, 'fits.gz': encFits,
  sgi: (img, o) => encSgi(img, o, 3),
  rgb: (img, o) => encSgi(img, o, 3),
  rgba: (img, o) => encSgi(img, o, 4),
  dng: encDng, raw: encRawPixels,
};

/** ترميز JXL ديناميكي */
async function encJxl(img, opts) {
  const mod = await import('@jsquash/jxl');
  const imageData = {
    data: new Uint8ClampedArray(img.rgba),
    width: img.width,
    height: img.height,
    colourSpace: 'srgb',
  };
  try {
    return Buffer.from(await mod.encode(imageData, { quality: opts.quality, effort: 5 }));
  } catch (e) {
    const pkgDir = require('path').dirname(require.resolve('@jsquash/jxl/package.json'));
    const wasmPath = require('path').join(pkgDir, 'codec', 'enc', 'jxl_enc.wasm');
    await mod.init({ locateFile: () => wasmPath });
    return Buffer.from(await mod.encode(imageData, { quality: opts.quality, effort: 5 }));
  }
}
ENCODERS.jxl = encJxl;

module.exports = {
  ENCODERS, FLATTENED, ALPHA_OK, hasAlpha, prepareRgba, buildDib,
  encJpeg, encPng, encPdf, encSvg, encPsd, encXcf, encDng, encEps, encWmf, encEmf, encExr, encHdr, encFits,
  heicEncoderAvailable,
};

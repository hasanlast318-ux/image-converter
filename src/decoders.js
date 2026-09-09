'use strict';
/* فك ترميز جميع الصيغ المدعومة إلى التمثيل الأساسي (RGBA 8-بت + عوامات خطية اختيارية) */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const U = require('./utils');
const { makeImage } = U;

/* ================= sharp: الصيغ الشائعة ================= */
async function decodeWithSharp(buf) {
  const { data, info } = await U.sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = makeImage(info.width, info.height);
  img.rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  return img;
}
async function decodeSvg(buf) {
  return decodeWithSharp(buf);
}
async function decodeTiff(buf) {
  try { return await decodeWithSharp(buf); } catch (e) {
    const UTIF = require('utif');
    const ifds = UTIF.decode(buf);
    UTIF.decodeImage(buf, ifds[0], ifds);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const img = makeImage(ifds[0].width, ifds[0].height);
    img.rgba = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
    return img;
  }
}

/* ================= BMP / DIB ================= */
function parseDib(buf, off, isDib) {
  // يعيد {width,height,rgba} من DIB مُعبأ (بدون/مع ترويسة ملف BMP)
  let p = off;
  const hdrSize = buf.readUInt32LE(p);
  if (![12, 40, 52, 56, 64, 108, 124].includes(hdrSize)) throw new Error('ترويسة DIB غير صالحة');
  let w, h, planes, bpp, comp = 0, clrUsed = 0, masks = null;
  if (hdrSize === 12) {
    w = buf.readUInt16LE(p + 4); h = buf.readUInt16LE(p + 6);
    planes = buf.readUInt16LE(p + 8); bpp = buf.readUInt16LE(p + 10);
  } else {
    w = buf.readInt32LE(p + 4); h = Math.abs(buf.readInt32LE(p + 8));
    planes = buf.readUInt16LE(p + 12); bpp = buf.readUInt16LE(p + 14);
    comp = buf.readUInt32LE(p + 16); clrUsed = buf.readUInt32LE(p + 32);
    if ((hdrSize === 40 && comp === 3) || hdrSize >= 52) {
      masks = [buf.readUInt32LE(p + 40), buf.readUInt32LE(p + 44), buf.readUInt32LE(p + 48), hdrSize >= 56 ? buf.readUInt32LE(p + 52) : 0xff000000];
    }
  }
  if (w <= 0 || h <= 0 || w > 30000 || h > 30000) throw new Error('أبعاد BMP غير منطقية');
  const topDown = buf.readInt32LE(off + 8) < 0 && hdrSize !== 12;
  let palOff = p + hdrSize;
  if (comp === 3 && hdrSize === 40) palOff += 12; // أقنعة BITFIELDS
  const palette = [];
  const entrySize = hdrSize === 12 ? 3 : 4;
  const palCount = bpp <= 8 ? (clrUsed || (1 << bpp)) : 0;
  for (let i = 0; i < palCount; i++) {
    const b = buf[palOff + i * entrySize], g = buf[palOff + i * entrySize + 1], r = buf[palOff + i * entrySize + 2];
    palette.push([r, g, b]);
  }
  const pxOff = palOff + palCount * entrySize;
  const img = makeImage(w, h);
  const rgba = img.rgba;
  const rowSize = Math.floor((bpp * w + 31) / 32) * 4;

  if (comp === 0 || comp === 3) { // BI_RGB / BI_BITFIELDS
    if (bpp === 32 || bpp === 16) {
      const [mr, mg, mb, ma] = masks && bpp === 32 ? masks : bpp === 16 ? [0x7c00, 0x03e0, 0x001f, 0x8000] : [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000];
      const sr = shiftOf(mr), sg = shiftOf(mg), sb = shiftOf(mb), sa = shiftOf(ma);
      for (let y = 0; y < h; y++) {
        const row = pxOff + y * rowSize;
        for (let x = 0; x < w; x++) {
          const i = row + x * (bpp / 8);
          const v = bpp === 32 ? buf.readUInt32LE(i) : buf.readUInt16LE(i);
          const d = y * w + x;
          rgba[d * 4] = scaleChan((v & mr) >>> sr, mr);
          rgba[d * 4 + 1] = scaleChan((v & mg) >>> sg, mg);
          rgba[d * 4 + 2] = scaleChan((v & mb) >>> sb, mb);
          rgba[d * 4 + 3] = ma ? scaleChan((v & ma) >>> sa, ma) : 255;
        }
      }
    } else if (bpp === 24) {
      for (let y = 0; y < h; y++) {
        const row = pxOff + y * rowSize;
        for (let x = 0; x < w; x++) {
          const i = row + x * 3;
          const d = y * w + x;
          rgba[d * 4] = buf[i + 2]; rgba[d * 4 + 1] = buf[i + 1]; rgba[d * 4 + 2] = buf[i]; rgba[d * 4 + 3] = 255;
        }
      }
    } else if (bpp === 8 || bpp === 4 || bpp === 1) {
      for (let y = 0; y < h; y++) {
        const row = pxOff + y * rowSize;
        for (let x = 0; x < w; x++) {
          let idx;
          if (bpp === 8) idx = buf[row + x];
          else if (bpp === 4) idx = (x % 2 === 0) ? (buf[row + (x >> 1)] >> 4) : (buf[row + (x >> 1)] & 0xf);
          else idx = (buf[row + (x >> 3)] >> (7 - (x & 7))) & 1;
          const c = palette[idx] || [0, 0, 0];
          const d = y * w + x;
          rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = 255;
        }
      }
    } else throw new Error(`عمق ألوان BMP ${bpp} غير مدعوم`);
  } else if (comp === 1 && bpp === 8) { // RLE8
    let ip = pxOff, x = 0, y = 0;
    while (ip < buf.length && y < h) {
      const cnt = buf[ip++]; const val = buf[ip++];
      if (cnt > 0) {
        for (let k = 0; k < cnt && x < w; k++) {
          const c = palette[val] || [0, 0, 0];
          const d = y * w + x++;
          rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = 255;
        }
      } else {
        if (val === 0) { x = 0; y++; }
        else if (val === 1) break;
        else if (val === 2) { x += buf[ip++]; y += buf[ip++]; }
        else {
          const n = val;
          for (let k = 0; k < n && x < w; k++) {
            const c = palette[buf[ip++]] || [0, 0, 0];
            const d = y * w + x++;
            rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = 255;
          }
          if (ip & 1) ip++;
        }
      }
    }
  } else if (comp === 2 && bpp === 4) { // RLE4
    let ip = pxOff, x = 0, y = 0;
    while (ip < buf.length && y < h) {
      const cnt = buf[ip++]; const val = buf[ip++];
      if (cnt > 0) {
        for (let k = 0; k < cnt && x < w; k++) {
          const idx = (k % 2 === 0) ? (val >> 4) : (val & 0xf);
          const c = palette[idx] || [0, 0, 0];
          const d = y * w + x++;
          rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = 255;
        }
      } else {
        if (val === 0) { x = 0; y++; }
        else if (val === 1) break;
        else if (val === 2) { x += buf[ip++]; y += buf[ip++]; }
        else {
          for (let k = 0; k < val && x < w; k++) {
            const byte = buf[ip + (k >> 1)];
            const idx = (k % 2 === 0) ? (byte >> 4) : (byte & 0xf);
            const c = palette[idx] || [0, 0, 0];
            const d = y * w + x++;
            rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = 255;
          }
          ip += Math.ceil(val / 2);
          if (ip & 1) ip++;
        }
      }
    }
  } else throw new Error(`ضغط BMP رقم ${comp} غير مدعوم`);

  if (topDown) {
    const flipped = makeImage(w, h);
    for (let y = 0; y < h; y++) flipped.rgba.set(rgba.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return flipped;
  }
  return img;
}
function shiftOf(mask) {
  if (!mask) return 0;
  let s = 0; let m = mask;
  while ((m & 1) === 0 && s < 32) { m >>>= 1; s++; }
  return s;
}
function scaleChan(v, mask) {
  const bits = Math.ceil(Math.log2(mask + 1));
  if (bits >= 8) return (v * 255) >> (bits - 8) & 255;
  return (v * 255) / ((1 << bits) - 1) | 0;
}
async function decodeBmp(buf) {
  if (buf.readUInt16LE(0) !== 0x4d42) throw new Error('ليس ملف BMP صالح');
  return parseDib(buf, 14, false);
}
async function decodeDib(buf) {
  const hdr = buf.readUInt32LE(0);
  if (![12, 40, 52, 56, 64, 108, 124].includes(hdr)) throw new Error('ليس ملف DIB صالح');
  return parseDib(buf, 0, true);
}

/* ================= ICO / CUR ================= */
async function decodeIcoCur(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.length < 6) throw new Error('ليس ملف ICO/CUR صالح');
  const type = buf.readUInt16LE(2);
  if (type !== 1 && type !== 2) throw new Error('ليس ملف ICO/CUR صالح');
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const w = buf[e] || 256, h = buf[e + 1] || 256;
    const size = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12);
    if (off + size > buf.length) continue;
    const area = w * h;
    if (!best || area > best.area) best = { area, w, h, size, off };
  }
  if (!best) throw new Error('لا توجد صور داخل الملف');
  const data = buf.subarray(best.off, best.off + best.size);
  if (data[0] === 0x89 && data[1] === 0x50) return decodeWithSharp(data); // PNG مدمج
  // BMP: الارتفاع في الترويسة = 2× الارتفاع الفعلي (بما فيها قناع AND)
  const clone = Buffer.from(data);
  const hdrSize = clone.readUInt32LE(0);
  const h2 = Math.abs(clone.readInt32LE(8));
  clone.writeInt32LE(h2 >> 1, 8);
  const img = parseDib(clone, 0, true);
  // قناع AND: شفافية للبكسلات ذات ألفا=0 فقط (عند 32بت ألفا موجودة أصلاً)
  return img;
}

/* ================= ICNS ================= */
const ICNS_TYPES = { icp4: 16, is32: 16, icp5: 32, il32: 32, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512, icp6: 64 };
async function decodeIcns(buf) {
  if (U.ascii(buf, 0, 4) !== 'icns') throw new Error('ليس ملف ICNS صالح');
  const total = buf.length;
  let p = 8;
  const entries = [];
  while (p + 8 <= total) {
    const type = U.ascii(buf, p, 4);
    const len = buf.readUInt32BE(p + 4);
    if (len < 8 || p + len > total) break;
    entries.push({ type, data: buf.subarray(p + 8, p + len) });
    p += len;
  }
  if (!entries.length) throw new Error('لا توجد أيقونات داخل ملف ICNS');
  // ابحث عن أكبر إدخال حديث (PNG/JP2)
  entries.sort((a, b) => (ICNS_TYPES[b.type] || 0) - (ICNS_TYPES[a.type] || 0));
  for (const e of entries) {
    if (!ICNS_TYPES[e.type]) continue;
    const d = e.data;
    try {
      if (d[0] === 0x89 && d[1] === 0x50) return await decodeWithSharp(d);
      if (d[0] === 0xff && d[1] === 0xd8) return await decodeWithSharp(d);
      if (d.readUInt32BE(0) === 0x0000000c && U.ascii(d, 4, 4) === 'jp2 ') return await decodeJp2(d);
      if ((ICNS_TYPES[e.type]) && (e.type === 'is32' || e.type === 'il32')) continue; // RLE قديم — تخطَّ
    } catch (_) { /* التالي */ }
  }
  throw new Error('تعذر فك ترميز أي إدخال داخل ICNS');
}

/* ================= HEIC / HEIF ================= */
let _heicDecode = null;
async function decodeHeic(buf) {
  if (!_heicDecode) _heicDecode = require('heic-decode');
  const res = await _heicDecode.decode({ buffer: buf });
  const img = makeImage(res.width, res.height);
  img.rgba = new Uint8ClampedArray(res.data);
  return img;
}

/* ================= JPEG XL ================= */
let _jxl = null;
async function jxlModule() {
  if (_jxl) return _jxl;
  const mod = await import('@jsquash/jxl');
  _jxl = mod;
  return mod;
}
async function decodeJxl(buf) {
  const mod = await jxlModule();
  let imageData;
  try {
    imageData = await mod.decode(U.u8ToBuffer(buf));
  } catch (e) {
    // إعادة المحاولة مع تحديد مسار wasm يدوياً
    const pkgDir = path.dirname(require.resolve('@jsquash/jxl/package.json'));
    const wasmPath = path.join(pkgDir, 'codec', 'dec', 'jxl_dec.wasm');
    await mod.init({ locateFile: () => wasmPath });
    imageData = await mod.decode(U.u8ToBuffer(buf));
  }
  const img = makeImage(imageData.width, imageData.height);
  img.rgba = new Uint8ClampedArray(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
  return img;
}

/* ================= JPEG 2000 (jp2/j2k/jpf/jpx/jpm/mj2) ================= */
function extractJ2kCodestream(buf) {
  // بداية تدفق J2K خام
  if (buf[0] === 0xff && buf[1] === 0x4f && buf[2] === 0xff && buf[3] === 0x51) return { stream: buf, kind: 'j2k' };
  // ابحث عن صندوق jp2c
  const idx = U.findAscii(buf, 'jp2c', 0, Math.min(buf.length - 4, 1 << 22));
  if (idx !== -1) {
    // قد يكون هناك مؤشرات إضافية بعد jp2c قبل البيانات (mjp2 يحتوي استدلالات)
    let off = idx + 4;
    if (off + 8 <= buf.length) {
      const d0 = buf[off];
      if (d0 === 0xff && buf[off + 1] === 0x4f) return { stream: buf.subarray(off), kind: 'jp2' };
      // الصندوق: طول u32 ثم البيانات
      off += 0; // البيانات تلي الوسم مباشرة في معظم الملفات
    }
    return { stream: buf.subarray(idx + 4), kind: 'jp2' };
  }
  // mj2: تدفق داخل صندوق mdat
  const mdat = U.findAscii(buf, 'mdat');
  if (mdat !== -1) {
    for (let i = mdat; i < Math.min(buf.length - 4, mdat + 64); i++) {
      if (buf[i] === 0xff && buf[i + 1] === 0x4f) return { stream: buf.subarray(i), kind: 'jp2' };
    }
  }
  throw new Error('تعذر العثور على تدفق JPEG 2000 داخل الملف');
}
let _openjpeg = null;
async function decodeJp2(buf) {
  if (!_openjpeg) _openjpeg = require('openjpeg');
  const { stream, kind } = extractJ2kCodestream(Buffer.from(buf));
  let res;
  try { res = _openjpeg(Buffer.from(stream), kind); }
  catch (e) { res = _openjpeg(Buffer.from(stream), kind === 'j2k' ? 'jp2' : 'j2k'); }
  if (!res || !res.width) throw new Error('فشل فك ترميز JPEG 2000');
  const { width: w, height: h } = res;
  const data = res.data;
  const img = makeImage(w, h);
  const rgba = img.rgba;
  const px = data.length / (w * h);
  if (px === 6) { // 16-بت BE
    for (let i = 0, p = 0; i < w * h * 6; i += 6, p += 4) {
      rgba[p] = (data[i] << 8) | data[i + 1];
      rgba[p + 1] = (data[i + 2] << 8) | data[i + 3];
      rgba[p + 2] = (data[i + 4] << 8) | data[i + 5];
      rgba[p + 3] = 255;
    }
  } else if (px === 3 || px === 4) {
    for (let i = 0, p = 0; i < w * h * px; i += px, p += 4) {
      rgba[p] = data[i]; rgba[p + 1] = data[i + 1]; rgba[p + 2] = data[i + 2];
      rgba[p + 3] = px === 4 ? data[i + 3] : 255;
    }
  } else if (px === 1) {
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      rgba[p] = rgba[p + 1] = rgba[p + 2] = data[i]; rgba[p + 3] = 255;
    }
  } else if (px === 2) { // 16-بت رمادي BE
    for (let i = 0, p = 0; i < w * h * 2; i += 2, p += 4) {
      const v = (data[i] << 8) | data[i + 1];
      rgba[p] = rgba[p + 1] = rgba[p + 2] = v >> 8; rgba[p + 3] = 255;
    }
  } else throw new Error(`عدد قنوات JPEG 2000 غير متوقع (${px})`);
  return img;
}

/* ================= RAW (كاميرات) عبر libraw-wasm ================= */
let _LibRaw = null;
async function decodeRaw(buf) {
  if (!_LibRaw) _LibRaw = (await import('libraw-wasm')).default;
  const raw = new _LibRaw();
  try {
    await raw.open(U.u8ToBuffer(buf), {
      useCameraWb: true,
      outputColor: 1, // sRGB
      outputBps: 8,
      userFlip: -1, // استخدم اتجاه الكاميرا
      userQual: 3,
    });
    let data;
    try { data = await raw.imageData(); } catch (e) {
      // جرّب الصورة المصغرة المدمجة
      const thumb = await raw.thumbnailData();
      if (thumb && thumb.format === 'jpeg') return decodeWithSharp(Buffer.from(thumb.data));
      throw e;
    }
    const { width: w, height: h, colors, bits } = data;
    const img = makeImage(w, h);
    const src = data.data;
    const rgba = img.rgba;
    if (colors === 3) {
      if (bits === 8) {
        for (let i = 0, p = 0; i < w * h * 3; i += 3, p += 4) {
          rgba[p] = src[i]; rgba[p + 1] = src[i + 1]; rgba[p + 2] = src[i + 2]; rgba[p + 3] = 255;
        }
      } else {
        for (let i = 0, p = 0; i < w * h * 3; i += 3, p += 4) {
          rgba[p] = src[i] >> 8; rgba[p + 1] = src[i + 1] >> 8; rgba[p + 2] = src[i + 2] >> 8; rgba[p + 3] = 255;
        }
      }
    } else if (colors === 1) {
      for (let i = 0, p = 0; i < w * h; i++, p += 4) { rgba[p] = rgba[p + 1] = rgba[p + 2] = src[i]; rgba[p + 3] = 255; }
    } else if (colors === 4) {
      for (let i = 0, p = 0; i < w * h * 4; i += 4, p += 4) {
        rgba[p] = src[i] >> (bits === 8 ? 0 : 8); rgba[p + 1] = src[i + 1] >> (bits === 8 ? 0 : 8);
        rgba[p + 2] = src[i + 2] >> (bits === 8 ? 0 : 8); rgba[p + 3] = 255;
      }
    } else throw new Error(`عدد قنوات RAW غير مدعوم: ${colors}`);
    return img;
  } finally {
    try { raw.dispose(); } catch (_) {}
  }
}

/* ================= PSD / PSB ================= */
let _psdReady = false;
async function psdInit() {
  if (_psdReady) return;
  const agPsd = require('ag-psd/initialize-canvas');
  const { createCanvas } = require('@napi-rs/canvas');
  agPsd.initializeCanvas((w, h) => createCanvas(w, h));
  _psdReady = true;
}
function canvasToImage(canvas) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const img = makeImage(canvas.width, canvas.height);
  img.rgba = new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength);
  return img;
}
function compositePsdLayers(psd) {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(psd.width, psd.height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, psd.width, psd.height);
  const drawLayers = (children) => {
    if (!children) return;
    for (const layer of children) {
      if (layer.hidden !== undefined && layer.hidden === true) continue;
      if (layer.children) { drawLayers(layer.children); continue; }
      if (!layer.canvas) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
      ctx.globalCompositeOperation = 'source-over';
      const x = layer.left || 0, y = layer.top || 0;
      ctx.drawImage(layer.canvas, x, y);
      ctx.restore();
    }
  };
  drawLayers(psd.children);
  return canvas;
}
async function decodePsd(buf) {
  await psdInit();
  const agPsd = require('ag-psd');
  const psd = agPsd.readPsd(U.u8ToBuffer(buf), { useImageData: false });
  let canvas = psd.canvas;
  if (!canvas && psd.children) canvas = compositePsdLayers(psd);
  if (!canvas && psd.imageData) {
    const img = makeImage(psd.imageData.width, psd.imageData.height);
    img.rgba = new Uint8ClampedArray(psd.imageData.data.buffer ? psd.imageData.data.buffer.slice(psd.imageData.data.byteOffset, psd.imageData.data.byteOffset + psd.imageData.data.byteLength) : psd.imageData.data.slice());
    return img;
  }
  if (!canvas) throw new Error('ملف PSD فارغ أو غير مدعوم');
  return canvasToImage(canvas);
}

/* ================= XCF (GIMP) ================= */
const XCF_PROP = { END: 0, OPACITY: 6, VISIBLE: 8, OFFSETS: 15, COMPRESSION: 17 };
async function decodeXcf(buf) {
  const head = U.ascii(buf, 0, 14);
  if (!head.startsWith('gimp xcf ')) throw new Error('ليس ملف XCF صالح');
  const verStr = U.ascii(buf, 9, 4);
  const version = verStr === 'file' ? 0 : parseInt(verStr.replace('v', ''), 10) || 0;
  const ptrSize = version >= 11 ? 8 : 4;
  let p = 14;
  const width = buf.readUInt32LE(p); p += 4;
  const height = buf.readUInt32LE(p); p += 4;
  const baseType = buf.readUInt32LE(p); p += 4;
  if (version >= 4) {
    p += 4; // precision
    if (version >= 11) p += 4; // byte order
  }
  // الخصائص
  let compression = 1;
  for (;;) {
    const id = buf.readUInt32LE(p); const len = buf.readUInt32LE(p + 4); p += 8;
    if (id === 0) break;
    if (id === XCF_PROP.COMPRESSION && len >= 1) compression = buf[p];
    p += len;
  }
  // قائمة الطبقات
  const layerOffsets = [];
  for (;;) {
    if (p + ptrSize > buf.length) break;
    const v = ptrSize === 8 ? Number(buf.readBigUInt64LE(p)) : buf.readUInt32LE(p);
    p += ptrSize;
    if (v === 0) break;
    layerOffsets.push(v);
  }
  if (!layerOffsets.length) throw new Error('لا توجد طبقات في ملف XCF');
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // ارسم الطبقات من الأسفل للأعلى (القائمة بترتيب من الأسفل)
  for (const off of layerOffsets) {
    try {
      const layer = readXcfLayer(buf, off, ptrSize, compression, baseType);
      if (!layer || layer.visible === false || !layer.image) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.mode !== undefined && layer.mode !== 28 && layer.mode > 3 && layer.mode !== 0) ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(layer.image, layer.x, layer.y);
      ctx.restore();
    } catch (_) { /* تجاوز طبقة معطوبة */ }
  }
  return canvasToImage(canvas);
}
function readXcfLayer(buf, off, ptrSize, compression, baseType) {
  let p = off;
  const w = buf.readUInt32LE(p); p += 4;
  const h = buf.readUInt32LE(p); p += 4;
  const type = buf.readUInt32LE(p); p += 4;
  const nameLen = buf.readUInt32LE(p); p += 4 + nameLen; // الطول يشمل \0
  const props = {};
  for (;;) {
    if (p + 8 > buf.length) break;
    const id = buf.readUInt32LE(p); const len = buf.readUInt32LE(p + 4); p += 8;
    if (id === 0) break;
    if (id === XCF_PROP.OPACITY && len === 4) props.opacity = buf.readUInt32LE(p) / 255;
    else if (id === XCF_PROP.VISIBLE && len === 1) props.visible = buf[p] !== 0;
    else if (id === XCF_PROP.OFFSETS && len === 8) { props.x = buf.readInt32LE(p); props.y = buf.readInt32LE(p + 4); }
    else if (id === XCF_PROP.COMPRESSION && len >= 1) props.compression = buf[p];
    p += len;
  }
  let hierarchyPtr = ptrSize === 8 ? Number(buf.readBigUInt64LE(p)) : buf.readUInt32LE(p); p += ptrSize;
  p += ptrSize; // layer mask (تُتجاهل)
  if (!hierarchyPtr || !w || !h) return null;
  // Hierarchy
  let q = hierarchyPtr;
  q += 12; // w,h,bpp
  let levelPtr = ptrSize === 8 ? Number(buf.readBigUInt64LE(q)) : buf.readUInt32LE(q);
  if (!levelPtr) return null;
  const bppByType = [3, 4, 1, 2, 1, 2][type] || 4;
  // Level
  let r = levelPtr + 8;
  const tiles = [];
  for (;;) {
    if (r + ptrSize > buf.length) break;
    const v = ptrSize === 8 ? Number(buf.readBigUInt64LE(r)) : buf.readUInt32LE(r);
    r += ptrSize;
    if (v === 0) break;
    tiles.push(v);
  }
  if (!tiles.length) return null;
  const px = Buffer.alloc(w * h * bppByType);
  const TILE = 64;
  const tileCompression = props.compression !== undefined ? props.compression : compression;
  let tileIdx = 0;
  for (let ty = 0; ty < h; ty += TILE) {
    for (let tx = 0; tx < w; tx += TILE) {
      if (tileIdx >= tiles.length) break;
      const tw = Math.min(TILE, w - tx), th = Math.min(TILE, h - ty);
      const tOff = tiles[tileIdx++];
      if (tileCompression === 0) {
        const need = tw * th * bppByType;
        buf.copy(px, (ty * w + tx) * bppByType, tOff, tOff + need);
      } else {
        const src = tileCompression === 2 ? zlib.inflateSync(buf.subarray(tOff)) : buf;
        const rel = tileCompression === 2 ? 0 : tOff;
        const { px: tilePx } = U.xcfRleUnTile(src, rel, tw, th, bppByType);
        for (let y = 0; y < th; y++) {
          tilePx.copy(px, ((ty + y) * w + tx) * bppByType, y * tw * bppByType, (y + 1) * tw * bppByType);
        }
      }
    }
  }
  // حوّل إلى canvas RGBA
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0; i < w * h; i++) {
    if (type === 1) { d[i * 4] = px[i * 4]; d[i * 4 + 1] = px[i * 4 + 1]; d[i * 4 + 2] = px[i * 4 + 2]; d[i * 4 + 3] = px[i * 4 + 3]; }
    else if (type === 0) { d[i * 4] = px[i * 3]; d[i * 4 + 1] = px[i * 3 + 1]; d[i * 4 + 2] = px[i * 3 + 2]; d[i * 4 + 3] = 255; }
    else if (type === 2) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i]; d[i * 4 + 3] = 255; }
    else if (type === 3) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i * 2]; d[i * 4 + 3] = px[i * 2 + 1]; }
    else { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i]; d[i * 4 + 3] = 255; }
  }
  ctx.putImageData(id, 0, 0);
  return { image: canvas, opacity: props.opacity !== undefined ? props.opacity : 1, visible: props.visible !== false, x: props.x || 0, y: props.y || 0, mode: 0 };
}

/* ================= PDF ================= */
let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}
async function decodePdf(buf) {
  const pdfjsLib = await pdfjs();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: false,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const MAXDIM = 2400;
    const scale = Math.min(4, Math.max(0.1, MAXDIM / Math.max(base.width, base.height)));
    const viewport = page.getViewport({ scale });
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvasToImage(canvas);
  } finally {
    try { await doc.destroy(); } catch (_) {}
  }
}

/* ================= AI (Illustrator) ================= */
async function decodeAi(buf) {
  // ملفات AI الحديثة متوافقة مع PDF
  if (U.ascii(buf, 0, 5) === '%PDF-') return decodePdf(buf);
  return decodeEps(buf);
}

/* ================= EPS (معاينة مدمجة) ================= */
async function decodeEps(buf) {
  const b = Buffer.from(buf);
  // 1) صورة HEX مدمجة (نمط common: BoundingBox ثم كتلة hex لبيانات colorimage)
  try {
    const bb = /%%BoundingBox:\s*-?\d+\s+-?\d+\s+(\d+)\s+(\d+)/.exec(U.ascii(b, 0, 2048));
    if (bb) {
      const w = parseInt(bb[1], 10), h = parseInt(bb[2], 10);
      if (w > 0 && h > 0 && w * h <= 80e6) {
        const text = U.ascii(b, 0, b.length);
        const hexes = text.match(/[0-9A-Fa-f]{200,}/g);
        if (hexes) {
          const joined = hexes.join('');
          const need = w * h * 3 * 2;
          if (joined.length >= need) {
            const bytes = Buffer.alloc(w * h * 3);
            const clean = joined.slice(0, need);
            for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
            const img = makeImage(w, h);
            for (let i = 0, p = 0; i < w * h; i++, p += 4) {
              img.rgba[p] = bytes[i * 3]; img.rgba[p + 1] = bytes[i * 3 + 1]; img.rgba[p + 2] = bytes[i * 3 + 2]; img.rgba[p + 3] = 255;
            }
            return img;
          }
        }
      }
    }
  } catch (_) {}
  // 2) معاينة Photoshop HEX
  const bp = U.findAscii(b, '%%BeginPreview:');
  if (bp !== -1) {
    const ep = U.findAscii(b, '%%EndPreview', bp);
    if (ep !== -1) {
      try {
        const hexChunk = U.ascii(b, bp + 15, ep - bp - 15).replace(/%[^\n]*/g, '');
        const hex = hexChunk.replace(/[^0-9a-fA-F]/g, '');
        const bytes = Buffer.alloc(hex.length >> 1);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        if (bytes[0] === 0x49 || bytes[0] === 0x4d) return await decodeTiff(bytes);
      } catch (_) {}
    }
  }
  // 3) ابحث عن صورة مدمجة (JPEG/PNG/TIFF) داخل الملف
  const found = await findEmbeddedImage(b);
  if (found) return found;
  throw new Error('لا تحتوي ملفات EPS على معاينة مدمجة قابلة للاستخراج (يتطلب التحويل الكامل Ghostscript غير المتوفر محلياً)');
}
/** يبحث عن أكبر صورة مدمجة (JPEG/PNG/TIFF/HEIC) داخل المخزن */
async function findEmbeddedImage(buf) {
  const candidates = [];
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      candidates.push({ off: i, kind: 'jpg', score: 2 });
      i += 1024;
    } else if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4e && buf[i + 3] === 0x47) {
      candidates.push({ off: i, kind: 'png', score: 2 });
      i += 8;
    } else if ((buf[i] === 0x49 && buf[i + 1] === 0x49 && buf[i + 2] === 0x2a) || (buf[i] === 0x4d && buf[i + 1] === 0x4d && buf[i + 3] === 0x2a)) {
      candidates.push({ off: i, kind: 'tif', score: 1 });
    }
  }
  candidates.sort((a, b) => b.off - a.off); // الأحدث غالباً الأكبر دقة
  for (const c of candidates.slice(0, 12)) {
    const sub = buf.subarray(c.off);
    try {
      if (c.kind === 'png') {
        const w = sub.readUInt32BE(16), h = sub.readUInt32BE(20);
        if (w > 4 && h > 4) { const img = await decodeWithSharp(sub); return img; }
      } else if (c.kind === 'jpg') {
        const img = await decodeWithSharp(sub);
        if (img.width > 4) return img;
      } else if (c.kind === 'tif') {
        const img = await decodeTiff(sub);
        if (img.width > 4 && img.width < 20000) return img;
      }
    } catch (_) { /* التالي */ }
  }
  return null;
}

/* ================= CDR ================= */
async function decodeCdr(buf) {
  const b = Buffer.from(buf);
  const img = await findEmbeddedImage(b);
  if (img) return img;
  throw new Error('تعذر استخراج معاينة مدمجة من ملف CDR (الصيغة مغلقة — المعاينات غير موجودة دائماً)');
}

/* ================= WMF / EMF ================= */
async function decodeWmf(buf) {
  let p = 0;
  if (buf.readUInt32LE(0) === 0x9ac6cdd7) p = 22; // Placeable header
  const type = buf.readUInt16LE(p);
  if (type !== 1 && type !== 2) throw new Error('ليس ملف WMF صالح');
  p += 18; // تخطَّ باقي الترويسة القياسية
  const records = [];
  const end = buf.length;
  let winOrg = [0, 0], winExt = [1024, 1024];
  const objects = {};
  while (p + 6 <= end) {
    const sizeWords = buf.readUInt32LE(p);
    if (sizeWords < 3 || p + sizeWords * 2 > end) break;
    const fn = buf.readUInt16LE(p + 4);
    const paramsOff = p + 6;
    records.push({ fn, off: paramsOff, size: sizeWords * 2 - 6 });
    if (fn === 0x020b) { winOrg = [buf.readInt16LE(paramsOff + 2), buf.readInt16LE(paramsOff)]; } // y,x
    if (fn === 0x020c) { winExt = [buf.readInt16LE(paramsOff + 2), buf.readInt16LE(paramsOff)]; }
    p += sizeWords * 2;
  }
  // إنشاء اللوحة
  const winW = Math.abs(winExt[0]) || 1024, winH = Math.abs(winExt[1]) || 1024;
  const scale = Math.max(1, Math.min(4, 1600 / Math.max(winW, winH)));
  const cw = Math.max(1, Math.round(winW * scale)), ch = Math.max(1, Math.round(winH * scale));
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(cw, ch);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.scale(scale, scale);
  let drewSomething = false;
  for (const r of records) {
    try { if (wmfRecord(ctx, r, buf, objects)) drewSomething = true; } catch (_) {}
  }
  if (!drewSomething) throw new Error('تعذر رسم محتوى WMF (لا توجد عناصر مدعومة)');
  return canvasToImage(canvas);
}
function wmfRecord(ctx, r, buf, objects) {
  const P = (i) => buf.readInt16LE(r.off + i * 2);
  switch (r.fn) {
    case 0x02fc: { // CREATEBRUSHINDIRECT: ihBrush, Style, Colorref(كلمتان)
      const idx = P(0);
      objects[idx] = { kind: 'brush', color: rgb16(P(2) | (P(3) << 16)) };
      return false;
    }
    case 0x02fa: { // CREATEPEN: ihBrush, Style, xWidth, yWidth, Colorref(كلمتان)
      const idx = P(0);
      objects[idx] = { kind: 'pen', color: rgb16(P(4) | (P(5) << 16)) };
      return false;
    }
    case 0x012d: { // SELECTOBJECT
      const o = objects[P(0)];
      if (o) {
        if (o.kind === 'brush') { ctx.fillStyle = o.color; ctx.strokeStyle = o.color; }
        if (o.kind === 'pen') ctx.strokeStyle = o.color;
      }
      return false;
    }
    case 0x041b: { // RECTANGLE: y2,x2,y1,x1
      const y1 = P(0), x1 = P(1), y2 = P(2), x2 = P(3);
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      return true;
    }
    case 0x0418: { // ELLIPSE
      const y1 = P(0), x1 = P(1), y2 = P(2), x2 = P(3);
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      return true;
    }
    case 0x0324: { // POLYGON: count ثم نقاط y,x
      const n = P(0);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const y = P(1 + i * 2), x = P(2 + i * 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      return true;
    }
    case 0x0325: { // POLYLINE
      const n = P(0);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const y = P(1 + i * 2), x = P(2 + i * 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return true;
    }
    case 0x0f43: { // STRETCHDIB
      const dstH = P(7), dstW = P(8), yDst = P(9), xDst = P(10);
      const dib = buf.subarray(r.off + 22);
      try {
        const img = parseDib(Buffer.from(dib), 0, true);
        const tmp = dibToCanvas(img, 0, 0, img.width, img.height);
        ctx.drawImage(tmp, xDst, yDst, dstW || img.width, dstH || img.height);
        return true;
      } catch (e) { return false; }
    }
    default:
      return false;
  }
}
function rgb16(v) {
  const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff;
  return `rgb(${r},${g},${b})`;
}
async function decodeEmf(buf) {
  if (buf.readUInt32LE(0) !== 1) throw new Error('ليس ملف EMF صالح');
  // اقرأ حدود الإطار من الترويسة: frameRect عند 24
  const frame = [buf.readInt32LE(24), buf.readInt32LE(28), buf.readInt32LE(32), buf.readInt32LE(36)];
  let fw = frame[2] - frame[0], fh = frame[3] - frame[1];
  if (fw <= 0 || fh <= 0) { fw = 800; fh = 600; }
  const scale = Math.max(1, Math.min(4, 1600 / Math.max(fw, fh)));
  const cw = Math.round(fw * scale), ch = Math.round(fh * scale);
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(cw, ch);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.scale(scale, scale);
  let p = buf.readUInt32LE(4); // حجم EMR_HEADER → أول سجل
  let drew = false;
  while (p + 8 <= buf.length) {
    const type = buf.readUInt32LE(p);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8 || p + size > buf.length) break;
    if (type === 81) { // EMR_STRETCHDIBITS
      try {
        const xDest = buf.readInt32LE(p + 24);
        const yDest = buf.readInt32LE(p + 28);
        const xSrc = buf.readInt32LE(p + 32);
        const ySrc = buf.readInt32LE(p + 36);
        const cxSrc = buf.readInt32LE(p + 40);
        const cySrc = buf.readInt32LE(p + 44);
        const offBmi = buf.readUInt32LE(p + 48);
        const cbBmi = buf.readUInt32LE(p + 52);
        const offBits = buf.readUInt32LE(p + 56);
        const cbBits = buf.readUInt32LE(p + 60);
        let cxDest = cxSrc, cyDest = cySrc;
        if (size >= 80) { cxDest = buf.readInt32LE(p + 72); cyDest = buf.readInt32LE(p + 76); }
        const bmi = buf.subarray(p + offBmi, p + offBmi + cbBmi);
        const bits = buf.subarray(p + offBits, p + offBits + cbBits);
        const full = Buffer.concat([Buffer.from(bmi), Buffer.from(bits)]);
        const img = parseDib(full, 0, true);
        const sx = xSrc >= 0 ? xSrc : 0, sy = ySrc >= 0 ? ySrc : 0;
        const sw = cxSrc > 0 ? cxSrc : img.width, sh = cySrc > 0 ? cySrc : img.height;
        const tmp = dibToCanvas(img, sx, sy, Math.min(sw, img.width - sx), Math.min(sh, img.height - sy));
        ctx.drawImage(tmp, xDest, yDest, cxDest || sw, cyDest || sh);
        drew = true;
      } catch (_) {}
    }
    p += size;
  }
  if (!drew) throw new Error('تعذر رسم محتوى EMF (لا توجد صور نقطية مدمجة)');
  return canvasToImage(canvas);
}
function dibToCanvas(img, sx, sy, sw, sh) {
  const { createCanvas } = require('@napi-rs/canvas');
  sw = Math.max(1, Math.min(sw || img.width, img.width)); sh = Math.max(1, Math.min(sh || img.height, img.height));
  const c = createCanvas(sw, sh);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(sw, sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = ((sy + y) * img.width + (sx + x)) * 4;
      const d = (y * sw + x) * 4;
      id.data[d] = img.rgba[s]; id.data[d + 1] = img.rgba[s + 1]; id.data[d + 2] = img.rgba[s + 2]; id.data[d + 3] = img.rgba[s + 3];
    }
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

/* ================= DDS ================= */
async function decodeDds(buf) {
  if (U.ascii(buf, 0, 4) !== 'DDS ') throw new Error('ليس ملف DDS صالح');
  const h = 128;
  const height = buf.readUInt32LE(12), width = buf.readUInt32LE(16);
  const linearSize = buf.readUInt32LE(20);
  const mipCount = buf.readUInt32LE(28);
  const fourCC = U.ascii(buf, 84, 4);
  const pfflags = buf.readUInt32LE(80);
  const DDPF_ALPHA = 0x2, DDPF_RGB = 0x40, DDPF_RGBA = 0x41, DDPF_LUM = 0x20000, DDPF_FOURCC = 0x4;
  const img = makeImage(width, height);
  const rgba = img.rgba;
  if (fourCC === 'DXT1' || fourCC === 'DXT2' || fourCC === 'DXT3' || fourCC === 'DXT4' || fourCC === 'DXT5' || fourCC === 'BC1 ' || fourCC === 'BC2 ' || fourCC === 'BC3 ' || fourCC === 'BC4 ' || fourCC === 'BC5 ') {
    const isDxt1 = fourCC === 'DXT1' || fourCC === 'BC1 ';
    const isDxt3 = fourCC === 'DXT2' || fourCC === 'DXT3' || fourCC === 'BC2 ';
    const isDxt5 = fourCC === 'DXT4' || fourCC === 'DXT5' || fourCC === 'BC3 ';
    const isBc4 = fourCC === 'BC4 ';
    const isBc5 = fourCC === 'BC5 ';
    let p = h;
    const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
    const bsize = isDxt1 || isBc4 ? 8 : 16;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const block = buf.subarray(p, p + bsize); p += bsize;
        decodeBlock(block, bx * 4, by * 4, width, height, rgba, { isDxt1, isDxt3, isDxt5, isBc4, isBc5 });
      }
    }
  } else if ((pfflags & DDPF_RGB) || (pfflags & DDPF_RGBA) || (pfflags & DDPF_LUM) || (pfflags & DDPF_ALPHA)) {
    const rmask = buf.readUInt32LE(92) || 0x00ff0000;
    const gmask = buf.readUInt32LE(96) || 0x0000ff00;
    const bmask = buf.readUInt32LE(100) || 0x000000ff;
    const amask = buf.readUInt32LE(104);
    const bpp = buf.readUInt32LE(88);
    const pitch = buf.readUInt32LE(20);
    let p = h;
    const rowSize = pitch > 0 ? pitch : Math.floor((bpp * width + 7) / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = p + y * rowSize + x * (bpp >> 3);
        const v = bpp === 32 ? buf.readUInt32LE(i) : bpp === 16 ? buf.readUInt16LE(i) : buf[i];
        const d = y * width + x;
        rgba[d * 4] = maskExtract(v, rmask);
        rgba[d * 4 + 1] = maskExtract(v, gmask);
        rgba[d * 4 + 2] = maskExtract(v, bmask);
        rgba[d * 4 + 3] = amask ? maskExtract(v, amask) : 255;
      }
    }
  } else throw new Error('تنسيق DDS غير مدعوم (fourCC: ' + fourCC + ')');
  return img;
}
function maskExtract(v, mask) {
  if (!mask) return 0;
  const sh = shiftOf(mask);
  const bits = Math.ceil(Math.log2(mask + 1));
  let val = (v & mask) >>> sh;
  if (bits >= 8) val = val >> (bits - 8);
  else val = (val * 255) / ((1 << bits) - 1);
  return val | 0;
}
function decodeBlock(block, bx, by, width, height, rgba, kind) {
  const clamp4 = (v, max) => Math.min(v, max - 1);
  if (kind.isBc4 || kind.isBc5) {
    const dec = (off) => {
      const p0 = block[off], p1 = block[off + 1];
      const pal = [p0, p1];
      if (p0 > p1) for (let i = 1; i < 7; i++) pal.push(Math.round(p0 + ((p1 - p0) * i) / 7));
      else for (let i = 1; i < 5; i++) pal.push(Math.round(p0 + ((p1 - p0) * i) / 5));
      const idxs = [];
      let bitPos = 0;
      for (let i = 0; i < 16; i++) {
        const byte = block[off + 2 + (bitPos >> 3)];
        idxs.push((byte >> (bitPos & 7)) & 7);
        bitPos += 3;
      }
      return { pal, idxs };
    };
    const r = dec(0);
    if (kind.isBc4) {
      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = clamp4(bx + px, width), y = clamp4(by + py, height);
        const v = r.pal[r.idxs[py * 4 + px]] || 0;
        const d = (y * width + x) * 4;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255;
      }
      return;
    }
    const g = dec(8);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = clamp4(bx + px, width), y = clamp4(by + py, height);
      const i4 = py * 4 + px;
      const d = (y * width + x) * 4;
      rgba[d] = r.pal[r.idxs[i4]] || 0;
      rgba[d + 1] = g.pal[g.idxs[i4]] || 0;
      rgba[d + 2] = 0; rgba[d + 3] = 255;
    }
    return;
  }
  // DXT1/3/5
  const c0 = block.readUInt16LE(0), c1 = block.readUInt16LE(2);
  const expand = (c) => {
    const r = ((c >> 11) & 0x1f) * 255 / 31 | 0;
    const g = ((c >> 5) & 0x3f) * 255 / 63 | 0;
    const b = (c & 0x1f) * 255 / 31 | 0;
    return [r, g, b];
  };
  const col0 = expand(c0), col1 = expand(c1);
  const pal = [col0, col1];
  if (kind.isDxt1) {
    if (c0 > c1) {
      for (let i = 1; i < 3; i++) pal.push([
        (col0[0] * (3 - i) + col1[0] * i) / 3 | 0,
        (col0[1] * (3 - i) + col1[1] * i) / 3 | 0,
        (col0[2] * (3 - i) + col1[2] * i) / 3 | 0]);
      pal.push([0, 0, 0]);
    } else {
      pal.push([
        (col0[0] + col1[0]) >> 1,
        (col0[1] + col1[1]) >> 1,
        (col0[2] + col1[2]) >> 1]);
      pal.push([0, 0, 0]); // الفهرس 3 = أسود شفاف في وضع c0<=c1
    }
  } else {
    for (let i = 1; i < 3; i++) pal.push([
      (col0[0] * (3 - i) + col1[0] * i) / 3 | 0,
      (col0[1] * (3 - i) + col1[1] * i) / 3 | 0,
      (col0[2] * (3 - i) + col1[2] * i) / 3 | 0]);
    pal.push([0, 0, 0]);
  }
  const bits = block.readUInt32LE(4);
  let alphaBlock = null;
  if (kind.isDxt3) {
    alphaBlock = []; // 16 قيمة 4-بت
    for (let i = 0; i < 16; i++) {
      const byte = block[8 + (i >> 1)];
      alphaBlock.push((i % 2 === 0) ? (byte & 0xf) * 17 : (byte >> 4) * 17);
    }
  } else if (kind.isDxt5) {
    const a0 = block[8], a1 = block[9];
    const apal = [a0, a1];
    if (a0 > a1) { for (let i = 1; i < 7; i++) apal.push(a0 + ((a1 - a0) * i) / 7); apal.push(255); }
    else { for (let i = 1; i < 5; i++) apal.push(a0 + ((a1 - a0) * i) / 5); apal.push(0); }
    const aidx = [];
    let bitPos = 0;
    for (let i = 0; i < 16; i++) {
      const byteIdx = 10 + (bitPos >> 3);
      aidx.push((block[byteIdx] >> (bitPos & 7)) & 7);
      bitPos += 3;
    }
    alphaBlock = aidx.map((i) => apal[i] | 0);
  }
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = clamp4(bx + px, width), y = clamp4(by + py, height);
      const i4 = py * 4 + px;
      const ci = (bits >> (i4 * 2)) & 3;
      const c = pal[ci];
      const d = (y * width + x) * 4;
      rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2];
      if (kind.isDxt1) rgba[d + 3] = (c0 <= c1 && ci === 3) ? 0 : 255;
      else rgba[d + 3] = alphaBlock ? alphaBlock[i4] : 255;
    }
  }
}

/* ================= TGA ================= */
async function decodeTga(buf) {
  if (buf.length < 18) throw new Error('ليس ملف TGA صالح');
  const idLen = buf[0], cmapType = buf[1], imgType = buf[2];
  const cmapFirst = buf.readUInt16LE(3), cmapLen = buf.readUInt16LE(5), cmapBits = buf[7];
  const w = buf.readUInt16LE(12), h = buf.readUInt16LE(14);
  const bpp = buf[16], desc = buf[17];
  if (!w || !h) throw new Error('أبعاد TGA صفرية');
  let p = 18 + idLen;
  const palette = [];
  if (cmapType === 1) {
    const bytesPer = cmapBits >> 3;
    for (let i = 0; i < cmapLen; i++) {
      const b = buf[p + i * bytesPer], g = buf[p + i * bytesPer + 1], r = buf[p + i * bytesPer + 2];
      palette[cmapFirst + i] = [r, g, b, bytesPer === 4 ? buf[p + i * bytesPer + 3] : 255];
    }
    p += cmapLen * bytesPer;
  }
  const img = makeImage(w, h);
  const rgba = img.rgba;
  const bytesPer = bpp >> 3;
  const readPixel = (pos) => {
    if (imgType === 1 || imgType === 9) return palette[buf[pos]] || [0, 0, 0, 255];
    if (imgType === 3 || imgType === 11) { const v = buf[pos]; return [v, v, v, 255]; }
    if (bpp === 16) {
      const v = buf.readUInt16LE(pos);
      const r = ((v >> 10) & 0x1f) * 255 / 31 | 0, g = ((v >> 5) & 0x1f) * 255 / 31 | 0, b = (v & 0x1f) * 255 / 31 | 0;
      return [r, g, b, (v & 0x8000) ? 255 : 255];
    }
    if (bpp === 24) return [buf[pos + 2], buf[pos + 1], buf[pos], 255];
    return [buf[pos + 2], buf[pos + 1], buf[pos], buf[pos + 3]];
  };
  const rle = imgType >= 9;
  if (!rle) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = readPixel(p); p += bytesPer;
        const d = y * w + x;
        rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = c[3];
      }
    }
  } else {
    let x = 0, y = 0;
    while (y < h && p < buf.length) {
      const hdr = buf[p++];
      const count = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        const c = readPixel(p); p += bytesPer;
        for (let k = 0; k < count && y < h; k++) {
          const d = y * w + x++;
          rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = c[3];
          if (x >= w) { x = 0; y++; }
        }
      } else {
        for (let k = 0; k < count && y < h; k++) {
          const c = readPixel(p); p += bytesPer;
          const d = y * w + x++;
          rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = c[3];
          if (x >= w) { x = 0; y++; }
        }
      }
    }
  }
  if (!(desc & 0x20)) { // الأصل أسفل — اقلب
    const flipped = makeImage(w, h);
    for (let y = 0; y < h; y++) flipped.rgba.set(rgba.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return flipped;
  }
  return img;
}

/* ================= PCX ================= */
async function decodePcx(buf) {
  if (buf[0] !== 0x0a) throw new Error('ليس ملف PCX صالح');
  const xmin = buf.readUInt16LE(4), ymin = buf.readUInt16LE(6);
  const xmax = buf.readUInt16LE(8), ymax = buf.readUInt16LE(10);
  const w = xmax - xmin + 1, h = ymax - ymin + 1;
  const bpp = buf[3], planes = buf[65], bytesPerLine = buf.readUInt16LE(66);
  const img = makeImage(w, h);
  const rgba = img.rgba;
  if (bpp === 8 && planes === 3) {
    let p = 128;
    for (let y = 0; y < h; y++) {
      const row = U.rleDecodePCX(buf.subarray(p), planes * bytesPerLine);
      p += rlePcxLen(buf.subarray(p), planes * bytesPerLine);
      for (let x = 0; x < w; x++) {
        const d = (y * w + x) * 4;
        rgba[d] = row[x]; rgba[d + 1] = row[bytesPerLine + x]; rgba[d + 2] = row[2 * bytesPerLine + x]; rgba[d + 3] = 255;
      }
    }
  } else if (bpp === 8 && planes === 1) {
    // لوحة 256 لون في النهاية
    let palOff = buf.length - 769;
    if (buf[palOff] !== 0x0c) palOff = U.findAscii(buf, '\x0c', buf.length - 1538) !== -1 ? U.findAscii(buf, '\x0c', buf.length - 1538) : palOff;
    const palette = [];
    for (let i = 0; i < 256; i++) palette.push([buf[palOff + 1 + i * 3], buf[palOff + 2 + i * 3], buf[palOff + 3 + i * 3]]);
    let p = 128;
    for (let y = 0; y < h; y++) {
      const row = U.rleDecodePCX(buf.subarray(p), bytesPerLine);
      p += rlePcxLen(buf.subarray(p), bytesPerLine);
      for (let x = 0; x < w; x++) {
        const c = palette[row[x]] || [0, 0, 0];
        const d = (y * w + x) * 4;
        rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = 255;
      }
    }
  } else if (bpp === 1) {
    // 1-بت (أحادية أو 4 طائرات)
    const palette = [];
    const is4 = planes === 4;
    for (let i = 0; i < 16; i++) palette.push([buf[16 + i * 3], buf[17 + i * 3], buf[18 + i * 3]]);
    let p = 128;
    for (let y = 0; y < h; y++) {
      const row = U.rleDecodePCX(buf.subarray(p), planes * bytesPerLine);
      p += rlePcxLen(buf.subarray(p), planes * bytesPerLine);
      for (let x = 0; x < w; x++) {
        let c;
        if (is4) {
          let idx = 0;
          for (let pl = 0; pl < 4; pl++) idx |= (((row[pl * bytesPerLine + (x >> 3)] >> (7 - (x & 7))) & 1) << pl);
          c = palette[idx];
        } else {
          const bit = (row[(x >> 3)] >> (7 - (x & 7))) & 1;
          c = palette[bit * 15] || [bit ? 255 : 0, bit ? 255 : 0, bit ? 255 : 0];
        }
        const d = (y * w + x) * 4;
        rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = 255;
      }
    }
  } else throw new Error(`تركيبة PCX غير مدعومة (bpp=${bpp}, planes=${planes})`);
  return img;
}
/** يحسب عدد البايتات المستهلكة لفك صف RLE بطول معروف */
function rlePcxLen(src, outLen) {
  let ip = 0, op = 0;
  while (op < outLen && ip < src.length) {
    const b = src[ip++];
    if ((b & 0xc0) === 0xc0) { op += b & 0x3f; ip++; }
    else op++;
  }
  return ip;
}

/* ================= PNM / PAM ================= */
function parsePnmHeader(buf) {
  let p = 0;
  if (buf[p] !== 0x50 || buf[p + 1] < 0x31 || buf[p + 1] > 0x37) throw new Error('ليس ملف PNM صالح');
  const magic = String.fromCharCode(buf[p], buf[p + 1]); p += 2;
  const readToken = () => {
    let ch;
    do {
      while (p < buf.length && ((ch = buf[p]) === 0x20 || ch === 0x09 || ch === 0x0d || ch === 0x0a)) p++;
      if (buf[p] === 0x23) { while (p < buf.length && buf[p] !== 0x0a) p++; }
    } while (p < buf.length && (buf[p] === 0x23 || buf[p] === 0x20 || buf[p] === 0x09 || buf[p] === 0x0d || buf[p] === 0x0a));
    let tok = '';
    while (p < buf.length) {
      const c = buf[p];
      if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a || c === 0x23) break;
      tok += String.fromCharCode(c); p++;
    }
    return tok;
  };
  let width = 0, height = 0, maxval = 255, depth = 0, tupltype = null;
  if (magic === 'P7') {
    for (;;) {
      const t = readToken();
      if (t === 'WIDTH') width = parseInt(readToken(), 10);
      else if (t === 'HEIGHT') height = parseInt(readToken(), 10);
      else if (t === 'DEPTH') depth = parseInt(readToken(), 10);
      else if (t === 'MAXVAL') maxval = parseInt(readToken(), 10);
      else if (t === 'TUPLTYPE') tupltype = readToken();
      else if (t === 'ENDHDR') break;
    }
  } else {
    width = parseInt(readToken(), 10);
    height = parseInt(readToken(), 10);
    if (magic !== 'P1' && magic !== 'P4') maxval = parseInt(readToken(), 10);
  }
  if (!width || !height) throw new Error('أبعاد PNM غير صالحة');
  if (magic !== 'P1' && magic !== 'P2' && magic !== 'P3') p++; // حرف مسافة واحد قبل البيانات الثنائية
  return { magic, width, height, maxval, depth, tupltype, dataOff: p };
}
async function decodePnm(buf) {
  const { magic, width: w, height: h, maxval, depth, tupltype, dataOff } = parsePnmHeader(buf);
  const img = makeImage(w, h);
  const rgba = img.rgba;
  const binary = magic === 'P4' || magic === 'P5' || magic === 'P6' || magic === 'P7';
  const channels = magic === 'P7' ? depth : magic === 'P6' ? 3 : magic === 'P5' ? 1 : magic === 'P4' ? 1 : (magic === 'P3' ? 3 : 1);
  const isBitmap = magic === 'P1' || magic === 'P4';
  const scale = isBitmap ? 255 : 255 / maxval;
  if (binary) {
    if (isBitmap) {
      const rowBytes = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const bit = (buf[dataOff + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const d = (y * w + x) * 4;
          const v = bit ? 0 : 255; // 1 = أسود في PBM
          rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255;
        }
      }
    } else {
      const wide = maxval > 255;
      const bpc = wide ? 2 : 1;
      const hasAlpha = magic === 'P7' && (tupltype === 'RGB_ALPHA' || depth === 4);
      const isGray = magic === 'P5' || (magic === 'P7' && (tupltype === 'GRAYSCALE' || depth === 1));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = (y * w + x) * 4;
          const base = dataOff + (y * w + x) * channels * bpc;
          const get = (c) => {
            if (wide) return (buf[base + c * 2] << 8 | buf[base + c * 2 + 1]) * scale;
            return buf[base + c] * scale;
          };
          if (isGray) { const v = get(0) | 0; rgba[d] = rgba[d + 1] = rgba[d + 2] = v; }
          else { rgba[d] = get(0) | 0; rgba[d + 1] = get(1) | 0; rgba[d + 2] = get(2) | 0; }
          rgba[d + 3] = hasAlpha ? get(3) | 0 : 255;
        }
      }
    }
  } else {
    // ASCII
    let p = dataOff;
    const nextNum = () => {
      while (p < buf.length && /[ \t\r\n#]/.test(String.fromCharCode(buf[p]))) {
        if (buf[p] === 0x23) while (p < buf.length && buf[p] !== 0x0a) p++;
        else p++;
      }
      let v = 0;
      while (p < buf.length && buf[p] >= 0x30 && buf[p] <= 0x39) { v = v * 10 + (buf[p] - 0x30); p++; }
      return v;
    };
    for (let i = 0; i < w * h; i++) {
      const d = i * 4;
      if (isBitmap) { const v = nextNum() ? 0 : 255; rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255; }
      else if (magic === 'P3') {
        rgba[d] = nextNum() * scale | 0; rgba[d + 1] = nextNum() * scale | 0; rgba[d + 2] = nextNum() * scale | 0; rgba[d + 3] = 255;
      } else { const v = nextNum() * scale | 0; rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255; }
    }
  }
  return img;
}

/* ================= HDR (Radiance) ================= */
async function decodeHdr(buf) {
  const text = U.ascii(buf, 0, Math.min(buf.length, 4096));
  if (!text.startsWith('#?RADIANCE') && !text.startsWith('#?RGBE')) throw new Error('ليس ملف HDR صالح');
  let p = 0;
  let w = 0, h = 0;
  while (p < buf.length) {
    const nl = buf.indexOf(0x0a, p);
    if (nl === -1) break;
    const line = U.ascii(buf, p, nl - p).trim();
    p = nl + 1;
    if (line === '') break;
    const m = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(line);
    if (m) { h = parseInt(m[1], 10); w = parseInt(m[2], 10); }
  }
  if (!w || !h) throw new Error('ترويسة HDR تفتقد الأبعاد');
  const img = makeImage(w, h);
  img.float = { data: new Float32Array(w * h * 3) };
  const fdata = img.float.data;
  const rgba = img.rgba;
  const rgbeToFloat = (r, g, b, e) => {
    if (e === 0) return [0, 0, 0];
    const f = Math.pow(2, e - 128) / 255;
    return [r * f, g * f, b * f];
  };
  for (let y = 0; y < h; y++) {
    // صيغة RLE الجديدة: 2,2,طول السطر (العرض) بايتان
    if (buf[p] === 2 && buf[p + 1] === 2 && buf[p + 2] === ((w >> 8) & 0xff) && buf[p + 3] === (w & 0xff)) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        const plane = Buffer.alloc(w);
        let x = 0;
        while (x < w) {
          const cnt = buf[p++];
          if (cnt > 128) {
            const run = cnt - 128;
            const v = buf[p++];
            plane.fill(v, x, x + run);
            x += run;
          } else {
            buf.copy(plane, x, p, p + cnt);
            p += cnt;
            x += cnt;
          }
        }
        for (let x2 = 0; x2 < w; x2++) {
          const i = (y * w + x2) * 4;
          if (c === 0) rgba[i] = plane[x2];
          else if (c === 1) rgba[i + 1] = plane[x2];
          else if (c === 2) rgba[i + 2] = plane[x2];
          else rgba[i + 3] = plane[x2];
        }
      }
      for (let x2 = 0; x2 < w; x2++) {
        const i = (y * w + x2) * 4;
        const [r, g, b] = rgbeToFloat(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
        const q = (y * w + x2) * 3;
        fdata[q] = r; fdata[q + 1] = g; fdata[q + 2] = b;
      }
    } else {
      // غير مضغوط: RGBE لكل بكسل
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        rgba[i] = buf[p]; rgba[i + 1] = buf[p + 1]; rgba[i + 2] = buf[p + 2]; rgba[i + 3] = buf[p + 3];
        p += 4;
        const [r, g, b] = rgbeToFloat(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
        const q = (y * w + x) * 3;
        fdata[q] = r; fdata[q + 1] = g; fdata[q + 2] = b;
      }
    }
  }
  // RGBA النهائي عبر التعيين النغمي
  img.rgba = U.floatToRgba(fdata, w, h);
  return img;
}

/* ================= EXR ================= */
const EXR_COMPRESSION = { NONE: 0, RLE: 1, ZIPS: 2, ZIP: 3 };
async function decodeExr(buf) {
  if (!(buf[0] === 0x76 && buf[1] === 0x2f && buf[2] === 0x31 && buf[3] === 0x01)) throw new Error('ليس ملف EXR صالح');
  const version = buf.readUInt32LE(4);
  const isTiled = (version >> 9) & 1;
  const isMultipart = (version >> 12) & 1;
  if (isTiled) throw new Error('ملفات EXR المبلطة (tiled) غير مدعومة — استخدم EXR ممسوحاً ضوئياً');
  if (isMultipart) throw new Error('ملفات EXR متعددة الأجزاء غير مدعومة');
  let p = 8;
  const attrs = {};
  const readStr = () => {
    const s = p;
    while (p < buf.length && buf[p] !== 0) p++;
    const v = U.ascii(buf, s, p - s);
    p++;
    return v;
  };
  for (;;) {
    if (p >= buf.length) throw new Error('ترويسة EXR غير منتهية');
    const name = readStr();
    if (!name) break;
    const type = readStr();
    const size = buf.readUInt32LE(p); p += 4;
    attrs[name] = { type, size, off: p };
    p += size;
  }
  if (!attrs.channels || !attrs.dataWindow || !attrs.compression) throw new Error('ترويسة EXR ناقصة');
  const compression = buf[attrs.compression.off];
  if (compression === 4 || compression >= 5) throw new Error('ضغط EXR غير مدعوم (PIZ/DWAA) — مدعوم: NONE/RLE/ZIP/ZIPS');
  const dwx = attrs.dataWindow.off;
  const xMin = buf.readInt32LE(dwx), yMin = buf.readInt32LE(dwx + 4);
  const xMax = buf.readInt32LE(dwx + 8), yMax = buf.readInt32LE(dwx + 12);
  const w = xMax - xMin + 1, h = yMax - yMin + 1;
  // القنوات — تُقرأ بِمؤشر q مستقل (لا يعبث مع p) وبحدود آمنة
  let q = attrs.channels.off;
  const channelsEnd = attrs.channels.off + attrs.channels.size;
  const channels = [];
  for (;;) {
    if (q >= channelsEnd) break;
    const s = q;
    while (q < channelsEnd && buf[q] !== 0) q++;
    const name = U.ascii(buf, s, q - s);
    q++;
    if (!name) break;
    const pxType = buf.readInt32LE(q); q += 4;
    q += 4; // pLinear + 3 محجوزة
    q += 4; // xSampling
    q += 4; // ySampling
    channels.push({ name, type: pxType });
  }
  const names = channels.map((c) => c.name);
  let rC, gC, bC, aC;
  if (names.includes('R')) { rC = channels.find((c) => c.name === 'R'); gC = channels.find((c) => c.name === 'G'); bC = channels.find((c) => c.name === 'B'); aC = channels.find((c) => c.name === 'A'); }
  else if (names.includes('Y') && !names.includes('Ry')) { rC = gC = bC = channels.find((c) => c.name === 'Y'); }
  else throw new Error('قنوات EXR غير مدعومة (مطلوب RGB أو Y)');
  const used = [rC, gC, bC, aC].filter(Boolean);
  const typesOk = used.every((c) => c.type === 1 || c.type === 2);
  if (!typesOk) throw new Error('نوع بكسل EXR غير مدعوم (UINT)');
  // ترتيب القنوات كما ورد في chlist (هو نفسه ترتيبها في بيانات البكسل)
  const usedSet = new Set(used.map((c) => c.name));
  const chanList = channels.filter((c) => usedSet.has(c.name));
  // سطور الكتلة: NONE/RLE/ZIPS = سطر واحد لكل chunk، ZIP = 16
  const linesPerBlock = compression === 3 ? 16 : 1;
  const blockCount = Math.ceil(h / linesPerBlock);
  const offsets = [];
  for (let i = 0; i < blockCount; i++) offsets.push(Number(buf.readBigUInt64LE(p + i * 8)));
  const bytesPerSample = (t) => (t === 2 ? 4 : 2); // float أو half
  const samplesPerPixel = chanList.reduce((a, c) => a + bytesPerSample(c.type), 0);
  const img = makeImage(w, h);
  img.float = { data: new Float32Array(w * h * 3) };
  const fdata = img.float.data;
  const planes = {};
  for (const c of chanList) planes[c.name] = new Float32Array(w * h);
  const parseInterleavedLine = (line, rowOff) => {
    let lp = 0;
    for (let x = 0; x < w; x++) {
      for (const c of chanList) {
        const n = bytesPerSample(c.type);
        const dst = planes[c.name];
        if (c.type === 2) dst[rowOff + x] = line.readFloatLE(lp);
        else dst[rowOff + x] = U.halfToFloatFast(line.readUInt16LE(lp));
        lp += n;
      }
    }
  };
  const dePredict = (rawBuf) => {
    let acc = 0;
    for (let i = 0; i < rawBuf.length; i++) {
      acc = (acc + rawBuf[i]) & 0xff;
      rawBuf[i] = acc;
    }
  };
  const parsePlanar = (rawBuf, yStart, nLines) => {
    let pp = 0;
    for (let li = 0; li < nLines; li++) {
      for (const c of chanList) {
        const n = w * bytesPerSample(c.type);
        const chan = rawBuf.subarray(pp, pp + n);
        const dst = planes[c.name];
        const rowOff = (yStart + li - yMin) * w;
        if (c.type === 2) for (let x = 0; x < w; x++) dst[rowOff + x] = chan.readFloatLE(x * 4);
        else for (let x = 0; x < w; x++) dst[rowOff + x] = U.halfToFloatFast(chan.readUInt16LE(x * 2));
        pp += n;
      }
    }
  };
  const rleDecodeLine = (src, off, outLen) => {
    const out = Buffer.alloc(outLen);
    let ip = off, op = 0;
    while (op < outLen && ip < src.length) {
      const ctrl = src.readInt8(ip); ip++;
      if (ctrl < 0) { const cnt = 1 - ctrl; out.fill(src[ip++], op, op + cnt); op += cnt; }
      else { const cnt = ctrl + 1; src.copy(out, op, ip, ip + cnt); ip += cnt; op += cnt; }
    }
    return out;
  };
  for (let bi = 0; bi < blockCount; bi++) {
    const yStart = yMin + bi * linesPerBlock;
    const nLines = Math.min(linesPerBlock, yMin + h - yStart);
    let dp = offsets[bi];
    const y = buf.readUInt32LE(dp); dp += 4;
    const dataSize = buf.readUInt32LE(dp); dp += 4;
    if (compression === 0) { // NONE: سطر واحد متداخل القنوات خام
      parseInterleavedLine(buf.subarray(dp, dp + w * samplesPerPixel), yStart - yMin);
    } else if (compression === 1) { // RLE: السطر كله مضغوط (بلا بادئة طول داخلية)
      const line = rleDecodeLine(buf, dp, w * samplesPerPixel);
      parseInterleavedLine(line, yStart - yMin);
    } else { // ZIP/ZIPS: كتلة كاملة deflated ثم متنبئ ثم planar
      const raw = zlib.inflateSync(buf.subarray(dp, dp + dataSize));
      dePredict(raw);
      parsePlanar(raw, yStart, nLines);
    }
  }
  for (let i = 0; i < w * h; i++) {
    const q3 = i * 3;
    fdata[q3] = planes[rC.name][i];
    fdata[q3 + 1] = planes[gC.name][i];
    fdata[q3 + 2] = planes[bC.name][i];
  }
  img.rgba = U.floatToRgba(fdata, w, h);
  return img;
}

/* ================= FITS (و .fits.gz) ================= */
async function decodeFits(buf, isGz) {
  let data = Buffer.from(buf);
  if (isGz || (data[0] === 0x1f && data[1] === 0x8b)) data = zlib.gunzipSync(data);
  if (U.ascii(data, 0, 8) !== 'SIMPLE  ') throw new Error('ليس ملف FITS صالح');
  const cards = {};
  let p = 0;
  for (;;) {
    if (p + 2880 > data.length) throw new Error('ترويسة FITS ناقصة');
    let ended = false;
    for (let off = 0; off < 2880; off += 80) {
      const card = U.ascii(data, p + off, 80);
      const key = card.slice(0, 8).trim();
      if (key === 'END') { ended = true; break; }
      let val = card.slice(10).trim();
      val = val.replace(/\/.*$/, '').trim().replace(/^'(.*)'$/, '$1').trim();
      if (key && val !== '') cards[key] = val;
    }
    p += 2880;
    if (ended) break;
  }
  const naxis = parseInt(cards.NAXIS || '2', 10);
  const w = parseInt(cards.NAXIS1 || '0', 10);
  const h = parseInt(cards.NAXIS2 || '0', 10);
  const bitpix = parseInt(cards.BITPIX || '8', 10);
  const bscale = parseFloat(cards.BSCALE || '1');
  const bzero = parseFloat(cards.BZERO || '0');
  if (!w || !h) throw new Error('أبعاد FITS غير صالحة');
  // تخطَّ EXTENSION إن وجدت بيانات إضافية — نقرأ أول HDU فقط
  const bytesPer = Math.abs(bitpix) >> 3;
  const count = w * h;
  const img = makeImage(w, h);
  img.float = { data: new Float32Array(count * 3) };
  const fdata = img.float.data;
  let min = Infinity, max = -Infinity;
  const values = new Float32Array(count);
  const readVal = (i) => {
    const o = p + i * bytesPer;
    let v;
    if (bitpix === 8) v = data.readUInt8(o);
    else if (bitpix === 16) v = data.readInt16BE(o);
    else if (bitpix === 32) v = data.readInt32BE(o);
    else if (bitpix === -32) v = data.readFloatBE(o);
    else v = data.readDoubleBE(o);
    return v * bscale + bzero;
  };
  for (let i = 0; i < count; i++) {
    values[i] = readVal(i);
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  // تطبيع للعرض
  const range = max - min || 1;
  const sqrtScale = max > 20; // بيانات علمية: مقياس جذري لتحسين المعاينة
  for (let i = 0; i < count; i++) {
    let t = (values[i] - min) / range;
    if (sqrtScale) t = Math.sqrt(Math.max(0, t));
    const v = Math.round(t * 255);
    fdata[i * 3] = fdata[i * 3 + 1] = fdata[i * 3 + 2] = t; // خطي
    img.rgba[i * 4] = v; img.rgba[i * 4 + 1] = v; img.rgba[i * 4 + 2] = v; img.rgba[i * 4 + 3] = 255;
  }
  return img;
}

/* ================= SGI / RGB / RGBA ================= */
async function decodeSgi(buf) {
  if (buf.readUInt16BE(0) !== 474) throw new Error('ليس ملف SGI صالح');
  const storage = buf.readUInt16BE(2); // 0 verbatim، 1 RLE
  const bpc = buf.readUInt16BE(4);
  const dim = buf.readUInt16BE(6);
  const w = buf.readUInt16BE(8), h = buf.readUInt16BE(10);
  const zsize = buf.readUInt16BE(12) || 1;
  const img = makeImage(w, h);
  const rgba = img.rgba;
  const z = Math.min(zsize, 4);
  if (storage === 0) {
    let p = 512;
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < z; c++) {
        for (let x = 0; x < w; x++) {
          let v;
          if (bpc === 1) { v = buf[p++]; }
          else { v = buf.readUInt16BE(p); p += 2; }
          const val = bpc === 1 ? v : v >> 8;
          const d = (y * w + x) * 4;
          if (c < 3) rgba[d + c] = val;
          else rgba[d + 3] = val;
        }
      }
    }
  } else {
    const tabOff = 512;
    const startTab = (y, c) => buf.readUInt32BE(tabOff + ((y * zsize + c) * 8));
    const lenTab = (y, c) => buf.readUInt32BE(tabOff + ((y * zsize + c) * 8) + 4);
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < z; c++) {
        const off = startTab(y, c), len = lenTab(y, c);
        let p = off;
        const end = off + len;
        let x = 0;
        while (p < end && x < w) {
          const cnt0 = buf[p++];
          if (cnt0 < 0x80) {
            const cnt = cnt0 + 1; // عدد حرفي: n-1 مخزّن
            for (let k = 0; k < cnt && x < w; k++) {
              let v;
              if (bpc === 1) { v = buf[p++]; }
              else { v = buf.readUInt16BE(p); p += 2; }
              const val = bpc === 1 ? v : v >> 8;
              const d = (y * w + x++) * 4;
              if (c < 3) rgba[d + c] = val; else rgba[d + 3] = val;
            }
          } else {
            const run = cnt0 - 127;
            const v = bpc === 1 ? buf[p++] : (buf[p] << 8) | buf[p + 1];
            if (bpc === 2) p += 2;
            const val = bpc === 1 ? v : v >> 8;
            for (let k = 0; k < run && x < w; k++) {
              const d = (y * w + x++) * 4;
              if (c < 3) rgba[d + c] = val; else rgba[d + 3] = val;
            }
          }
        }
      }
    }
  }
  // سطور SGI مخزنة من الأسفل — اقلب للعرض
  const flipped = makeImage(w, h);
  for (let yy = 0; yy < h; yy++) flipped.rgba.set(rgba.subarray((h - 1 - yy) * w * 4, (h - yy) * w * 4), yy * w * 4);
  return flipped;
}

/* ================= .raw (بكسلات RGB مجردة) ================= */
async function decodeRawPixels(buf) {
  const n = buf.length;
  if (n % 3 !== 0) throw new Error('ملف .raw يجب أن يكون بيانات RGB 8-بت (الحجم يقبل القسمة على 3)');
  const px = n / 3;
  const side = Math.sqrt(px);
  if (!Number.isInteger(side)) throw new Error('تعذر تحديد أبعاد .raw — يفترض مربع RGB؛ الحجم لا يعطي مربعاً كاملاً');
  const w = side | 0;
  const h = w;
  const img = makeImage(w, h);
  for (let i = 0, p = 0; i < px; i++, p += 4) {
    img.rgba[p] = buf[i * 3]; img.rgba[p + 1] = buf[i * 3 + 1]; img.rgba[p + 2] = buf[i * 3 + 2]; img.rgba[p + 3] = 255;
  }
  return img;
}

/* سجل أجهزة فك الترميز */
const DECODERS = {
  jpg: decodeWithSharp, jpeg: decodeWithSharp, jpe: decodeWithSharp, jfif: decodeWithSharp,
  png: decodeWithSharp, webp: decodeWithSharp, avif: decodeWithSharp, gif: decodeWithSharp,
  svg: decodeSvg, tif: decodeTiff, tiff: decodeTiff,
  bmp: decodeBmp, dib: decodeDib,
  ico: decodeIcoCur, cur: decodeIcoCur, icns: decodeIcns,
  heic: decodeHeic, heif: decodeHeic,
  jxl: decodeJxl,
  jp2: decodeJp2, j2k: decodeJp2, jpf: decodeJp2, jpx: decodeJp2, jpm: decodeJp2, mj2: decodeJp2,
  raw: decodeRawPixels,
  dng: decodeRaw, cr2: decodeRaw, cr3: decodeRaw, nef: decodeRaw, nrw: decodeRaw, arw: decodeRaw,
  srf: decodeRaw, sr2: decodeRaw, raf: decodeRaw, orf: decodeRaw, rw2: decodeRaw, rwl: decodeRaw,
  pef: decodeRaw, '3fr': decodeRaw, iiq: decodeRaw, x3f: decodeRaw, erf: decodeRaw, kdc: decodeRaw,
  dcr: decodeRaw, mrw: decodeRaw, mef: decodeRaw, mos: decodeRaw, srw: decodeRaw,
  psd: decodePsd, psb: decodePsd, xcf: decodeXcf, ai: decodeAi, eps: decodeEps,
  cdr: decodeCdr, wmf: decodeWmf, emf: decodeEmf, pdf: decodePdf,
  dds: decodeDds, tga: decodeTga, pcx: decodePcx,
  ppm: decodePnm, pgm: decodePnm, pbm: decodePnm, pnm: decodePnm, pam: decodePnm,
  hdr: decodeHdr, exr: decodeExr, fits: decodeFits, 'fits.gz': decodeFits,
  sgi: decodeSgi, rgb: decodeSgi, rgba: decodeSgi,
};
const GZ_DECODERS = new Set(['fits']);

/** فك ترميز ملف: يعيد الصورة الأساسية */
async function decodeAny(ext, buf) {
  const decoder = DECODERS[ext];
  if (!decoder) throw new Error(`لا يوجد فاك ترميز للصيغة .${ext}`);
  if (ext === 'fits.gz') return decoder(buf, true);
  return decoder(buf);
}

module.exports = {
  decodeAny, decodeWithSharp, decodeTiff, decodePsd, decodePdf, decodeRaw, decodeJp2, decodeJxl,
  parseDib, decodeDds, decodeTga, decodePnm, decodeHdr, decodeExr, decodeFits, decodeSgi, decodeXcf,
  DECODERS,
};

'use strict';
/* codecs.js — المرمّزات المخصصة (نسخة متصفح من src/decoders.js و src/encoders.js) */
(function () {
  const U = IC;

  /* خطافات تُضبط من app.js: فك PNG/JPEG/TIFF مدمج، وترميز PNG */
  U.hooks = {
    decodeImageBytes: null, // async (bytes) -> {width,height,rgba}
    encodePng: null,        // async (img, w, h) -> Uint8Array
  };

  function resizeRgba(img, w, h) {
    if (w === img.width && h === img.height) return img.rgba;
    const src = U.imageToCanvas(img);
    const dst = U.createCanvas(w, h);
    const ctx = dst.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data);
  }
  U.resizeRgba = resizeRgba;

  /* ================= DIB / BMP ================= */
  function parseDib(buf, off) {
    let p = off;
    const hdrSize = buf.readUInt32LE(p);
    if (![12, 40, 52, 56, 64, 108, 124].includes(hdrSize)) throw new Error('ترويسة DIB غير صالحة');
    let w, h, bpp, comp = 0, clrUsed = 0, masks = null;
    if (hdrSize === 12) {
      w = buf.readUInt16LE(p + 4); h = buf.readUInt16LE(p + 6);
      bpp = buf.readUInt16LE(p + 10);
    } else {
      w = buf.readInt32LE(p + 4); h = Math.abs(buf.readInt32LE(p + 8));
      bpp = buf.readUInt16LE(p + 14);
      comp = buf.readUInt32LE(p + 16); clrUsed = buf.readUInt32LE(p + 32);
      if ((hdrSize === 40 && comp === 3) || hdrSize >= 52) {
        masks = [buf.readUInt32LE(p + 40), buf.readUInt32LE(p + 44), buf.readUInt32LE(p + 48), hdrSize >= 56 ? buf.readUInt32LE(p + 52) : 0xff000000];
      }
    }
    if (w <= 0 || h <= 0 || w > 30000 || h > 30000) throw new Error('أبعاد غير منطقية');
    const topDown = hdrSize !== 12 && buf.readInt32LE(off + 8) < 0;
    let palOff = p + hdrSize;
    if (comp === 3 && hdrSize === 40) palOff += 12;
    const entrySize = hdrSize === 12 ? 3 : 4;
    const palette = [];
    const palCount = bpp <= 8 ? (clrUsed || (1 << bpp)) : 0;
    for (let i = 0; i < palCount; i++) palette.push([buf[palOff + i * entrySize + 2], buf[palOff + i * entrySize + 1], buf[palOff + i * entrySize]]);
    const pxOff = palOff + palCount * entrySize;
    const img = U.makeImage(w, h);
    const rgba = img.rgba;
    const rowSize = Math.floor((bpp * w + 31) / 32) * 4;
    const shiftOf = (mask) => { let s = 0, m = mask; while ((m & 1) === 0 && s < 32) { m >>>= 1; s++; } return s; };
    const scaleChan = (v, mask) => {
      const bits = Math.ceil(Math.log2(mask + 1));
      return bits >= 8 ? ((v * 255) >> (bits - 8)) & 255 : (v * 255) / ((1 << bits) - 1) | 0;
    };
    if (comp === 0 || comp === 3) {
      if (bpp === 32 || bpp === 16) {
        const [mr, mg, mb, ma] = masks && bpp === 32 ? masks : bpp === 16 ? [0x7c00, 0x03e0, 0x001f, 0x8000] : [0xff0000, 0xff00, 0xff, 0xff000000];
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
            const i = row + x * 3, d = y * w + x;
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
    } else if (comp === 1 && bpp === 8) {
      let ip = pxOff, x = 0, y = 0;
      while (ip < buf.length && y < h) {
        const cnt = buf[ip++]; const val = buf[ip++];
        if (cnt > 0) {
          for (let k = 0; k < cnt && x < w; k++) {
            const c = palette[val] || [0, 0, 0];
            const d = y * w + x++;
            rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = 255;
          }
        } else if (val === 0) { x = 0; y++; }
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
    } else if (comp === 2 && bpp === 4) {
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
        } else if (val === 0) { x = 0; y++; }
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
    } else throw new Error(`ضغط BMP رقم ${comp} غير مدعوم`);
    if (topDown) {
      const flipped = U.makeImage(w, h);
      for (let y = 0; y < h; y++) flipped.rgba.set(rgba.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      return flipped;
    }
    return img;
  }
  U.decodeBmp = (buf) => {
    if (buf.readUInt16LE(0) !== 0x4d42) throw new Error('ليس ملف BMP صالح');
    return parseDib(buf, 14);
  };
  U.decodeDib = (buf) => {
    const hdr = buf.readUInt32LE(0);
    if (![12, 40, 52, 56, 64, 108, 124].includes(hdr)) throw new Error('ليس ملف DIB صالح');
    return parseDib(buf, 0);
  };

  /* ================= ICO / CUR ================= */
  U.decodeIcoCur = async function (buf) {
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
      if (!best || w * h > best.w * best.h) best = { w, h, size, off };
    }
    if (!best) throw new Error('لا توجد صور داخل الملف');
    const data = buf.subarray(best.off, best.off + best.size);
    if (data[0] === 0x89 && data[1] === 0x50) return U.hooks.decodeImageBytes(data);
    const clone = Buffer.from(data);
    const h2 = Math.abs(clone.readInt32LE(8));
    clone.writeInt32LE(h2 >> 1, 8);
    return parseDib(clone, 0);
  };

  /* ================= ICNS ================= */
  const ICNS_TYPES = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
  U.decodeIcns = async function (buf) {
    if (U.ascii(buf, 0, 4) !== 'icns') throw new Error('ليس ملف ICNS صالح');
    let p = 8;
    const entries = [];
    while (p + 8 <= buf.length) {
      const type = U.ascii(buf, p, 4);
      const len = buf.readUInt32BE(p + 4);
      if (len < 8 || p + len > buf.length) break;
      entries.push({ type, data: buf.subarray(p + 8, p + len) });
      p += len;
    }
    entries.sort((a, b) => (ICNS_TYPES[b.type] || 0) - (ICNS_TYPES[a.type] || 0));
    for (const e of entries) {
      const d = e.data;
      try {
        if ((d[0] === 0x89 && d[1] === 0x50) || (d[0] === 0xff && d[1] === 0xd8)) return await U.hooks.decodeImageBytes(d);
        if (d.length > 4 && d.readUInt32BE(0) === 0x0000000c) return await U.hooks.decodeImageBytes(d); // jp2 عبر libraw/utif؟ يفشل بأمان
      } catch (_) {}
    }
    throw new Error('تعذر فك ترميز أي إدخال داخل ICNS');
  };

  /* ================= DDS ================= */
  U.decodeDds = function (buf) {
    if (U.ascii(buf, 0, 4) !== 'DDS ') throw new Error('ليس ملف DDS صالح');
    const height = buf.readUInt32LE(12), width = buf.readUInt32LE(16);
    const fourCC = U.ascii(buf, 84, 4);
    const pfflags = buf.readUInt32LE(80);
    const img = U.makeImage(width, height);
    const rgba = img.rgba;
    const DDPF = { ALPHA: 0x2, RGB: 0x40, LUM: 0x20000 };
    if (['DXT1', 'DXT2', 'DXT3', 'DXT4', 'DXT5', 'BC1 ', 'BC2 ', 'BC3 ', 'BC4 ', 'BC5 '].includes(fourCC)) {
      const isDxt1 = fourCC === 'DXT1' || fourCC === 'BC1 ';
      const isDxt3 = ['DXT2', 'DXT3', 'BC2 '].includes(fourCC);
      const isDxt5 = ['DXT4', 'DXT5', 'BC3 '].includes(fourCC);
      const isBc4 = fourCC === 'BC4 ';
      const isBc5 = fourCC === 'BC5 ';
      let p = 128;
      const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
      const bsize = isDxt1 || isBc4 ? 8 : 16;
      const clamp4 = (v, max) => Math.min(v, max - 1);
      const dec4 = (block, off) => {
        const p0 = block[off], p1 = block[off + 1];
        const pal = [p0, p1];
        if (p0 > p1) { for (let i = 1; i < 7; i++) pal.push(Math.round(p0 + ((p1 - p0) * i) / 7)); pal.push(255); }
        else { for (let i = 1; i < 5; i++) pal.push(Math.round(p0 + ((p1 - p0) * i) / 5)); pal.push(0); }
        const idxs = [];
        let bitPos = 0;
        for (let i = 0; i < 16; i++) { idxs.push((block[off + 2 + (bitPos >> 3)] >> (bitPos & 7)) & 7); bitPos += 3; }
        return { pal, idxs };
      };
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          const block = buf.subarray(p, p + bsize); p += bsize;
          if (isBc4 || isBc5) {
            const r = dec4(block, 0);
            if (isBc4) {
              for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
                const x = clamp4(bx + px, width), y = clamp4(by + py, height);
                const v = r.pal[r.idxs[py * 4 + px]] || 0;
                const d = (y * width + x) * 4;
                rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255;
              }
              continue;
            }
            const g = dec4(block, 8);
            for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
              const x = clamp4(bx + px, width), y = clamp4(by + py, height);
              const i4 = py * 4 + px;
              const d = (y * width + x) * 4;
              rgba[d] = r.pal[r.idxs[i4]] || 0;
              rgba[d + 1] = g.pal[g.idxs[i4]] || 0;
              rgba[d + 2] = 0; rgba[d + 3] = 255;
            }
            continue;
          }
          const c0 = block.readUInt16LE(0), c1 = block.readUInt16LE(2);
          const expand = (c) => [((c >> 11) & 0x1f) * 255 / 31 | 0, ((c >> 5) & 0x3f) * 255 / 63 | 0, (c & 0x1f) * 255 / 31 | 0];
          const col0 = expand(c0), col1 = expand(c1);
          const pal = [col0, col1];
          if (c0 > c1 || !isDxt1) {
            for (let i = 1; i < 3; i++) pal.push([
              (col0[0] * (3 - i) + col1[0] * i) / 3 | 0,
              (col0[1] * (3 - i) + col1[1] * i) / 3 | 0,
              (col0[2] * (3 - i) + col1[2] * i) / 3 | 0]);
            pal.push([0, 0, 0]);
          } else {
            pal.push([(col0[0] + col1[0]) >> 1, (col0[1] + col1[1]) >> 1, (col0[2] + col1[2]) >> 1]);
            pal.push([0, 0, 0]);
          }
          const bits = block.readUInt32LE(4);
          let alphaBlock = null;
          if (isDxt3) {
            alphaBlock = [];
            for (let i = 0; i < 16; i++) {
              const byte = block[8 + (i >> 1)];
              alphaBlock.push((i % 2 === 0) ? (byte & 0xf) * 17 : (byte >> 4) * 17);
            }
          } else if (isDxt5) {
            const a0 = block[8], a1 = block[9];
            const apal = [a0, a1];
            if (a0 > a1) { for (let i = 1; i < 7; i++) apal.push(a0 + ((a1 - a0) * i) / 7); apal.push(255); }
            else { for (let i = 1; i < 5; i++) apal.push(a0 + ((a1 - a0) * i) / 5); apal.push(0); }
            alphaBlock = [];
            let bitPos = 0;
            for (let i = 0; i < 16; i++) { alphaBlock.push(apal[(block[10 + (bitPos >> 3)] >> (bitPos & 7)) & 7] | 0); bitPos += 3; }
          }
          for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
            const x = clamp4(bx + px, width), y = clamp4(by + py, height);
            const i4 = py * 4 + px;
            const ci = (bits >> (i4 * 2)) & 3;
            const c = pal[ci];
            const d = (y * width + x) * 4;
            rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2];
            rgba[d + 3] = isDxt1 ? ((c0 <= c1 && ci === 3) ? 0 : 255) : (alphaBlock ? alphaBlock[i4] : 255);
          }
        }
      }
      return img;
    }
    if ((pfflags & DDPF.RGB) || (pfflags & DDPF.LUM) || (pfflags & DDPF.ALPHA)) {
      const rmask = buf.readUInt32LE(92) || 0xff0000, gmask = buf.readUInt32LE(96) || 0xff00, bmask = buf.readUInt32LE(100) || 0xff;
      const amask = buf.readUInt32LE(104);
      const bpp = buf.readUInt32LE(88);
      const pitch = buf.readUInt32LE(20);
      const rowSize = pitch > 0 ? pitch : Math.floor((bpp * width + 7) / 8);
      const maskExtract = (v, mask) => {
        if (!mask) return 0;
        let sh = 0, m = mask;
        while ((m & 1) === 0) { m >>>= 1; sh++; }
        const bits = Math.ceil(Math.log2(mask + 1));
        let val = (v & mask) >>> sh;
        if (bits >= 8) val = val >> (bits - 8); else val = (val * 255) / ((1 << bits) - 1);
        return val | 0;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = 128 + y * rowSize + x * (bpp >> 3);
          const v = bpp === 32 ? buf.readUInt32LE(i) : bpp === 16 ? buf.readUInt16LE(i) : buf[i];
          const d = y * width + x;
          rgba[d * 4] = maskExtract(v, rmask);
          rgba[d * 4 + 1] = maskExtract(v, gmask);
          rgba[d * 4 + 2] = maskExtract(v, bmask);
          rgba[d * 4 + 3] = amask ? maskExtract(v, amask) : 255;
        }
      }
      return img;
    }
    throw new Error('تنسيق DDS غير مدعوم (fourCC: ' + fourCC + ')');
  };

  /* ================= TGA ================= */
  U.decodeTga = function (buf) {
    if (buf.length < 18) throw new Error('ليس ملف TGA صالح');
    const idLen = buf[0], cmapType = buf[1], imgType = buf[2];
    const cmapFirst = buf.readUInt16LE(3), cmapLen = buf.readUInt16LE(5);
    const w = buf.readUInt16LE(12), h = buf.readUInt16LE(14);
    const bpp = buf[16], desc = buf[17];
    if (!w || !h) throw new Error('أبعاد TGA صفرية');
    let p = 18 + idLen;
    const bytesPer = bpp >> 3;
    const palette = [];
    if (cmapType === 1) {
      const bpc = cmapBitsBytes(buf[7]);
      for (let i = 0; i < cmapLen; i++) {
        palette[cmapFirst + i] = [buf[p + i * bpc + 2], buf[p + i * bpc + 1], buf[p + i * bpc], bpc === 4 ? buf[p + i * bpc + 3] : 255];
      }
      p += cmapLen * bpc;
    }
    function cmapBitsBytes(bits) { return bits >> 3 || 2; }
    const img = U.makeImage(w, h);
    const rgba = img.rgba;
    const readPixel = (pos) => {
      if (imgType === 1 || imgType === 9) return palette[buf[pos]] || [0, 0, 0, 255];
      if (imgType === 3 || imgType === 11) { const v = buf[pos]; return [v, v, v, 255]; }
      if (bpp === 16) {
        const v = buf.readUInt16LE(pos);
        return [((v >> 10) & 0x1f) * 255 / 31 | 0, ((v >> 5) & 0x1f) * 255 / 31 | 0, (v & 0x1f) * 255 / 31 | 0, 255];
      }
      return [buf[pos + 2], buf[pos + 1], buf[pos], bpp === 32 ? buf[pos + 3] : 255];
    };
    const rle = imgType >= 9;
    let x = 0, y = 0;
    const put = (c) => {
      const d = y * w + x++;
      rgba[d * 4] = c[0]; rgba[d * 4 + 1] = c[1]; rgba[d * 4 + 2] = c[2]; rgba[d * 4 + 3] = c[3];
      if (x >= w) { x = 0; y++; }
    };
    if (!rle) {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { put(readPixel(p)); p += bytesPer; }
    } else {
      x = 0; y = 0;
      while (y < h && p < buf.length) {
        const hdr = buf[p++];
        const count = (hdr & 0x7f) + 1;
        if (hdr & 0x80) { const c = readPixel(p); p += bytesPer; for (let k = 0; k < count && y < h; k++) put(c); }
        else { for (let k = 0; k < count && y < h; k++) { put(readPixel(p)); p += bytesPer; } }
      }
    }
    if (!(desc & 0x20)) {
      const flipped = U.makeImage(w, h);
      for (let yy = 0; yy < h; yy++) flipped.rgba.set(rgba.subarray((h - 1 - yy) * w * 4, (h - yy) * w * 4), yy * w * 4);
      return flipped;
    }
    return img;
  };

  /* ================= PCX ================= */
  U.decodePcx = function (buf) {
    if (buf[0] !== 0x0a) throw new Error('ليس ملف PCX صالح');
    const w = buf.readUInt16LE(8) - buf.readUInt16LE(4) + 1;
    const h = buf.readUInt16LE(10) - buf.readUInt16LE(6) + 1;
    const bpp = buf[3], planes = buf[65], bytesPerLine = buf.readUInt16LE(66);
    const img = U.makeImage(w, h);
    const rgba = img.rgba;
    const rlePcxLen = (src, outLen) => {
      let ip = 0, op = 0;
      while (op < outLen && ip < src.length) {
        const b = src[ip++];
        if ((b & 0xc0) === 0xc0) { op += b & 0x3f; ip++; } else op++;
      }
      return ip;
    };
    if (bpp === 8 && planes === 3) {
      let p = 128;
      for (let y = 0; y < h; y++) {
        const src = buf.subarray(p);
        const row = U.rleDecodePCX(src, planes * bytesPerLine);
        p += rlePcxLen(src, planes * bytesPerLine);
        for (let x = 0; x < w; x++) {
          const d = (y * w + x) * 4;
          rgba[d] = row[x]; rgba[d + 1] = row[bytesPerLine + x]; rgba[d + 2] = row[2 * bytesPerLine + x]; rgba[d + 3] = 255;
        }
      }
    } else if (bpp === 8 && planes === 1) {
      let palOff = buf.length - 769;
      if (buf[palOff] !== 0x0c) throw new Error('لوحة PCX مفقودة');
      const palette = [];
      for (let i = 0; i < 256; i++) palette.push([buf[palOff + 1 + i * 3], buf[palOff + 2 + i * 3], buf[palOff + 3 + i * 3]]);
      let p = 128;
      for (let y = 0; y < h; y++) {
        const src = buf.subarray(p);
        const row = U.rleDecodePCX(src, bytesPerLine);
        p += rlePcxLen(src, bytesPerLine);
        for (let x = 0; x < w; x++) {
          const c = palette[row[x]] || [0, 0, 0];
          const d = (y * w + x) * 4;
          rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = 255;
        }
      }
    } else if (bpp === 1) {
      const is4 = planes === 4;
      const palette = [];
      for (let i = 0; i < 16; i++) palette.push([buf[16 + i * 3], buf[17 + i * 3], buf[18 + i * 3]]);
      let p = 128;
      for (let y = 0; y < h; y++) {
        const src = buf.subarray(p);
        const row = U.rleDecodePCX(src, planes * bytesPerLine);
        p += rlePcxLen(src, planes * bytesPerLine);
        for (let x = 0; x < w; x++) {
          let c;
          if (is4) {
            let idx = 0;
            for (let pl = 0; pl < 4; pl++) idx |= (((row[pl * bytesPerLine + (x >> 3)] >> (7 - (x & 7))) & 1) << pl);
            c = palette[idx];
          } else {
            const bit = (row[(x >> 3)] >> (7 - (x & 7))) & 1;
            c = [bit ? 255 : 0, bit ? 255 : 0, bit ? 255 : 0];
          }
          const d = (y * w + x) * 4;
          rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = 255;
        }
      }
    } else throw new Error(`تركيبة PCX غير مدعومة (bpp=${bpp}, planes=${planes})`);
    return img;
  };

  /* ================= PNM / PAM ================= */
  U.decodePnm = function (buf) {
    let p = 0;
    if (buf[p] !== 0x50 || buf[p + 1] < 0x31 || buf[p + 1] > 0x37) throw new Error('ليس ملف PNM صالح');
    const magic = String.fromCharCode(buf[p], buf[p + 1]); p += 2;
    const readToken = () => {
      for (;;) {
        while (p < buf.length && [0x20, 0x09, 0x0d, 0x0a].includes(buf[p])) p++;
        if (buf[p] === 0x23) { while (p < buf.length && buf[p] !== 0x0a) p++; continue; }
        break;
      }
      let tok = '';
      while (p < buf.length) {
        const c = buf[p];
        if ([0x20, 0x09, 0x0d, 0x0a, 0x23].includes(c)) break;
        tok += String.fromCharCode(c); p++;
      }
      return tok;
    };
    let width = 0, height = 0, maxval = 255, depth = 0, tupltype = null;
    if (magic === 'P7') {
      for (;;) {
        const t = readToken();
        if (t === 'WIDTH') width = +readToken();
        else if (t === 'HEIGHT') height = +readToken();
        else if (t === 'DEPTH') depth = +readToken();
        else if (t === 'MAXVAL') maxval = +readToken();
        else if (t === 'TUPLTYPE') tupltype = readToken();
        else if (t === 'ENDHDR') break;
      }
    } else {
      width = +readToken(); height = +readToken();
      if (magic !== 'P1' && magic !== 'P4') maxval = +readToken();
    }
    if (!width || !height) throw new Error('أبعاد PNM غير صالحة');
    if (!['P1', 'P2', 'P3'].includes(magic)) p++;
    const w = width, h = height;
    const img = U.makeImage(w, h);
    const rgba = img.rgba;
    const binary = ['P4', 'P5', 'P6', 'P7'].includes(magic);
    const channels = magic === 'P7' ? depth : magic === 'P6' ? 3 : magic === 'P5' || magic === 'P4' ? 1 : magic === 'P3' ? 3 : 1;
    const isBitmap = magic === 'P1' || magic === 'P4';
    const scale = isBitmap ? 255 : 255 / maxval;
    if (binary && isBitmap) {
      const rowBytes = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const bit = (buf[p + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const d = (y * w + x) * 4;
        const v = bit ? 0 : 255;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255;
      }
    } else if (binary) {
      const wide = maxval > 255, bpc = wide ? 2 : 1;
      const hasAlpha = magic === 'P7' && (tupltype === 'RGB_ALPHA' || depth === 4);
      const isGray = magic === 'P5' || (magic === 'P7' && (tupltype === 'GRAYSCALE' || depth === 1));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = (y * w + x) * 4;
        const base = p + (y * w + x) * channels * bpc;
        const get = (c) => wide ? (buf[base + c * 2] << 8 | buf[base + c * 2 + 1]) * scale : buf[base + c] * scale;
        if (isGray) { const v = get(0) | 0; rgba[d] = rgba[d + 1] = rgba[d + 2] = v; }
        else { rgba[d] = get(0) | 0; rgba[d + 1] = get(1) | 0; rgba[d + 2] = get(2) | 0; }
        rgba[d + 3] = hasAlpha ? get(3) | 0 : 255;
      }
    } else {
      const nextNum = () => {
        for (;;) {
          const c = buf[p];
          if (c === 0x23) { while (p < buf.length && buf[p] !== 0x0a) p++; continue; }
          if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a) { p++; continue; }
          break;
        }
        let v = 0;
        while (p < buf.length && buf[p] >= 0x30 && buf[p] <= 0x39) { v = v * 10 + (buf[p] - 0x30); p++; }
        return v;
      };
      for (let i = 0; i < w * h; i++) {
        const d = i * 4;
        if (isBitmap) { const v = nextNum() ? 0 : 255; rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255; }
        else if (magic === 'P3') { rgba[d] = nextNum() * scale | 0; rgba[d + 1] = nextNum() * scale | 0; rgba[d + 2] = nextNum() * scale | 0; rgba[d + 3] = 255; }
        else { const v = nextNum() * scale | 0; rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255; }
      }
    }
    return img;
  };

  /* ================= HDR (Radiance) ================= */
  U.decodeHdr = function (buf) {
    const head = U.ascii(buf, 0, Math.min(buf.length, 4096));
    if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) throw new Error('ليس ملف HDR صالح');
    let p = 0, w = 0, h = 0;
    while (p < buf.length) {
      const nl = buf.indexOf(0x0a, p);
      if (nl === -1) break;
      const line = U.ascii(buf, p, nl - p).trim();
      p = nl + 1;
      if (line === '') break;
      const m = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(line);
      if (m) { h = +m[1]; w = +m[2]; }
    }
    if (!w || !h) throw new Error('ترويسة HDR تفتقد الأبعاد');
    const img = U.makeImage(w, h);
    img.float = { data: new Float32Array(w * h * 3) };
    const fdata = img.float.data;
    const rgbeToFloat = (r, g, b, e) => {
      if (e === 0) return [0, 0, 0];
      const f = Math.pow(2, e - 128) / 255;
      return [r * f, g * f, b * f];
    };
    for (let y = 0; y < h; y++) {
      if (buf[p] === 2 && buf[p + 1] === 2 && buf[p + 2] === ((w >> 8) & 0xff) && buf[p + 3] === (w & 0xff)) {
        p += 4;
        const planes = [Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w)];
        for (let c = 0; c < 4; c++) {
          const plane = planes[c];
          let x = 0;
          while (x < w) {
            const cnt = buf[p++];
            if (cnt > 128) { plane.fill(buf[p++], x, x + cnt - 128); x += cnt - 128; }
            else { buf.copy(plane, x, p, p + cnt); p += cnt; x += cnt; }
          }
        }
        for (let x = 0; x < w; x++) {
          const [r, g, b] = rgbeToFloat(planes[0][x], planes[1][x], planes[2][x], planes[3][x]);
          const q = (y * w + x) * 3;
          fdata[q] = r; fdata[q + 1] = g; fdata[q + 2] = b;
        }
      } else {
        for (let x = 0; x < w; x++) {
          const [r, g, b] = rgbeToFloat(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
          p += 4;
          const q = (y * w + x) * 3;
          fdata[q] = r; fdata[q + 1] = g; fdata[q + 2] = b;
        }
      }
    }
    img.rgba = U.floatToRgba(fdata, w, h);
    return img;
  };

  /* ================= EXR ================= */
  U.decodeExr = async function (buf) {
    if (!(buf[0] === 0x76 && buf[1] === 0x2f && buf[2] === 0x31 && buf[3] === 0x01)) throw new Error('ليس ملف EXR صالح');
    const version = buf.readUInt32LE(4);
    if ((version >> 9) & 1) throw new Error('ملفات EXR المبلطة (tiled) غير مدعومة');
    if ((version >> 12) & 1) throw new Error('ملفات EXR متعددة الأجزاء غير مدعومة');
    let p = 8;
    const attrs = {};
    const readStr = () => {
      const s = p;
      while (p < buf.length && buf[p] !== 0) p++;
      const v = U.ascii(buf, s, p - s); p++;
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
    if (compression >= 4) throw new Error('ضغط EXR غير مدعوم (PIZ/DWAA) — مدعوم: NONE/RLE/ZIP/ZIPS');
    const dwx = attrs.dataWindow.off;
    const xMin = buf.readInt32LE(dwx), yMin = buf.readInt32LE(dwx + 4);
    const xMax = buf.readInt32LE(dwx + 8), yMax = buf.readInt32LE(dwx + 12);
    const w = xMax - xMin + 1, h = yMax - yMin + 1;
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
      const pxType = buf.readInt32LE(q); q += 12;
      channels.push({ name, type: pxType });
    }
    const names = channels.map((c) => c.name);
    let rC, gC, bC;
    if (names.includes('R')) {
      rC = channels.find((c) => c.name === 'R'); gC = channels.find((c) => c.name === 'G'); bC = channels.find((c) => c.name === 'B');
    } else if (names.includes('Y')) {
      rC = gC = bC = channels.find((c) => c.name === 'Y');
    } else throw new Error('قنوات EXR غير مدعومة (مطلوب RGB أو Y)');
    const usedSet = new Set([rC.name, gC.name, bC.name]);
    const chanList = channels.filter((c) => usedSet.has(c.name) || c.name === 'A');
    if (!chanList.every((c) => c.type === 1 || c.type === 2)) throw new Error('نوع بكسل EXR غير مدعوم (UINT)');
    const linesPerBlock = compression === 3 ? 16 : 1;
    const blockCount = Math.ceil(h / linesPerBlock);
    const offsets = [];
    for (let i = 0; i < blockCount; i++) offsets.push(Number(buf.readBigUInt64LE(p + i * 8)));
    const bytesPerSample = (t) => (t === 2 ? 4 : 2);
    const samplesPerPixel = chanList.reduce((a, c) => a + bytesPerSample(c.type), 0);
    const img = U.makeImage(w, h);
    img.float = { data: new Float32Array(w * h * 3) };
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
      dp += 4; // y
      const dataSize = buf.readUInt32LE(dp); dp += 4;
      if (compression === 0) parseInterleavedLine(buf.subarray(dp, dp + w * samplesPerPixel), yStart - yMin);
      else if (compression === 1) parseInterleavedLine(rleDecodeLine(buf, dp, w * samplesPerPixel), yStart - yMin);
      else {
        const raw = await U.zlibInflate(buf.subarray(dp, dp + dataSize));
        let acc = 0;
        for (let i = 0; i < raw.length; i++) { acc = (acc + raw[i]) & 0xff; raw[i] = acc; }
        parsePlanar(raw, yStart, nLines);
      }
    }
    for (let i = 0; i < w * h; i++) {
      const q3 = i * 3;
      img.float.data[q3] = planes[rC.name][i];
      img.float.data[q3 + 1] = planes[gC.name][i];
      img.float.data[q3 + 2] = planes[bC.name][i];
    }
    img.rgba = U.floatToRgba(img.float.data, w, h);
    return img;
  };

  /* ================= FITS ================= */
  U.decodeFits = async function (buf, isGz) {
    let data = buf;
    if (isGz || (data[0] === 0x1f && data[1] === 0x8b)) data = await U.gunzip(data);
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
    const w = parseInt(cards.NAXIS1 || '0', 10), h = parseInt(cards.NAXIS2 || '0', 10);
    const bitpix = parseInt(cards.BITPIX || '8', 10);
    const bscale = parseFloat(cards.BSCALE || '1'), bzero = parseFloat(cards.BZERO || '0');
    if (!w || !h) throw new Error('أبعاد FITS غير صالحة');
    const bytesPer = Math.abs(bitpix) >> 3;
    const count = w * h;
    const img = U.makeImage(w, h);
    img.float = { data: new Float32Array(count * 3) };
    const values = new Float32Array(count);
    let min = Infinity, max = -Infinity;
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
    const range = max - min || 1;
    const sqrtScale = max > 20;
    for (let i = 0; i < count; i++) {
      let t = (values[i] - min) / range;
      if (sqrtScale) t = Math.sqrt(Math.max(0, t));
      const v = Math.round(t * 255);
      img.float.data[i * 3] = img.float.data[i * 3 + 1] = img.float.data[i * 3 + 2] = t;
      img.rgba[i * 4] = v; img.rgba[i * 4 + 1] = v; img.rgba[i * 4 + 2] = v; img.rgba[i * 4 + 3] = 255;
    }
    return img;
  };

  /* ================= SGI ================= */
  U.decodeSgi = function (buf) {
    if (buf.readUInt16BE(0) !== 474) throw new Error('ليس ملف SGI صالح');
    const storage = buf.readUInt16BE(2);
    const bpc = buf.readUInt16BE(4);
    const w = buf.readUInt16BE(8), h = buf.readUInt16BE(10);
    const zsize = buf.readUInt16BE(12) || 1;
    const img = U.makeImage(w, h);
    const rgba = img.rgba;
    const z = Math.min(zsize, 4);
    if (storage === 0) {
      let p = 512;
      for (let y = 0; y < h; y++) for (let c = 0; c < z; c++) for (let x = 0; x < w; x++) {
        let v;
        if (bpc === 1) v = buf[p++];
        else { v = buf.readUInt16BE(p); p += 2; }
        const val = bpc === 1 ? v : v >> 8;
        const d = (y * w + x) * 4;
        if (c < 3) rgba[d + c] = val; else rgba[d + 3] = val;
      }
    } else {
      const tabOff = 512;
      for (let y = 0; y < h; y++) for (let c = 0; c < z; c++) {
        const base = tabOff + (y * zsize + c) * 8;
        const off = buf.readUInt32BE(base), len = buf.readUInt32BE(base + 4);
        let p = off;
        const end = off + len;
        let x = 0;
        while (p < end && x < w) {
          const cnt0 = buf[p++];
          if (cnt0 < 0x80) {
            const cnt = cnt0 + 1;
            for (let k = 0; k < cnt && x < w; k++) {
              let v;
              if (bpc === 1) v = buf[p++];
              else { v = buf.readUInt16BE(p); p += 2; }
              const val = bpc === 1 ? v : v >> 8;
              const d = (y * w + x++) * 4;
              if (c < 3) rgba[d + c] = val; else rgba[d + 3] = val;
            }
          } else {
            const run = cnt0 - 127;
            let v;
            if (bpc === 1) v = buf[p++];
            else { v = buf.readUInt16BE(p); p += 2; }
            const val = bpc === 1 ? v : v >> 8;
            for (let k = 0; k < run && x < w; k++) {
              const d = (y * w + x++) * 4;
              if (c < 3) rgba[d + c] = val; else rgba[d + 3] = val;
            }
          }
        }
      }
    }
    const flipped = U.makeImage(w, h);
    for (let yy = 0; yy < h; yy++) flipped.rgba.set(rgba.subarray((h - 1 - yy) * w * 4, (h - yy) * w * 4), yy * w * 4);
    return flipped;
  };

  /* ================= XCF ================= */
  U.decodeXcf = async function (buf) {
    const head = U.ascii(buf, 0, 14);
    if (!head.startsWith('gimp xcf ')) throw new Error('ليس ملف XCF صالح');
    const verStr = U.ascii(buf, 9, 4);
    const version = verStr === 'file' ? 0 : parseInt(verStr.replace('v', ''), 10) || 0;
    const ptrSize = version >= 11 ? 8 : 4;
    const readPtr = (off) => ptrSize === 8 ? Number(buf.readBigUInt64LE(off)) : buf.readUInt32LE(off);
    let p = 14;
    const width = buf.readUInt32LE(p); p += 4;
    const height = buf.readUInt32LE(p); p += 4;
    p += 4; // base type
    if (version >= 4) { p += 4; if (version >= 11) p += 4; }
    let compression = 1;
    for (;;) {
      const id = buf.readUInt32LE(p); const len = buf.readUInt32LE(p + 4); p += 8;
      if (id === 0) break;
      if (id === 17 && len >= 1) compression = buf[p];
      p += len;
    }
    const layerOffsets = [];
    for (;;) {
      if (p + ptrSize > buf.length) break;
      const v = readPtr(p); p += ptrSize;
      if (v === 0) break;
      layerOffsets.push(v);
    }
    if (!layerOffsets.length) throw new Error('لا توجد طبقات في ملف XCF');
    const canvas = U.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    for (const off of layerOffsets) {
      try {
        const layer = await readXcfLayer(buf, off, readPtr, ptrSize, compression);
        if (!layer || !layer.visible || !layer.image) continue;
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(layer.image, layer.x, layer.y);
        ctx.globalAlpha = 1;
      } catch (_) {}
    }
    return U.canvasToImage(canvas);
  };
  async function readXcfLayer(buf, off, readPtr, ptrSize, defaultCompression) {
    let p = off;
    const w = buf.readUInt32LE(p); p += 4;
    const h = buf.readUInt32LE(p); p += 4;
    const type = buf.readUInt32LE(p); p += 4;
    const nameLen = buf.readUInt32LE(p); p += 4 + nameLen;
    const props = {};
    for (;;) {
      if (p + 8 > buf.length) break;
      const id = buf.readUInt32LE(p); const len = buf.readUInt32LE(p + 4); p += 8;
      if (id === 0) break;
      if (id === 6 && len === 4) props.opacity = buf.readUInt32LE(p) / 255;
      else if (id === 8 && len === 1) props.visible = buf[p] !== 0;
      else if (id === 15 && len === 8) { props.x = buf.readInt32LE(p); props.y = buf.readInt32LE(p + 4); }
      else if (id === 17 && len >= 1) props.compression = buf[p];
      p += len;
    }
    const hierarchyPtr = readPtr(p);
    if (!hierarchyPtr || !w || !h) return null;
    let q = hierarchyPtr + 12;
    const levelPtr = readPtr(q);
    if (!levelPtr) return null;
    const bppByType = [3, 4, 1, 2, 1, 2][type] || 4;
    let r = levelPtr + 8;
    const tiles = [];
    for (;;) {
      if (r + ptrSize > buf.length) break;
      const v = readPtr(r); r += ptrSize;
      if (v === 0) break;
      tiles.push(v);
    }
    if (!tiles.length) return null;
    const px = Buffer.alloc(w * h * bppByType);
    const TILE = 64;
    const comp = props.compression !== undefined ? props.compression : defaultCompression;
    let tileIdx = 0;
    for (let ty = 0; ty < h; ty += TILE) {
      for (let tx = 0; tx < w; tx += TILE) {
        if (tileIdx >= tiles.length) break;
        const tw = Math.min(TILE, w - tx), th = Math.min(TILE, h - ty);
        const tOff = tiles[tileIdx++];
        if (comp === 0) buf.copy(px, (ty * w + tx) * bppByType, tOff, tOff + tw * th * bppByType);
        else {
          let src = buf, rel = tOff;
          if (comp === 2) { src = await U.zlibInflate(buf.subarray(tOff)); rel = 0; }
          const { px: tilePx } = U.xcfRleUnTile(src, rel, tw, th, bppByType);
          for (let y = 0; y < th; y++) tilePx.copy(px, ((ty + y) * w + tx) * bppByType, y * tw * bppByType, (y + 1) * tw * bppByType);
        }
      }
    }
    const canvas = U.createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(w, h);
    const d = id.data;
    for (let i = 0; i < w * h; i++) {
      if (type === 1) { d[i * 4] = px[i * 4]; d[i * 4 + 1] = px[i * 4 + 1]; d[i * 4 + 2] = px[i * 4 + 2]; d[i * 4 + 3] = px[i * 4 + 3]; }
      else if (type === 0) { d[i * 4] = px[i * 3]; d[i * 4 + 1] = px[i * 3 + 1]; d[i * 4 + 2] = px[i * 3 + 2]; d[i * 4 + 3] = 255; }
      else if (type === 3) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i * 2]; d[i * 4 + 3] = px[i * 2 + 1]; }
      else { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i]; d[i * 4 + 3] = 255; }
    }
    ctx.putImageData(id, 0, 0);
    return { image: canvas, opacity: props.opacity !== undefined ? props.opacity : 1, visible: props.visible !== false, x: props.x || 0, y: props.y || 0 };
  }

  /* ================= WMF / EMF (استخراج الصور النقطية) ================= */
  U.decodeWmf = function (buf) {
    let p = 0;
    if (buf.readUInt32LE(0) === 0x9ac6cdd7) p = 22;
    if (buf.readUInt16LE(p) !== 1 && buf.readUInt16LE(p) !== 2) throw new Error('ليس ملف WMF صالح');
    p += 18;
    let winW = 1024, winH = 1024, dibs = [];
    while (p + 6 <= buf.length) {
      const sizeWords = buf.readUInt32LE(p);
      if (sizeWords < 3 || p + sizeWords * 2 > buf.length) break;
      const fn = buf.readUInt16LE(p + 4);
      const po = p + 6;
      if (fn === 0x020c) { winW = Math.abs(buf.readInt16LE(po + 2)) || 1024; winH = Math.abs(buf.readInt16LE(po)) || 1024; }
      if (fn === 0x0f43) {
        try { dibs.push({ img: parseDib(Buffer.from(buf.subarray(po + 22)), 0), x: buf.readInt16LE(po + 20), y: buf.readInt16LE(po + 18), w: buf.readInt16LE(po + 16), h: buf.readInt16LE(po + 14) }); } catch (_) {}
      }
      p += sizeWords * 2;
    }
    if (!dibs.length) throw new Error('تعذر استخراج صورة من WMF (لا توجد صور نقطية مدمجة)');
    dibs.sort((a, b) => (b.img.width * b.img.height) - (a.img.width * a.img.height));
    return composeDibs(dibs, winW, winH);
  };
  U.decodeEmf = function (buf) {
    if (buf.readUInt32LE(0) !== 1) throw new Error('ليس ملف EMF صالح');
    const frame = [buf.readInt32LE(24), buf.readInt32LE(28), buf.readInt32LE(32), buf.readInt32LE(36)];
    let fw = frame[2] - frame[0], fh = frame[3] - frame[1];
    if (fw <= 0 || fh <= 0) { fw = 800; fh = 600; }
    let p = buf.readUInt32LE(4);
    const dibs = [];
    while (p + 8 <= buf.length) {
      const type = buf.readUInt32LE(p);
      const size = buf.readUInt32LE(p + 4);
      if (size < 8 || p + size > buf.length) break;
      if (type === 81) {
        try {
          const offBmi = buf.readUInt32LE(p + 48), cbBmi = buf.readUInt32LE(p + 52);
          const offBits = buf.readUInt32LE(p + 56), cbBits = buf.readUInt32LE(p + 60);
          const full = Buffer.concat([Buffer.from(buf.subarray(p + offBmi, p + offBmi + cbBmi)), Buffer.from(buf.subarray(p + offBits, p + offBits + cbBits))]);
          dibs.push({ img: parseDib(full, 0), x: 0, y: 0, w: 0, h: 0 });
        } catch (_) {}
      }
      p += size;
    }
    if (!dibs.length) throw new Error('تعذر استخراج صورة من EMF (لا توجد صور نقطية مدمجة)');
    dibs.sort((a, b) => (b.img.width * b.img.height) - (a.img.width * a.img.height));
    return composeDibs(dibs, fw, fh);
  };
  function composeDibs(dibs, winW, winH) {
    const main = dibs[0].img;
    const scale = Math.max(1, Math.min(4, 2048 / Math.max(winW, winH)));
    const canvas = U.createCanvas(Math.round(winW * scale), Math.round(winH * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    for (const d of dibs) {
      const c = U.imageToCanvas(d.img);
      const dw = d.w > 0 ? d.w : d.img.width, dh = d.h > 0 ? d.h : d.img.height;
      ctx.drawImage(c, d.x, d.y, dw, dh);
    }
    const out = U.canvasToImage(canvas);
    // قصّ إلى حدود الصورة الرئيسية إن كانت أصغر
    if (main.width * 1.02 < out.width || main.height * 1.02 < out.height) {
      const sx = Math.min(out.width, Math.round(main.width * scale));
      const sy = Math.min(out.height, Math.round(main.height * scale));
      const c2 = U.createCanvas(sx, sy);
      c2.getContext('2d').drawImage(canvas, 0, 0, sx, sy, 0, 0, sx, sy);
      return U.canvasToImage(c2);
    }
    return out;
  }

  /* ================= صور مدمجة (EPS/CDR/AI) ================= */
  U.findEmbeddedImage = async function (buf) {
    const candidates = [];
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) { candidates.push({ off: i, kind: 'jpg' }); i += 1024; }
      else if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4e && buf[i + 3] === 0x47) { candidates.push({ off: i, kind: 'png' }); i += 8; }
      else if ((buf[i] === 0x49 && buf[i + 1] === 0x49 && buf[i + 2] === 0x2a) || (buf[i] === 0x4d && buf[i + 1] === 0x4d && buf[i + 3] === 0x2a)) candidates.push({ off: i, kind: 'tif' });
    }
    candidates.sort((a, b) => b.off - a.off);
    for (const c of candidates.slice(0, 12)) {
      const sub = buf.subarray(c.off);
      try {
        if (c.kind === 'png') {
          const w = sub.readUInt32BE(16), h = sub.readUInt32BE(20);
          if (w > 4 && h > 4) return await U.hooks.decodeImageBytes(sub);
        } else if (c.kind === 'jpg') {
          const img = await U.hooks.decodeImageBytes(sub);
          if (img.width > 4) return img;
        } else if (c.kind === 'tif' && U.hooks.decodeTiff) {
          const img = await U.hooks.decodeTiff(sub);
          if (img && img.width > 4 && img.width < 20000) return img;
        }
      } catch (_) {}
    }
    return null;
  };
  U.decodeEps = async function (buf) {
    const b = Buffer.from(buf);
    try {
      const bb = /%%BoundingBox:\s*-?\d+\s+-?\d+\s+(\d+)\s+(\d+)/.exec(U.ascii(b, 0, 2048));
      if (bb) {
        const w = +bb[1], h = +bb[2];
        if (w > 0 && h > 0 && w * h <= 80e6) {
          const hexes = U.ascii(b, 0, b.length).match(/[0-9A-Fa-f]{200,}/g);
          if (hexes) {
            const joined = hexes.join('');
            const need = w * h * 3 * 2;
            if (joined.length >= need) {
              const bytes = Buffer.from(joined.slice(0, need), 'hex');
              const img = U.makeImage(w, h);
              for (let i = 0, q = 0; i < w * h; i++, q += 4) {
                img.rgba[q] = bytes[i * 3]; img.rgba[q + 1] = bytes[i * 3 + 1]; img.rgba[q + 2] = bytes[i * 3 + 2]; img.rgba[q + 3] = 255;
              }
              return img;
            }
          }
        }
      }
    } catch (_) {}
    const found = await U.findEmbeddedImage(b);
    if (found) return found;
    throw new Error('لا تحتوي ملفات EPS على معاينة مدمجة قابلة للاستخراج');
  };
  U.decodeCdr = async function (buf) {
    const img = await U.findEmbeddedImage(Buffer.from(buf));
    if (img) return img;
    throw new Error('تعذر استخراج معاينة مدمجة من ملف CDR');
  };

  /* ================================================================
     المرمّزات (Encoders)
     ================================================================ */
  const ALPHA_OK = new Set(['png', 'webp', 'avif', 'tif', 'tiff', 'ico', 'cur', 'icns', 'psd', 'psb', 'xcf', 'tga', 'dds', 'pam', 'svg', 'exr', 'hdr', 'sgi', 'rgb', 'rgba', 'jxl']);
  U.hasAlpha = U.hasAlpha || ((img) => { for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] < 255) return true; return false; });
  function prep(img, ext, opts) {
    return ALPHA_OK.has(ext) ? img.rgba : U.flatten(img.rgba, img.width, img.height, opts.background);
  }

  function buildDib(rgba, w, h, withAlpha) {
    const bpp = withAlpha ? 32 : 24;
    const rowSize = Math.floor((bpp * w + 31) / 32) * 4;
    const pxSize = rowSize * h;
    const total = 40 + (withAlpha ? 12 : 0) + pxSize;
    const buf = Buffer.alloc(total);
    buf.writeUInt32LE(40, 0);
    buf.writeInt32LE(w, 4);
    buf.writeInt32LE(h, 8);
    buf.writeUInt16LE(1, 12);
    buf.writeUInt16LE(bpp, 14);
    buf.writeUInt32LE(withAlpha ? 3 : 0, 16);
    buf.writeUInt32LE(pxSize, 20);
    buf.writeUInt32LE(2835, 24);
    buf.writeUInt32LE(2835, 28);
    let px = 40;
    if (withAlpha) {
      buf.writeUInt32LE(0xff0000, px); buf.writeUInt32LE(0xff00, px + 4); buf.writeUInt32LE(0xff, px + 8);
      px += 12;
    }
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = px + y * rowSize;
      for (let x = 0; x < w; x++) {
        const s = srcRow + x * 4;
        const d = dstRow + x * (bpp / 8);
        buf[d] = rgba[s + 2]; buf[d + 1] = rgba[s + 1]; buf[d + 2] = rgba[s];
        if (withAlpha) buf[d + 3] = rgba[s + 3];
      }
    }
    return buf;
  }
  U.encBmp = function (img, opts) {
    const rgba = prep(img, 'bmp', opts);
    const dib = buildDib(rgba, img.width, img.height, false);
    const fh = Buffer.alloc(14);
    fh.write('BM', 0, 'latin1');
    fh.writeUInt32LE(14 + dib.length, 2);
    fh.writeUInt32LE(54, 10);
    return Buffer.concat([fh, dib]);
  };
  U.encDib = function (img, opts) {
    return buildDib(prep(img, 'dib', opts), img.width, img.height, false);
  };
  U.encTga = function (img) {
    const w = img.width, h = img.height;
    const alpha = U.hasAlpha(img);
    const bytesPer = alpha ? 4 : 3;
    const header = Buffer.alloc(18);
    header[2] = 10;
    header.writeUInt16LE(w, 12);
    header.writeUInt16LE(h, 14);
    header[16] = bytesPer * 8;
    header[17] = 0x20 | (alpha ? 8 : 0);
    const parts = [header];
    const line = Buffer.alloc(w * bytesPer);
    for (let y = 0; y < h; y++) {
      const srcRow = y * w * 4;
      for (let x = 0; x < w; x++) {
        const s = srcRow + x * 4;
        if (alpha) { line[x * 4] = img.rgba[s + 2]; line[x * 4 + 1] = img.rgba[s + 1]; line[x * 4 + 2] = img.rgba[s]; line[x * 4 + 3] = img.rgba[s + 3]; }
        else { line[x * 3] = img.rgba[s + 2]; line[x * 3 + 1] = img.rgba[s + 1]; line[x * 3 + 2] = img.rgba[s]; }
      }
      parts.push(tgaRleLine(line, bytesPer));
    }
    const footer = Buffer.alloc(26);
    footer.write('TRUEVISION-XFILE.\x00', 0, 'latin1');
    parts.push(footer);
    return Buffer.concat(parts);
  };
  function tgaRleLine(line, bytesPer) {
    const out = [];
    const n = line.length;
    let i = 0;
    const eq = (a, b) => { for (let c = 0; c < bytesPer; c++) if (line[a + c] !== line[b + c]) return false; return true; };
    while (i < n) {
      let run = 1;
      while (i + run * bytesPer < n && run < 128 && eq(i, i + run * bytesPer)) run++;
      if (run > 1) { out.push(0x80 | (run - 1)); for (let c = 0; c < bytesPer; c++) out.push(line[i + c]); i += run * bytesPer; }
      else {
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
  U.encPcx = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const bpl = w % 2 ? w + 1 : w;
    const header = Buffer.alloc(128);
    header[0] = 0x0a; header[1] = 5; header[2] = 1; header[3] = 8;
    header.writeUInt16LE(w - 1, 8); header.writeUInt16LE(h - 1, 10);
    header.writeUInt16LE(3, 65); header.writeUInt16LE(bpl, 66); header.writeUInt16LE(1, 68);
    const parts = [header];
    const row = Buffer.alloc(3 * bpl);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        row[x] = rgba[s]; row[bpl + x] = rgba[s + 1]; row[2 * bpl + x] = rgba[s + 2];
      }
      parts.push(U.rleEncodePCX(row));
    }
    return Buffer.concat(parts);
  };
  U.encPnm = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const head = Buffer.from(`P6\n${w} ${h}\n255\n`, 'latin1');
    const data = Buffer.alloc(w * h * 3);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) { data[i * 3] = rgba[p]; data[i * 3 + 1] = rgba[p + 1]; data[i * 3 + 2] = rgba[p + 2]; }
    return Buffer.concat([head, data]);
  };
  U.encPgm = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const data = Buffer.alloc(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) data[i] = Math.round(0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]);
    return Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`, 'latin1'), data]);
  };
  U.encPbm = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const rowBytes = Math.ceil(w / 8);
    const data = Buffer.alloc(rowBytes * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2] < 128) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
    return Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`, 'latin1'), data]);
  };
  U.encPam = function (img) {
    const w = img.width, h = img.height;
    const alpha = U.hasAlpha(img);
    const head = Buffer.from(`P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH ${alpha ? 4 : 3}\nMAXVAL 255\nTUPLTYPE ${alpha ? 'RGB_ALPHA' : 'RGB'}\nENDHDR\n`, 'latin1');
    const data = Buffer.alloc(w * h * (alpha ? 4 : 3));
    for (let i = 0, p = 0, q = 0; i < w * h; i++, p += 4) {
      data[q++] = img.rgba[p]; data[q++] = img.rgba[p + 1]; data[q++] = img.rgba[p + 2];
      if (alpha) data[q++] = img.rgba[p + 3];
    }
    return Buffer.concat([head, data]);
  };
  U.encSgi = function (img, opts, forceChannels) {
    const w = img.width, h = img.height;
    const alpha = forceChannels ? forceChannels === 4 : U.hasAlpha(img);
    const z = alpha ? 4 : 3;
    const rgba = alpha ? img.rgba : U.flatten(img.rgba, w, h, opts.background);
    const head = Buffer.alloc(512);
    head.writeUInt16BE(474, 0);
    head.writeUInt16BE(1, 2);
    head.writeUInt16BE(1, 4);
    head.writeUInt16BE(3, 6);
    head.writeUInt16BE(w, 8); head.writeUInt16BE(h, 10); head.writeUInt16BE(z, 12);
    head.writeUInt16BE(0, 14); head.writeUInt16BE(255, 16);
    head.write('ImageConverter Pro', 20, 'latin1');
    const tables = Buffer.alloc(h * z * 8);
    const bodies = [];
    let bodyOff = 512 + tables.length;
    const planes = [Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w), Buffer.alloc(w)];
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < z; c++) {
        const row = (h - 1 - y) * w * 4;
        for (let x = 0; x < w; x++) planes[c][x] = rgba[row + x * 4 + c];
        const body = sgiRleRow(planes[c]);
        tables.writeUInt32BE(bodyOff, (y * z + c) * 8);
        tables.writeUInt32BE(body.length, (y * z + c) * 8 + 4);
        bodies.push(body);
        bodyOff += body.length;
      }
    }
    return Buffer.concat([head, tables, ...bodies]);
  };
  function sgiRleRow(plane) {
    const out = [];
    const w = plane.length;
    let x = 0;
    while (x < w) {
      let run = 1;
      while (x + run < w && run < 126 && plane[x + run] === plane[x]) run++;
      if (run >= 2) { out.push(128 + run - 1, plane[x]); x += run; }
      else {
        let lit = 1;
        while (x + lit < w && lit < 126) { if (plane[x + lit] === plane[x + lit + 1]) break; lit++; }
        out.push(lit - 1);
        for (let k = 0; k < lit; k++) out.push(plane[x + k]);
        x += lit;
      }
    }
    return Buffer.from(out);
  }
  U.encDds = function (img) {
    const w = img.width, h = img.height;
    const alpha = U.hasAlpha(img);
    const header = Buffer.alloc(128);
    header.write('DDS ', 0, 'latin1');
    header.writeUInt32LE(124, 4);
    header.writeUInt32LE(0x1000, 8);
    header.writeUInt32LE(h, 12);
    header.writeUInt32LE(w, 16);
    header.writeUInt32LE(w * h * 4, 20);
    header.writeUInt32LE(32, 76);
    header.writeUInt32LE(alpha ? 0x41 : 0x40, 80);
    header.writeUInt32LE(32, 88);
    header.writeUInt32LE(0xff0000, 92);
    header.writeUInt32LE(0xff00, 96);
    header.writeUInt32LE(0xff, 100);
    header.writeUInt32LE(alpha ? 0xff000000 : 0, 104);
    const data = Buffer.alloc(w * h * 4);
    data.set(img.rgba);
    return Buffer.concat([header, data]);
  };
  U.encIco = async function (img) {
    const sizes = [256, 128, 64, 48, 32, 24, 16].filter((s) => s <= Math.max(img.width, img.height) || s <= 64);
    const seen = new Set();
    const entries = [];
    for (const s of sizes) {
      if (seen.has(s)) continue;
      seen.add(s);
      const scale = Math.min(1, s / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const png = await U.hooks.encodePng(img, w, h);
      entries.push({ w, h, png });
    }
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);
    let offset = 6 + 16 * entries.length;
    const dirs = [], blobs = [];
    for (const e of entries) {
      const dir = Buffer.alloc(16);
      dir[0] = e.w >= 256 ? 0 : e.w;
      dir[1] = e.h >= 256 ? 0 : e.h;
      dir.writeUInt16LE(1, 4);
      dir.writeUInt16LE(32, 6);
      dir.writeUInt32LE(e.png.length, 8);
      dir.writeUInt32LE(offset, 12);
      offset += e.png.length;
      dirs.push(dir);
      blobs.push(e.png);
    }
    return Buffer.concat([header, ...dirs, ...blobs]);
  };
  U.encCur = async function (img) {
    const png = await U.hooks.encodePng({ width: img.width, height: img.height, rgba: resizeRgba(img, 32, 32) }, 32, 32);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(2, 2);
    header.writeUInt16LE(1, 4);
    const dir = Buffer.alloc(16);
    dir[0] = 32; dir[1] = 32;
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(22, 12);
    return Buffer.concat([header, dir, png]);
  };
  const ICNS_ORDER = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
  U.encIcns = async function (img) {
    const maxSide = Math.max(img.width, img.height);
    const chunks = [];
    for (const [type, size] of ICNS_ORDER) {
      if (size > maxSide && size > 16) continue;
      const scale = Math.min(1, size / maxSide);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const png = await U.hooks.encodePng(img, w, h);
      const head = Buffer.alloc(8);
      head.write(type, 0, 'latin1');
      head.writeUInt32BE(png.length + 8, 4);
      chunks.push(head, png);
    }
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(8 + chunks.reduce((a, b) => a + b.length, 0), 0);
    return Buffer.concat([Buffer.from('icns', 'latin1'), lenBuf, ...chunks]);
  };
  U.encSvgEmbed = async function (img) {
    const png = await U.hooks.encodePng(img, img.width, img.height);
    const b64 = bytesToBase64(png);
    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${img.width}" height="${img.height}" viewBox="0 0 ${img.width} ${img.height}">\n<image width="${img.width}" height="${img.height}" xlink:href="data:image/png;base64,${b64}"/>\n</svg>\n`, 'latin1');
  };
  function bytesToBase64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  U.bytesToBase64 = bytesToBase64;

  U.encHdr = function (img) {
    const w = img.width, h = img.height;
    const fdata = img.float ? img.float.data : U.rgbaToFloat(img.rgba, w, h);
    const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
    const parts = [head];
    const rgbBuf = Buffer.alloc(w * 4);
    for (let y = 0; y < h; y++) {
      parts.push(Buffer.from([2, 2, (w >> 8) & 0xff, w & 0xff]));
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 3;
        const r = Math.max(0, fdata[q]), g = Math.max(0, fdata[q + 1]), b = Math.max(0, fdata[q + 2]);
        const m = Math.max(r, g, b);
        if (m < 1e-32 || !Number.isFinite(m)) { rgbBuf[x * 4] = rgbBuf[x * 4 + 1] = rgbBuf[x * 4 + 2] = rgbBuf[x * 4 + 3] = 0; }
        else {
          const e = Math.ceil(Math.log2(m));
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
  };
  function hdrRleRow(plane) {
    const out = [];
    const w = plane.length;
    let x = 0;
    while (x < w) {
      let run = 1;
      while (x + run < w && run < 127 && plane[x + run] === plane[x]) run++;
      if (run >= 4) { out.push(128 + run, plane[x]); x += run; }
      else {
        let lit = 1;
        while (x + lit < w && lit < 127) {
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
  U.encExr = async function (img) {
    const w = img.width, h = img.height;
    const alpha = U.hasAlpha(img);
    const fdata = img.float ? img.float.data : U.rgbaToFloat(img.rgba, w, h);
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
    const b4 = (v, signed) => { const b = Buffer.alloc(4); if (signed) b.writeInt32LE(v, 0); else b.writeUInt32LE(v >>> 0, 0); return b; };
    const putAttr = (name, type, payload) => { putStr(name); putStr(type); header.push(b4(payload.length)); header.push(payload); };
    header.push(Buffer.from([0x76, 0x2f, 0x31, 0x01]));
    header.push(b4(2));
    const chlist = [];
    for (const c of chans) { chlist.push(Buffer.from(c.name + '\0', 'latin1'), b4(1), b4(1), b4(1), b4(1)); }
    chlist.push(Buffer.from([0]));
    putAttr('channels', 'chlist', Buffer.concat(chlist));
    putAttr('compression', 'compression', Buffer.from([3]));
    putAttr('dataWindow', 'box2i', Buffer.concat([b4(0, 1), b4(0, 1), b4(w - 1, 1), b4(h - 1, 1)]));
    putAttr('displayWindow', 'box2i', Buffer.concat([b4(0, 1), b4(0, 1), b4(w - 1, 1), b4(h - 1, 1)]));
    putAttr('lineOrder', 'lineOrder', Buffer.from([0]));
    const f32b = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; };
    putAttr('pixelAspectRatio', 'float', f32b(1));
    putAttr('screenWindowCenter', 'v2f', Buffer.concat([f32b(0), f32b(0)]));
    putAttr('screenWindowWidth', 'float', f32b(1));
    header.push(Buffer.from([0]));
    const headBuf = Buffer.concat(header);
    const LINES = 16;
    const blocks = [];
    for (let yStart = 0; yStart < h; yStart += LINES) {
      const nLines = Math.min(LINES, h - yStart);
      const planar = [];
      for (const c of chans) {
        const plane = Buffer.alloc(w * nLines * 2);
        for (let li = 0; li < nLines; li++) {
          const rowOff = (yStart + li) * w;
          for (let x = 0; x < w; x++) plane.writeUInt16LE(U.floatToHalf(c.src(rowOff + x)), (li * w + x) * 2);
        }
        planar.push(plane);
      }
      const raw = Buffer.concat(planar);
      let prev = 0;
      for (let i = 0; i < raw.length; i++) { const cur = raw[i]; raw[i] = (cur - prev) & 0xff; prev = cur; }
      const comp = await U.zlibDeflate(raw);
      const chunk = Buffer.alloc(8);
      chunk.writeUInt32LE(yStart, 0);
      chunk.writeUInt32LE(comp.length, 4);
      blocks.push({ chunk, data: comp });
    }
    const table = Buffer.alloc(blocks.length * 8);
    let off = headBuf.length + table.length;
    blocks.forEach((b, i) => { table.writeBigUInt64LE(BigInt(off), i * 8); off += b.chunk.length + b.data.length; });
    return Buffer.concat([headBuf, table, ...blocks.flatMap((b) => [b.chunk, b.data])]);
  };
  U.encFits = function (img) {
    const w = img.width, h = img.height;
    const fdata = img.float ? img.float.data : U.rgbaToFloat(img.rgba, w, h);
    const cards = [];
    const add = (key, value) => {
      let card = key.padEnd(8, ' ');
      if (value !== undefined) card += '= ' + String(value).padStart(20);
      cards.push(card.padEnd(80, ' ').slice(0, 80));
    };
    add('SIMPLE', 'T'); add('BITPIX', -32); add('NAXIS', 2); add('NAXIS1', w); add('NAXIS2', h);
    add('BSCALE', 1); add('BZERO', 0);
    cards.push('END'.padEnd(80));
    let headerBlock = Buffer.from(cards.join(''), 'latin1');
    headerBlock = Buffer.concat([headerBlock, Buffer.alloc(Math.ceil(headerBlock.length / 2880) * 2880 - headerBlock.length)]);
    const data = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) data.writeFloatBE((fdata[i * 3] + fdata[i * 3 + 1] + fdata[i * 3 + 2]) / 3, i * 4);
    return Buffer.concat([headerBlock, data]);
  };
  U.encXcf = function (img) {
    const w = img.width, h = img.height;
    const chunks = [];
    const head = Buffer.alloc(26);
    head.write('gimp xcf v001\0', 0, 'latin1');
    head.writeUInt32LE(w, 14); head.writeUInt32LE(h, 18); head.writeUInt32LE(0, 22);
    chunks.push(head, Buffer.alloc(8));
    const layerOffPos = 34;
    chunks.push(Buffer.alloc(12));
    const layerPos = 46;
    const layer = [];
    const push32 = (arr, v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); arr.push(b); };
    push32(layer, w); push32(layer, h); push32(layer, 1);
    const name = Buffer.from('Image\0', 'latin1');
    push32(layer, name.length); layer.push(name);
    const prop = (id, payload) => { push32(layer, id); push32(layer, payload.length); layer.push(payload); };
    prop(6, Buffer.from([255, 0, 0, 0]));
    prop(8, Buffer.from([1]));
    prop(15, (() => { const b = Buffer.alloc(8); return b; })());
    prop(17, Buffer.from([1]));
    prop(0, Buffer.alloc(0));
    const hierarchyPosRel = layer.reduce((a, b) => a + b.length, 0);
    push32(layer, 0); push32(layer, 0);
    chunks.push(Buffer.concat(layer));
    const hier = [];
    push32(hier, w); push32(hier, h); push32(hier, 4);
    const levelPosRel = hier.reduce((a, b) => a + b.length, 0);
    push32(hier, 0); push32(hier, 0);
    chunks.push(Buffer.concat(hier));
    const TILE = 64;
    const cols = Math.ceil(w / TILE), rows = Math.ceil(h / TILE);
    const tileCount = cols * rows;
    const level = [];
    push32(level, w); push32(level, h);
    const tilesStartRel = level.length * 4 + tileCount * 4 + 4;
    for (let i = 0; i < tileCount; i++) push32(level, 0);
    push32(level, 0);
    const rgba = img.rgba;
    const tiles = [];
    for (let ty = 0; ty < h; ty += TILE) {
      for (let tx = 0; tx < w; tx += TILE) {
        const tw = Math.min(TILE, w - tx), th = Math.min(TILE, h - ty);
        const tileRgba = Buffer.alloc(tw * th * 4);
        for (let y = 0; y < th; y++) {
          const src = ((ty + y) * w + tx) * 4;
          tileRgba.set(rgba.subarray(src, src + tw * 4), y * tw * 4);
        }
        tiles.push(U.xcfRleTile(tileRgba, tw, th));
      }
    }
    const whole = Buffer.concat([...chunks, Buffer.concat(level), ...tiles]);
    const hierarchyOff = layerPos + hierarchyPosRel;
    const levelOff = hierarchyOff + levelPosRel;
    whole.writeUInt32LE(layerPos, layerOffPos);
    whole.writeUInt32LE(hierarchyOff, layerPos + hierarchyPosRel);
    whole.writeUInt32LE(levelOff, hierarchyOff + levelPosRel);
    let tOff = levelOff + tilesStartRel;
    let idx = 0;
    for (let ty = 0; ty < h; ty += TILE) for (let tx = 0; tx < w; tx += TILE) {
      whole.writeUInt32LE(tOff, levelOff + 8 + idx * 4);
      tOff += tiles[idx].length;
      idx++;
    }
    return whole;
  };
  U.encDng = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) { rgb[i * 3] = rgba[p]; rgb[i * 3 + 1] = rgba[p + 1]; rgb[i * 3 + 2] = rgba[p + 2]; }
    const makeAscii = (s) => Buffer.from(s + '\0', 'latin1');
    const make = makeAscii('ImageConverter');
    const model = makeAscii('Pro');
    const unique = makeAscii('ImageConverter Pro');
    const entries = [];
    const u32b = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
    const u16b = (...vs) => { const b = Buffer.alloc(vs.length * 2); vs.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b; };
    const srat = (n, d) => { const b = Buffer.alloc(8); b.writeInt32LE(n, 0); b.writeInt32LE(d, 4); return b; };
    const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, SRATIONAL: 10 };
    const entry = (tag, type, count, payload, inline) => entries.push({ tag, type, count, payload, inline });
    entry(254, T.LONG, 1, u32b(0), true);
    entry(256, T.LONG, 1, u32b(w), true);
    entry(257, T.LONG, 1, u32b(h), true);
    entry(258, T.SHORT, 3, u16b(8, 8, 8), true);
    entry(259, T.SHORT, 1, u16b(1), true);
    entry(262, T.SHORT, 1, u16b(34892), true);
    entry(271, T.ASCII, make.length, make, false);
    entry(272, T.ASCII, model.length, model, false);
    entry(273, T.LONG, 1, null, true);
    entry(277, T.SHORT, 1, u16b(3), true);
    entry(278, T.LONG, 1, u32b(h), true);
    entry(279, T.LONG, 1, u32b(rgb.length), true);
    entry(284, T.SHORT, 1, u16b(1), true);
    entry(339, T.SHORT, 3, u16b(1, 1, 1), true);
    entry(50706, T.BYTE, 4, Buffer.from([1, 4, 0, 0]), true);
    entry(50707, T.BYTE, 4, Buffer.from([1, 1, 0, 0]), true);
    entry(50708, T.ASCII, unique.length, unique, false);
    const cm = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]];
    const cmParts = [];
    for (const row of cm) for (const v of row) cmParts.push(srat(Math.round(v * 10000), 10000));
    entry(50721, T.SRATIONAL, 9, Buffer.concat(cmParts), false);
    entry(50778, T.SHORT, 1, u16b(21), true);
    entries.sort((a, b) => a.tag - b.tag);
    const ifdCount = entries.length;
    const ifdOff = 8;
    const ifdSize = 2 + ifdCount * 12 + 4;
    const extraBlobs = [];
    let extraOff = ifdOff + ifdSize;
    const entryBufs = [];
    for (const e of entries) {
      let payload = e.payload, inlineVal;
      if (payload === null) inlineVal = Buffer.alloc(4);
      else if (e.inline && payload.length <= 4) { inlineVal = Buffer.alloc(4); payload.copy(inlineVal); }
      else { inlineVal = u32b(extraOff + extraBlobs.reduce((a, b) => a + b.length, 0)); extraBlobs.push(payload); }
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
    const out = Buffer.concat([header, ifd, extraData, rgb]);
    const idx = entryBufs.findIndex((eb) => eb.readUInt16LE(0) === 273);
    if (idx !== -1) out.writeUInt32LE(stripOff, 8 + 2 + idx * 12 + 8);
    return out;
  };
  U.encRawPixels = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const out = Buffer.alloc(w * h * 3);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) { out[i * 3] = rgba[p]; out[i * 3 + 1] = rgba[p + 1]; out[i * 3 + 2] = rgba[p + 2]; }
    return out;
  };
  U.encEps = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) { rgb[i * 3] = rgba[p]; rgb[i * 3 + 1] = rgba[p + 1]; rgb[i * 3 + 2] = rgba[p + 2]; }
    const ps = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      '%%Creator: ImageConverter Pro',
      `%%BoundingBox: 0 0 ${w} ${h}`,
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
  };
  U.encWmf = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const dib = buildDib(rgba, w, h, false);
    const records = [];
    const rec = (fn, params) => {
      const size = (3 + params.length) * 2;
      const b = Buffer.alloc(size);
      b.writeUInt32LE(size / 2, 0);
      b.writeUInt16LE(fn, 4);
      params.forEach((pv, i) => b.writeInt16LE(pv, 6 + i * 2));
      records.push(b);
    };
    rec(0x020b, [0, 0]);
    rec(0x020c, [h, w]);
    const params = [0x0020, 0x00cc, 0, h, w, 0, 0, h, w, 0, 0];
    const sizeWords = 3 + params.length + dib.length / 2;
    const recBuf = Buffer.alloc(6 + params.length * 2 + dib.length);
    recBuf.writeUInt32LE(sizeWords, 0);
    recBuf.writeUInt16LE(0x0f43, 4);
    params.forEach((pv, i) => recBuf.writeInt16LE(pv, 6 + i * 2));
    dib.copy(recBuf, 6 + params.length * 2);
    records.push(recBuf);
    const eof = Buffer.alloc(6);
    eof.writeUInt32LE(3, 0);
    records.push(eof);
    const body = Buffer.concat(records);
    const totalWords = 9 + body.length / 2;
    const stdHeader = Buffer.alloc(18);
    stdHeader.writeUInt16LE(1, 0);
    stdHeader.writeUInt16LE(9, 2);
    stdHeader.writeUInt16LE(0x0300, 4);
    stdHeader.writeUInt32LE(totalWords, 6);
    stdHeader.writeUInt32LE(totalWords, 12);
    const ph = Buffer.alloc(22);
    ph.writeUInt32LE(0x9ac6cdd7, 0);
    ph.writeInt16LE(w, 10); ph.writeInt16LE(h, 12);
    ph.writeUInt16LE(96, 14);
    let checksum = 0;
    for (let i = 0; i < 10; i++) checksum ^= ph.readInt16LE(i * 2);
    ph.writeInt16LE(checksum, 20);
    return Buffer.concat([ph, stdHeader, body]);
  };
  U.encEmf = function (img, opts) {
    const w = img.width, h = img.height;
    const rgba = U.flatten(img.rgba, w, h, opts.background);
    const dib = buildDib(rgba, w, h, false);
    const cbBmi = 40;
    const cbBits = dib.length - cbBmi;
    const recSize = 80 + cbBmi + cbBits;
    const total = 88 + recSize + 20;
    const buf = Buffer.alloc(total);
    buf.writeUInt32LE(1, 0); buf.writeUInt32LE(88, 4);
    buf.writeInt32LE(0, 8); buf.writeInt32LE(0, 12);
    buf.writeInt32LE(w - 1, 16); buf.writeInt32LE(h - 1, 20);
    buf.writeInt32LE(0, 24); buf.writeInt32LE(0, 28);
    buf.writeInt32LE(Math.round(w * 2540 / 96), 32);
    buf.writeInt32LE(Math.round(h * 2540 / 96), 36);
    buf.writeUInt32LE(0x464d4520, 40);
    buf.writeUInt32LE(0x00010000, 44);
    buf.writeUInt32LE(total, 48);
    buf.writeUInt32LE(3, 52);
    buf.writeUInt16LE(1, 56);
    buf.writeInt32LE(1920, 72); buf.writeInt32LE(1080, 76);
    buf.writeInt32LE(508, 80); buf.writeInt32LE(285, 84);
    let p = 88;
    buf.writeUInt32LE(81, p); buf.writeUInt32LE(recSize, p + 4);
    buf.writeInt32LE(w - 1, p + 16); buf.writeInt32LE(h - 1, p + 20);
    buf.writeInt32LE(0, p + 24); buf.writeInt32LE(0, p + 28);
    buf.writeInt32LE(0, p + 32); buf.writeInt32LE(0, p + 36);
    buf.writeInt32LE(w, p + 40); buf.writeInt32LE(h, p + 44);
    buf.writeUInt32LE(80, p + 48);
    buf.writeUInt32LE(cbBmi, p + 52);
    buf.writeUInt32LE(80 + cbBmi, p + 56);
    buf.writeUInt32LE(cbBits, p + 60);
    buf.writeUInt32LE(0x00cc0020, p + 68);
    buf.writeInt32LE(w, p + 72); buf.writeInt32LE(h, p + 76);
    dib.copy(buf, p + 80);
    p += recSize;
    buf.writeUInt32LE(14, p); buf.writeUInt32LE(20, p + 4);
    buf.writeUInt32LE(0, p + 8); buf.writeUInt32LE(16, p + 12); buf.writeUInt32LE(20, p + 16);
    return buf;
  };
})();

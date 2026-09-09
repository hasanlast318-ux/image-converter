'use strict';
/* libs.js — محمّل مكتبات WASM/JS من CDN مع تخزين مؤقت */
(function () {
  const cache = {};

  function loadScript(src) {
    if (!cache['s:' + src]) {
      cache['s:' + src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('تعذر تحميل: ' + src));
        document.head.appendChild(s);
      });
    }
    return cache['s:' + src];
  }
  function loadModule(url) {
    if (!cache['m:' + url]) cache['m:' + url] = import(url);
    return cache['m:' + url];
  }

  const CDNS = {
    utif: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js',
    heic2any: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
    pdflib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    agpsd: 'https://cdn.jsdelivr.net/npm/ag-psd@31.0.2/dist/bundle.js',
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs',
    pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs',
    gifenc: 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm',
    jxl: 'https://cdn.jsdelivr.net/npm/@jsquash/jxl@1.3.0/+esm',
    avif: 'https://cdn.jsdelivr.net/npm/@jsquash/avif@1.4.0/+esm',
    webp: 'https://cdn.jsdelivr.net/npm/@jsquash/webp@1.5.0/+esm',
    libraw: 'https://cdn.jsdelivr.net/npm/libraw-wasm@1.6.0/+esm',
  };

  const libs = {};

  /* فك أي صيغة يدعمها المتصفح (jpg/png/gif/webp/avif/bmp/svg/ico/cur) */
  libs.decodeImageBytes = async function (bytes, mimeHint) {
    let bmp;
    try {
      bmp = await createImageBitmap(new Blob([bytes], { type: mimeHint || 'image/png' }));
    } catch (e) {
      // عبر <img> + data URL (مفيد لـ SVG)
      const url = URL.createObjectURL(new Blob([bytes]));
      try {
        const imgEl = new Image();
        await new Promise((res, rej) => { imgEl.onload = res; imgEl.onerror = () => rej(new Error('المتصفح لا يستطيع فك هذه الصورة')); imgEl.src = url; });
        const c = IC.createCanvas(imgEl.naturalWidth || imgEl.width, imgEl.naturalHeight || imgEl.height);
        const ctx = c.getContext('2d');
        ctx.drawImage(imgEl, 0, 0);
        return IC.canvasToImage(c);
      } finally { URL.revokeObjectURL(url); }
    }
    const c = IC.createCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    return IC.canvasToImage(c);
  };

  libs.utif = async function () {
    await loadScript(CDNS.utif);
    return window.UTIF;
  };
  libs.decodeTiff = async function (bytes) {
    const UTIF = await libs.utif();
    const ifds = UTIF.decode(bytes);
    UTIF.decodeImage(bytes, ifds[0], ifds);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const img = IC.makeImage(ifds[0].width, ifds[0].height);
    img.rgba = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
    return img;
  };
  libs.encodeTiff = async function (img) {
    const UTIF = await libs.utif();
    const ab = UTIF.encodeImage(img.rgba, img.width, img.height);
    return new Uint8Array(ab);
  };

  libs.heic2any = async function () {
    await loadScript(CDNS.heic2any);
    if (!window.heic2any) throw new Error('مكتبة HEIC غير متاحة');
    return window.heic2any;
  };
  libs.decodeHeic = async function (bytes) {
    const heic2any = await libs.heic2any();
    const blob = new Blob([bytes], { type: 'image/heic' });
    const out = await heic2any({ blob, toType: 'image/png' });
    const buf = new Uint8Array(await out.arrayBuffer());
    return libs.decodeImageBytes(buf, 'image/png');
  };

  libs.pdfjs = async function () {
    const mod = await loadModule(CDNS.pdfjs);
    if (mod.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = CDNS.pdfjsWorker;
    return mod;
  };

  libs.pdfLib = async function () {
    await loadScript(CDNS.pdflib);
    if (!window.PDFLib) throw new Error('مكتبة PDF غير متاحة');
    return window.PDFLib;
  };

  libs.agPsd = async function () {
    if (window.agPsd) return window.agPsd;
    await loadScript(CDNS.agpsd);
    const psd = window.agPsd || window.AgPsd || window['ag-psd'];
    if (!psd) throw new Error('مكتبة PSD غير متاحة');
    if (psd.initializeCanvas) psd.initializeCanvas((w, h) => IC.createCanvas(w, h));
    return psd;
  };

  libs.gifenc = () => loadModule(CDNS.gifenc);

  libs.jsquash = function (kind) {
    return loadModule(CDNS[kind]);
  };

  libs.libraw = () => loadModule(CDNS.libraw);

  /* ترميز PNG عبر canvas (يُستخدم في ICO/ICNS/SVG) */
  libs.encodePngCanvas = async function (img, w, h) {
    let rgba = img.rgba;
    if (w !== img.width || h !== img.height) rgba = IC.resizeRgba(img, w, h);
    const c = IC.createCanvas(w, h);
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(w, h);
    id.data.set(rgba.subarray(0, w * h * 4));
    ctx.putImageData(id, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  };

  /* ترميز GIF عبر gifenc */
  libs.encodeGif = async function (img) {
    const { GIFEncoder, quantize, applyPalette } = await libs.gifenc();
    const rgba = IC.flatten(img.rgba, img.width, img.height, '#ffffff');
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    const gif = GIFEncoder();
    gif.writeFrame(index, img.width, img.height, { palette });
    gif.finish();
    return gif.bytes();
  };

  /* ترميز WebP/AVIF/JXL عبر jSquash */
  libs.encodeJsquash = async function (kind, img, quality) {
    const mod = await libs.jsquash(kind);
    const data = {
      data: img.rgba instanceof Uint8ClampedArray ? new Uint8ClampedArray(img.rgba) : img.rgba,
      width: img.width,
      height: img.height,
    };
    const opts = kind === 'webp' ? { quality } : { quality: Math.min(quality, 85) };
    return await mod.encode(data, opts);
  };

  /* فك RAW عبر libraw-wasm */
  libs.decodeRaw = async function (bytes) {
    const LibRaw = (await libs.libraw()).default;
    const raw = new LibRaw();
    try {
      await raw.open(bytes, { useCameraWb: true, outputColor: 1, outputBps: 8, userFlip: -1, userQual: 2 });
      let data;
      try { data = await raw.imageData(); }
      catch (e) {
        const thumb = await raw.thumbnailData();
        if (thumb && thumb.format === 'jpeg') return libs.decodeImageBytes(thumb.data);
        throw e;
      }
      const img = IC.makeImage(data.width, data.height);
      const src = data.data;
      const rgba = img.rgba;
      const n = data.width * data.height;
      const shift = data.bits === 8 ? 0 : 8;
      if (data.colors === 3) {
        for (let i = 0, p = 0, q = 0; i < n; i++, p += 3, q += 4) {
          rgba[q] = src[p] >> shift; rgba[q + 1] = src[p + 1] >> shift; rgba[q + 2] = src[p + 2] >> shift; rgba[q + 3] = 255;
        }
      } else if (data.colors === 4) {
        for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 4) {
          rgba[q] = src[p] >> shift; rgba[q + 1] = src[p + 1] >> shift; rgba[q + 2] = src[p + 2] >> shift; rgba[q + 3] = 255;
        }
      } else {
        for (let i = 0, q = 0; i < n; i++, q += 4) { rgba[q] = rgba[q + 1] = rgba[q + 2] = src[i] >> shift; rgba[q + 3] = 255; }
      }
      return img;
    } finally {
      try { raw.dispose(); } catch (_) {}
    }
  };

  /* فك PDF عبر pdf.js */
  libs.decodePdf = async function (bytes) {
    const pdfjsLib = await libs.pdfjs();
    const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(0.1, 2400 / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = IC.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      return IC.canvasToImage(canvas);
    } finally {
      try { await doc.destroy(); } catch (_) {}
    }
  };

  /* ترميز PDF/AI عبر pdf-lib */
  libs.encodePdf = async function (img, opts, alpha) {
    const PDFLib = await libs.pdfLib();
    const pdf = await PDFLib.PDFDocument.create();
    let embedded;
    if (alpha) {
      const png = await libs.encodePngCanvas(img, img.width, img.height);
      embedded = await pdf.embedPng(png);
    } else {
      const rgba = IC.flatten(img.rgba, img.width, img.height, opts.background);
      const c = IC.createCanvas(img.width, img.height);
      const ctx = c.getContext('2d');
      const id = ctx.createImageData(img.width, img.height);
      id.data.set(rgba);
      ctx.putImageData(id, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', Math.max(opts.quality, 85) / 100));
      embedded = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    }
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: img.width, height: img.height });
    return await pdf.save({ useObjectStreams: false });
  };

  /* فك/ترميز PSD عبر ag-psd */
  libs.decodePsd = async function (bytes) {
    const psd = await libs.agPsd();
    const parsed = psd.readPsd(bytes, {});
    let canvas = parsed.canvas;
    if (!canvas && parsed.children) {
      canvas = IC.createCanvas(parsed.width, parsed.height);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const draw = (children) => {
        if (!children) return;
        for (const layer of children) {
          if (layer.hidden === true) continue;
          if (layer.children) { draw(layer.children); continue; }
          if (!layer.canvas) continue;
          ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
          ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
          ctx.globalAlpha = 1;
        }
      };
      draw(parsed.children);
    }
    if (!canvas && parsed.imageData) {
      const img = IC.makeImage(parsed.imageData.width, parsed.imageData.height);
      img.rgba = new Uint8ClampedArray(parsed.imageData.data);
      return img;
    }
    if (!canvas) throw new Error('ملف PSD فارغ أو غير مدعوم');
    return IC.canvasToImage(canvas);
  };
  libs.encodePsd = async function (img, psb) {
    const psdLib = await libs.agPsd();
    const canvas = IC.imageToCanvas(img);
    const psd = {
      width: img.width,
      height: img.height,
      channels: 3,
      bits: 8,
      colorMode: 3,
      canvas,
    };
    return psdLib.writePsd(psd, { psb: !!psb, compress: true, generateThumbnail: false });
  };

  IC.libs = libs;
})();

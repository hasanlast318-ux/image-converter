'use strict';
/* app.js — واجهة نسخة المتصفح وخط أنابيب التحويل الكامل */
(function () {
  const $ = (s) => document.querySelector(s);

  const state = { files: [], results: [], target: null, converting: false, formats: null };

  /* ================= مصفوفة صيغ نسخة الويب ================= */
  const N = (ext, name, cat, dec, enc, mode, note) => ({ ext, name, cat, dec, enc, mode, note });
  const F = [];
  const add = (ext, name, cat, dec, enc, mode, note) => F.push(N(ext, name, cat, dec, enc, mode, note));

  const CATS = { common: 'صيغ شائعة', modern: 'صيغ حديثة', raw: 'كاميرات RAW', design: 'تصميم ومتجهات', doc: 'مستندات', icon: 'أيقونات', sci: 'علمية وألعاب وHDR' };
  add('jpg', 'JPEG', 'common', 'native', 'canvas'); add('jpeg', 'JPEG', 'common', 'native', 'canvas');
  add('jpe', 'JPEG', 'common', 'native', 'canvas'); add('jfif', 'JFIF (JPEG)', 'common', 'native', 'canvas');
  add('png', 'PNG', 'common', 'native', 'canvas'); add('webp', 'WebP', 'common', 'native', 'jsquash:webp');
  add('gif', 'GIF', 'common', 'native', 'gifenc'); add('bmp', 'Bitmap (BMP)', 'common', 'native', 'custom');
  add('dib', 'DIB', 'common', 'custom', 'custom'); add('tif', 'TIFF', 'common', 'utif', 'utif');
  add('tiff', 'TIFF', 'common', 'utif', 'utif');
  add('avif', 'AVIF', 'modern', 'native', 'jsquash:avif');
  add('heic', 'HEIC (آيفون)', 'modern', 'heic', null, 'none', 'الكتابة بـ HEIC تتطلب مشفّر HEVC مغلقاً — البديل: AVIF');
  add('heif', 'HEIF', 'modern', 'heic', null, 'none', 'الكتابة بـ HEIF تتطلب مشفّر HEVC مغلقاً — البديل: AVIF');
  add('jxl', 'JPEG XL', 'modern', 'jsquash:jxl', 'jsquash:jxl');
  for (const [ext, name] of [['jp2', 'JPEG 2000'], ['j2k', 'JPEG 2000 كود ستريم'], ['jpf', 'JPEG 2000'], ['jpx', 'JPEG 2000 موسع'], ['jpm', 'JPEG 2000 MJP'], ['mj2', 'Motion JPEG 2000']]) {
    add(ext, name, 'modern', 'libraw', null, 'none', 'لا يوجد مشفّر JPEG 2000 مفتوح — جرّب WebP أو AVIF');
  }
  add('raw', 'RAW بكسلات', 'raw', 'rawpixels', 'custom');
  add('dng', 'DNG (Adobe)', 'raw', 'libraw', 'custom');
  for (const [ext, name] of [['cr2', 'Canon CR2'], ['cr3', 'Canon CR3'], ['nef', 'Nikon NEF'], ['nrw', 'Nikon NRW'], ['arw', 'Sony ARW'], ['srf', 'Sony SRF'], ['sr2', 'Sony SR2'], ['raf', 'Fujifilm RAF'], ['orf', 'Olympus ORF'], ['rw2', 'Panasonic RW2'], ['rwl', 'Leica RWL'], ['pef', 'Pentax PEF'], ['3fr', 'Hasselblad 3FR'], ['iiq', 'Phase One IIQ'], ['x3f', 'Sigma X3F'], ['erf', 'Epson ERF'], ['kdc', 'Kodak KDC'], ['dcr', 'Kodak DCR'], ['mrw', 'Minolta MRW'], ['mef', 'Minolta MEF'], ['mos', 'Leaf MOS'], ['srw', 'Samsung SRW']]) {
    add(ext, name, 'raw', 'libraw', null, 'none', `صيغة ${name} مغلقة ولا يمكن إنشاؤها إلا بكاميراتها — البديل المفتوح: DNG`);
  }
  add('psd', 'Photoshop PSD', 'design', 'agpsd', 'agpsd');
  add('psb', 'Photoshop PSB', 'design', 'agpsd', 'agpsd');
  add('xcf', 'GIMP XCF', 'design', 'custom', 'custom', 'experimental');
  add('ai', 'Adobe Illustrator', 'design', 'ai', 'pdf');
  add('eps', 'EPS', 'design', 'custom', 'custom');
  add('cdr', 'CorelDRAW', 'design', 'custom', null, 'none', 'صيغة CorelDRAW مغلقة — البدائل المتجهية: SVG أو EPS');
  add('wmf', 'Windows Metafile', 'design', 'custom', 'custom', 'wrapper');
  add('emf', 'Enhanced Metafile', 'design', 'custom', 'custom', 'wrapper');
  add('svg', 'SVG', 'design', 'native', 'custom');
  add('pdf', 'PDF', 'doc', 'pdfjs', 'pdf');
  add('ico', 'أيقونة ICO', 'icon', 'native', 'custom');
  add('cur', 'مؤشر CUR', 'icon', 'native', 'custom');
  add('icns', 'أيقونة Mac ICNS', 'icon', 'custom', 'custom');
  add('dds', 'DirectDraw Surface', 'sci', 'custom', 'custom');
  add('tga', 'Truevision TGA', 'sci', 'custom', 'custom');
  add('pcx', 'PC Paintbrush', 'sci', 'custom', 'custom');
  add('ppm', 'Portable Pixmap', 'sci', 'custom', 'custom');
  add('pgm', 'Portable Graymap', 'sci', 'custom', 'custom');
  add('pbm', 'Portable Bitmap', 'sci', 'custom', 'custom');
  add('pnm', 'Portable Anymap', 'sci', 'custom', 'custom');
  add('pam', 'PAM', 'sci', 'custom', 'custom');
  add('hdr', 'Radiance HDR', 'sci', 'custom', 'custom');
  add('exr', 'OpenEXR', 'sci', 'custom', 'custom');
  add('fits', 'FITS فلكي', 'sci', 'custom', 'custom');
  add('fits.gz', 'FITS مضغوط', 'sci', 'custom', 'custom');
  add('sgi', 'Silicon Graphics', 'sci', 'custom', 'custom');
  add('rgb', 'SGI RGB', 'sci', 'custom', 'custom');
  add('rgba', 'SGI RGBA', 'sci', 'custom', 'custom');
  state.formats = F;

  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', dib: 'image/bmp',
    tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', ico: 'image/x-icon', cur: 'image/x-icon',
    icns: 'image/x-icns', heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl', jp2: 'image/jp2',
    psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop', xcf: 'image/x-xcf',
    ai: 'application/illustrator', eps: 'application/postscript', wmf: 'image/wmf', emf: 'image/emf',
    pdf: 'application/pdf', dds: 'image/vnd-ms.dds', tga: 'image/x-tga', pcx: 'image/x-pcx',
    ppm: 'image/x-portable-pixmap', pgm: 'image/x-portable-graymap', pbm: 'image/x-portable-bitmap',
    pnm: 'image/x-portable-anymap', pam: 'image/x-portable-arbitrarymap', hdr: 'image/vnd.radiance',
    exr: 'image/x-exr', fits: 'image/fits', 'fits.gz': 'application/gzip', sgi: 'image/sgi',
    rgb: 'image/sgi', rgba: 'image/sgi', dng: 'image/x-adobe-dng', raw: 'application/octet-stream',
  };

  /* ================= فك الترميز ================= */
  const NATIVE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', cur: 'image/x-icon' };
  const RAW_SET = new Set(['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'pef', '3fr', 'iiq', 'x3f', 'erf', 'kdc', 'dcr', 'mrw', 'mef', 'mos', 'srw', 'jp2', 'j2k', 'jpf', 'jpx', 'jpm', 'mj2', 'dng']);

  async function decodeAny(ext, buf) {
    if (ext === 'fits.gz') return IC.decodeFits(buf, true);
    switch (ext) {
      case 'jpg': case 'jpeg': case 'jpe': case 'jfif': case 'png': case 'gif': case 'webp':
      case 'avif': case 'bmp': case 'svg': case 'ico': case 'cur':
        return IC.libs.decodeImageBytes(buf, NATIVE_MIME[ext]);
      case 'dib': return IC.decodeDib(buf);
      case 'heic': case 'heif': return IC.libs.decodeHeic(buf);
      case 'jxl': {
        const mod = await IC.libs.jsquash('jxl');
        const im = await mod.decode(buf);
        const img = IC.makeImage(im.width, im.height);
        img.rgba = new Uint8ClampedArray(im.data.buffer, im.data.byteOffset, im.data.byteLength);
        return img;
      }
      case 'tif': case 'tiff': return IC.libs.decodeTiff(buf);
      case 'psd': case 'psb': return IC.libs.decodePsd(buf);
      case 'pdf': return IC.libs.decodePdf(buf);
      case 'ai':
        if (IC.ascii(buf, 0, 5) === '%PDF-') return IC.libs.decodePdf(buf);
        return IC.decodeEps(buf);
      case 'eps': return IC.decodeEps(buf);
      case 'cdr': return IC.decodeCdr(buf);
      case 'wmf': return IC.decodeWmf(buf);
      case 'emf': return IC.decodeEmf(buf);
      case 'dds': return IC.decodeDds(buf);
      case 'tga': return IC.decodeTga(buf);
      case 'pcx': return IC.decodePcx(buf);
      case 'ppm': case 'pgm': case 'pbm': case 'pnm': case 'pam': return IC.decodePnm(buf);
      case 'hdr': return IC.decodeHdr(buf);
      case 'exr': return IC.decodeExr(buf);
      case 'fits': return IC.decodeFits(buf, false);
      case 'sgi': case 'rgb': case 'rgba': return IC.decodeSgi(buf);
      case 'xcf': return IC.decodeXcf(buf);
      case 'icns': return IC.decodeIcns(buf);
      case 'raw': return decodeRawPixels(buf);
      default:
        if (RAW_SET.has(ext)) return IC.libs.decodeRaw(buf);
        throw new Error(`لا يوجد فاك ترميز للصيغة .${ext}`);
    }
  }

  function decodeRawPixels(buf) {
    const n = buf.length;
    if (n % 3 !== 0) throw new Error('ملف .raw يجب أن يكون RGB 8-بت (الحجم يقبل القسمة على 3)');
    const px = n / 3;
    const side = Math.sqrt(px);
    if (!Number.isInteger(side)) throw new Error('تعذر تحديد أبعاد .raw — يفترض مربع RGB');
    const w = side | 0;
    const img = IC.makeImage(w, w);
    for (let i = 0, p = 0; i < px; i++, p += 4) {
      img.rgba[p] = buf[i * 3]; img.rgba[p + 1] = buf[i * 3 + 1]; img.rgba[p + 2] = buf[i * 3 + 2]; img.rgba[p + 3] = 255;
    }
    return img;
  }

  /* ================= الترميز ================= */
  async function encodeAny(ext, img, opts) {
    switch (ext) {
      case 'jpg': case 'jpeg': case 'jpe': case 'jfif': return canvasEncode(img, 'image/jpeg', opts.quality, true, opts);
      case 'png': return canvasEncode(img, 'image/png');
      case 'webp': return IC.libs.encodeJsquash('webp', img, opts.quality);
      case 'avif': return IC.libs.encodeJsquash('avif', img, opts.quality);
      case 'jxl': {
        const mod = await IC.libs.jsquash('jxl');
        return mod.encode({ data: new Uint8ClampedArray(img.rgba), width: img.width, height: img.height }, { quality: opts.quality, effort: 5 });
      }
      case 'gif': return IC.libs.encodeGif(img);
      case 'tif': case 'tiff': return IC.libs.encodeTiff(img);
      case 'bmp': return IC.encBmp(img, opts);
      case 'dib': return IC.encDib(img, opts);
      case 'tga': return IC.encTga(img);
      case 'pcx': return IC.encPcx(img, opts);
      case 'ppm': case 'pnm': return IC.encPnm(img, opts);
      case 'pgm': return IC.encPgm(img, opts);
      case 'pbm': return IC.encPbm(img, opts);
      case 'pam': return IC.encPam(img);
      case 'sgi': case 'rgb': return IC.encSgi(img, opts, 3);
      case 'rgba': return IC.encSgi(img, opts, 4);
      case 'dds': return IC.encDds(img);
      case 'ico': return IC.encIco(img);
      case 'cur': return IC.encCur(img);
      case 'icns': return IC.encIcns(img);
      case 'xcf': return IC.encXcf(img);
      case 'dng': return IC.encDng(img, opts);
      case 'raw': return IC.encRawPixels(img, opts);
      case 'hdr': return IC.encHdr(img);
      case 'exr': return IC.encExr(img);
      case 'fits': return IC.encFits(img);
      case 'fits.gz': return IC.gzip(IC.encFits(img));
      case 'eps': return IC.encEps(img, opts);
      case 'wmf': return IC.encWmf(img, opts);
      case 'emf': return IC.encEmf(img, opts);
      case 'svg': return IC.encSvgEmbed(img);
      case 'pdf': case 'ai': return IC.libs.encodePdf(img, opts, IC.hasAlpha(img));
      default: throw new Error(`لا يوجد مشفّر للصيغة .${ext}`);
    }
  }

  async function canvasEncode(img, mime, quality, flatten, opts) {
    let rgba = img.rgba;
    if (flatten) rgba = IC.flatten(img.rgba, img.width, img.height, opts.background);
    const c = IC.createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(img.width, img.height);
    id.data.set(rgba.subarray(0, img.width * img.height * 4));
    ctx.putImageData(id, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, mime, quality ? quality / 100 : undefined));
    if (!blob) throw new Error(`متصفحك لا يدعم ترميز ${mime}`);
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* ================= خط الأنابيب ================= */
  async function convert(buf, declaredExt, targetExt, options) {
    const fmtIn = F.find((f) => f.ext === declaredExt);
    let ext = declaredExt;
    const sniffed = IC.sniffFormat(buf);
    if (sniffed && sniffed !== declaredExt) {
      const eq = (a, b) => ['jpg', 'jpeg', 'jpe', 'jfif'].includes(a) && ['jpg', 'jpeg', 'jpe', 'jfif'].includes(b);
      if (!eq(sniffed, declaredExt)) ext = sniffed;
    }
    const img = await decodeAny(ext, buf);
    if (!img || !img.width) throw new Error('فشل فك ترميز الصورة');
    const resized = await IC.resizeIfNeeded(img, options.maxDim);
    let out = await encodeAny(targetExt, resized, options);
    if (out instanceof ArrayBuffer) out = new Uint8Array(out);
    return { buffer: out, width: resized.width, height: resized.height, sourceExt: ext, mime: MIME[targetExt] || 'application/octet-stream' };
  }

  /* ================= الواجهة ================= */
  const ui = {
    badge: $('#statusBadge'), dz: $('#dropzone'), input: $('#fileInput'),
    settings: $('#settingsPanel'), filesSection: $('#filesSection'), filesList: $('#filesList'),
    filesCount: $('#filesCount'), convertBtn: $('#convertBtn'), convertBtnText: $('#convertBtnText'),
    resultsSection: $('#resultsSection'), resultsGrid: $('#resultsGrid'), resultsCount: $('#resultsCount'),
    zipBtn: $('#downloadZip'), clearAll: $('#clearAll'), toasts: $('#toasts'),
    menu: $('#formatMenu'), menuBtn: $('#formatSelectBtn'), menuLabel: $('#formatSelectLabel'),
    menuList: $('#formatList'), search: $('#formatSearch'), groups: $('#formatGroups'),
    vectorizeRow: $('#vectorizeRow'),
  };

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    ui.toasts.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 4200);
  }
  function humanSize(n) {
    if (n < 1024) return `${n} بايت`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} ك.ب`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(2)} م.ب`;
    return `${(n / 1073741824).toFixed(2)} ج.ب`;
  }
  function extOf(name) { const m = /\.([a-z0-9.]+)$/i.exec(name); return m ? m[1].toLowerCase() : ''; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function setStatus(ok, text) {
    ui.badge.className = `badge ${ok ? 'badge-green' : 'badge-error'}`;
    ui.badge.innerHTML = `<span class="dot"></span> ${text}`;
  }

  const MODE_TAGS = {
    native: '<span class="tag tag-native">كامل</span>',
    wrapper: '<span class="tag tag-wrapper">غلاف</span>',
    experimental: '<span class="tag tag-exp">تجريبي</span>',
    none: '<span class="tag tag-none">غير متاح</span>',
  };

  function buildMenu() {
    ui.menuList.innerHTML = '';
    const groups = {};
    for (const f of F) (groups[f.cat] = groups[f.cat] || []).push(f);
    for (const [cat, list] of Object.entries(groups)) {
      const title = document.createElement('div');
      title.className = 'select-group-title';
      title.textContent = CATS[cat] || cat;
      ui.menuList.appendChild(title);
      for (const f of list) {
        const opt = document.createElement('div');
        const encodable = !!f.enc;
        opt.className = 'select-option' + (encodable ? '' : ' disabled');
        opt.dataset.ext = f.ext;
        opt.dataset.search = `${f.ext} ${f.name}`.toLowerCase();
        if (!encodable) opt.title = f.note || 'غير متاح';
        opt.innerHTML = `<span><span class="ext">.${f.ext}</span> <span class="fname">${f.name}</span></span> ${MODE_TAGS[f.enc ? (f.mode || 'native') : 'none']}`;
        opt.addEventListener('click', () => {
          if (!encodable) { toast(f.note || 'غير متاح', 'err'); return; }
          state.target = f;
          ui.menuLabel.innerHTML = `<span class="target-ext">.${f.ext}</span> — ${f.name}`;
          closeMenu();
          ui.vectorizeRow.hidden = f.ext !== 'svg';
          updateBtn();
        });
        ui.menuList.appendChild(opt);
      }
    }
    // شرائح الصيغ أسفل الصفحة
    ui.groups.innerHTML = '';
    for (const [cat, list] of Object.entries(groups)) {
      const g = document.createElement('div');
      g.className = 'format-group';
      const writable = list.filter((f) => f.enc).length;
      g.innerHTML = `<h4>${CATS[cat] || cat} — ${list.length} صيغة (تُكتب: ${writable})</h4>`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const f of list) {
        const chip = document.createElement('span');
        chip.className = 'chip' + (f.enc ? '' : ' nowrite');
        chip.textContent = f.ext;
        if (!f.enc) chip.title = f.note || '';
        chips.appendChild(chip);
      }
      g.appendChild(chips);
      ui.groups.appendChild(g);
    }
    buildAccept();
  }
  function buildAccept() {
    ui.input.accept = F.filter((f) => f.dec).map((f) => '.' + f.ext).join(',');
  }
  function openMenu() {
    ui.menu.hidden = false;
    ui.menuBtn.classList.add('open');
    ui.search.value = '';
    filterFormats('');
    setTimeout(() => ui.search.focus(), 40);
  }
  function closeMenu() {
    ui.menu.hidden = true;
    ui.menuBtn.classList.remove('open');
  }
  ui.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); ui.menu.hidden ? openMenu() : closeMenu(); });
  document.addEventListener('click', (e) => { if (!$('#formatSelectWrap').contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  ui.search.addEventListener('input', (e) => filterFormats(e.target.value));
  function filterFormats(q) {
    q = q.trim().toLowerCase();
    ui.menuList.querySelectorAll('.select-option').forEach((o) => { o.style.display = !q || o.dataset.search.includes(q) ? '' : 'none'; });
    ui.menuList.querySelectorAll('.select-group-title').forEach((t) => { t.style.display = q ? 'none' : ''; });
  }

  /* إفلات/لصق */
  ['dragenter', 'dragover'].forEach((ev) => ui.dz.addEventListener(ev, (e) => { e.preventDefault(); ui.dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => ui.dz.addEventListener(ev, (e) => { e.preventDefault(); ui.dz.classList.remove('dragover'); }));
  ui.dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  ui.dz.addEventListener('click', () => ui.input.click());
  ui.dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') ui.input.click(); });
  ui.input.addEventListener('change', (e) => addFiles(e.target.files));
  window.addEventListener('paste', (e) => { if (e.clipboardData?.files?.length) addFiles(e.clipboardData.files); });

  function addFiles(list) {
    if (state.converting) { toast('انتظر انتهاء التحويل الحالي', 'err'); return; }
    const supported = new Set(F.filter((f) => f.dec).map((f) => f.ext));
    let added = 0;
    for (const file of Array.from(list || [])) {
      if (!file.size) continue;
      const ext = extOf(file.name);
      if (state.files.some((f) => f.name === file.name && f.size === file.size)) continue;
      state.files.push({ id: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, ext: supported.has(ext) ? ext : '', status: 'pending', doneTargets: new Set() });
      added++;
    }
    if (added) {
      renderFiles();
      toast(`أضيف ${added} ${added === 1 ? 'ملف' : 'ملفات'}`, 'ok');
      if (!state.target) {
        ui.settings.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(openMenu, 400);
      }
    }
    ui.input.value = '';
  }

  const GENERIC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L7 22"/></svg>`;

  function renderFiles() {
    ui.filesSection.hidden = state.files.length === 0;
    ui.filesCount.textContent = state.files.length;
    ui.filesList.innerHTML = '';
    for (const item of state.files) {
      const card = document.createElement('div');
      card.className = 'file-card';
      const statusHtml = {
        pending: `<span class="file-status" style="color:var(--text-faint)">جاهز</span>`,
        working: `<span class="file-status"><span class="spinner"></span> جاري التحويل…</span>`,
        done: `<span class="file-status ok">✓ تم</span>`,
        error: `<span class="file-status err">${escapeHtml(item.error || 'فشل')}</span>`,
      }[item.status];
      card.innerHTML = `
        <div class="file-thumb">${GENERIC_ICON}</div>
        <div class="file-info">
          <div class="file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="file-meta">${humanSize(item.size)}${item.ext ? ' · .' + escapeHtml(item.ext) : ''}</div>
        </div>
        ${statusHtml}
        <button class="file-remove" title="إزالة"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
      if (['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico', 'cur'].includes(item.ext)) {
        const img = document.createElement('img');
        img.onload = () => { card.querySelector('.file-thumb').innerHTML = ''; card.querySelector('.file-thumb').appendChild(img); };
        img.src = URL.createObjectURL(item.file);
      }
      card.querySelector('.file-remove').addEventListener('click', () => {
        if (state.converting || item.status === 'working') { toast('لا يمكن الإزالة أثناء التحويل', 'err'); return; }
        state.files = state.files.filter((f) => f.id !== item.id);
        renderFiles();
      });
      ui.filesList.appendChild(card);
    }
    updateBtn();
  }
  function doneCount() { return state.files.filter((f) => f.status === 'done' || f.status === 'error').length; }
  function updateBtn() {
    const remaining = state.target
      ? state.files.filter((f) => !(f.doneTargets || new Set()).has(state.target.ext)).length
      : 0;
    ui.convertBtn.disabled = state.files.length === 0 || !state.target || state.converting || remaining === 0;
    ui.menuBtn.classList.toggle('attention', state.files.length > 0 && !state.target);
    ui.convertBtnText.textContent = state.converting
      ? `جاري التحويل… (${doneCount()}/${state.files.length})`
      : !state.target
        ? 'اختر الصيغة الهدف أولاً'
        : remaining === 0
          ? `كل الملفات محوّلة إلى ${state.target.ext.toUpperCase()}`
          : `حوّل إلى ${state.target.ext.toUpperCase()}${remaining < state.files.length ? ` (${remaining} متبقٍ)` : ''}`;
  }
  ui.clearAll.addEventListener('click', () => {
    if (state.converting) return;
    clearResults();
    state.files = [];
    renderFiles();
  });
  $('#clearResults').addEventListener('click', () => {
    if (state.converting) return;
    clearResults();
    toast('تم مسح النتائج');
  });
  function clearResults() {
    for (const r of state.results) { try { URL.revokeObjectURL(r.url); } catch (_) {} }
    state.results = [];
    renderResults();
  }

  /* إعدادات */
  const quality = $('#quality');
  function syncQ() {
    const pct = ((quality.value - quality.min) / (quality.max - quality.min)) * 100;
    quality.style.setProperty('--fill', pct + '%');
    $('#qualityVal').textContent = quality.value + '%';
  }
  quality.addEventListener('input', syncQ);
  syncQ();
  $('#maxDim').addEventListener('input', (e) => { $('#maxDimVal').textContent = (Number(e.target.value) || 0) ? e.target.value + 'px' : 'بدون'; });
  $('#bgBlack').addEventListener('click', () => { $('#background').value = '#000000'; });
  $('#bgWhite').addEventListener('click', () => { $('#background').value = '#ffffff'; });

  /* التحويل */
  ui.convertBtn.addEventListener('click', async () => {
    if (state.converting || !state.target || !state.files.length) return;
    const T = state.target.ext;
    const queue = state.files.filter((f) => !(f.doneTargets || new Set()).has(T));
    if (!queue.length) { toast(`كل الملفات محوّلة بالفعل إلى ${T.toUpperCase()}`); return; }
    state.converting = true;
    updateBtn();
    const opts = {
      quality: +quality.value,
      background: $('#background').value,
      maxDim: +($('#maxDim').value || 0),
    };
    for (const item of queue) {
      item.status = 'working';
      renderFiles();
      await new Promise((r) => setTimeout(r, 16)); // تنفس للواجهة
      try {
        const buf = new Uint8Array(await item.file.arrayBuffer());
        const r = await convert(buf, item.ext, T, opts);
        const url = URL.createObjectURL(new Blob([r.buffer], { type: r.mime }));
        const name = uniqueName(`${baseOf(item.name)}.${T}`);
        state.results.push({
          id: item.id, name, size: r.buffer.length,
          originalSize: item.size, url, mime: r.mime, width: r.width, height: r.height,
        });
        item.status = 'done';
        if (!item.doneTargets) item.doneTargets = new Set();
        item.doneTargets.add(T);
        renderResults();
      } catch (err) {
        item.status = 'error';
        item.error = err.message || 'فشل التحويل';
        console.error(item.name, err);
      }
      renderFiles();
    }
    state.converting = false;
    updateBtn();
    const ok = queue.filter((f) => f.status === 'done').length;
    const failed = queue.length - ok;
    toast(failed ? `اكتمل: ${ok} نجح، ${failed} فشل` : `تم تحويل ${ok} ${ok === 1 ? 'صورة' : 'صور'} بنجاح 🎉`, failed && !ok ? 'err' : 'ok');
  });
  function baseOf(name) { return name.replace(/\.[^.]+$/, ''); }
  function uniqueName(name) {
    if (!state.results.some((r) => r.name === name)) return name;
    const base = baseOf(name);
    const ext = name.includes('.') ? name.split('.').pop() : '';
    let k = 2;
    while (state.results.some((r) => r.name === `${base} (${k}).${ext}`)) k++;
    return `${base} (${k}).${ext}`;
  }

  const THUMBABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/svg+xml', 'image/x-icon'];
  function renderResults() {
    ui.resultsSection.hidden = state.results.length === 0;
    ui.resultsCount.textContent = state.results.length;
    ui.resultsGrid.innerHTML = '';
    let totalIn = 0, totalOut = 0;
    for (const r of state.results) {
      totalIn += r.originalSize;
      totalOut += r.size;
      const delta = r.originalSize ? Math.round((1 - r.size / r.originalSize) * 100) : 0;
      const card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML = `
        <div class="result-thumb" title="انقر للمعاينة">
          ${THUMBABLE.includes(r.mime) ? `<img loading="lazy" src="${r.url}">` : `<div style="color:var(--text-faint);font-size:2rem;font-weight:800;direction:ltr">.${escapeHtml(r.name.split('.').pop())}</div>`}
        </div>
        <div class="result-body">
          <div class="result-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
          <div class="result-meta">${humanSize(r.size)} · ${r.width}×${r.height}
            ${delta > 0 ? `<span class="saved">−${delta}%</span>` : delta < 0 ? `<span class="grew">+${-delta}%</span>` : ''}</div>
          <div class="result-actions"><a class="btn btn-primary" href="${r.url}" download="${escapeHtml(r.name)}">تنزيل</a></div>
        </div>`;
      card.querySelector('.result-thumb').addEventListener('click', () => {
        const lb = document.createElement('div');
        lb.className = 'lightbox';
        if (THUMBABLE.includes(r.mime)) { const im = document.createElement('img'); im.src = r.url; lb.appendChild(im); }
        else {
          const div = document.createElement('div');
          div.className = 'lightbox-nonimg';
          div.innerHTML = `<strong style="direction:ltr">${escapeHtml(r.name)}</strong><br>لا يمكن معاينة هذه الصيغة داخل المتصفح — لكن الملف جاهز للتنزيل`;
          lb.appendChild(div);
        }
        lb.addEventListener('click', () => lb.remove());
        document.body.appendChild(lb);
      });
      ui.resultsGrid.appendChild(card);
    }
    $('#sumTotal').textContent = `${state.results.length} نتيجة · ${humanSize(totalOut)}`;
    const saved = totalIn ? Math.round((1 - totalOut / totalIn) * 100) : 0;
    const ss = $('#sumSaved');
    if (saved > 0) { ss.className = 'summary-item ok'; ss.textContent = `وفّرت ${saved}% من الحجم`; ss.hidden = false; }
    else if (saved < 0) { ss.className = 'summary-item'; ss.textContent = `الحجم زاد ${-saved}% (صيغة أعلى جودة)`; ss.hidden = false; }
    else ss.hidden = true;
    $('#convertSummary').hidden = false;
  }

  ui.zipBtn.addEventListener('click', async () => {
    if (!state.results.length) return;
    try {
      const zip = new IC.ZipWriter();
      const used = new Set();
      for (const r of state.results) {
        let name = r.name, k = 1;
        while (used.has(name)) name = `${baseOf(r.name)} (${k++}).${r.name.split('.').pop()}`;
        used.add(name);
        zip.add(name, new Uint8Array(await (await fetch(r.url)).arrayBuffer()));
      }
      const blob = new Blob([await zip.build()], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'converted-images.zip';
      a.click();
      toast('تم تجهيز الملف المضغوط', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  /* ================= انطلاق ================= */
  IC.hooks.decodeImageBytes = IC.libs.decodeImageBytes;
  IC.hooks.encodePng = IC.libs.encodePngCanvas;
  IC.hooks.decodeTiff = IC.libs.decodeTiff;
  setStatus(true, 'جاهز — التحويل يتم داخل متصفحك');
  buildMenu();
  updateBtn();
})();

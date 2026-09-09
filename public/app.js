/* محوّل الصور الاحترافي — منطق الواجهة */
'use strict';

const $ = (s) => document.querySelector(s);

const state = {
  files: [],       // {id, file, name, size, status: 'pending'|'working'|'done'|'error', error, resultId}
  results: [],     // {id, name, size, originalSize, downloadUrl, mime, width, height}
  formats: null,   // بيانات الصيغ من الخادم
  target: null,
  converting: false,
};

/* ================= أدوات عامة ================= */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

function humanSize(n) {
  if (n < 1024) return `${n} بايت`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} ك.ب`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(2)} م.ب`;
  return `${(n / 1073741824).toFixed(2)} ج.ب`;
}

function extOf(name) {
  const m = /\.([a-z0-9.]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function baseOf(name) {
  return name.replace(/\.[^.]+$/, '');
}

const GENERIC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L7 22"/></svg>`;

/* ================= تحميل الصيغ ================= */
async function loadFormats() {
  try {
    const fmtRes = await fetch('/api/formats');
    state.formats = await fmtRes.json();
    const badge = $('#statusBadge');
    badge.classList.add('badge-green');
    badge.innerHTML = '<span class="dot"></span> الخادم يعمل';
    buildFormatMenu();
    buildFormatChips();
    buildAcceptAttr();
  } catch (e) {
    const badge = $('#statusBadge');
    badge.classList.add('badge-error');
    badge.innerHTML = '<span class="dot"></span> تعذر الاتصال بالخادم';
  }
}

const MODE_TAGS = {
  native: '<span class="tag tag-native">كامل</span>',
  wrapper: '<span class="tag tag-wrapper">غلاف</span>',
  experimental: '<span class="tag tag-exp">تجريبي</span>',
  none: '<span class="tag tag-none">غير متاح</span>',
};

function buildFormatMenu() {
  const list = $('#formatList');
  list.innerHTML = '';
  for (const [cat, group] of Object.entries(state.formats.categories)) {
    const title = document.createElement('div');
    title.className = 'select-group-title';
    title.textContent = group.name;
    list.appendChild(title);
    for (const f of group.formats) {
      const opt = document.createElement('div');
      opt.className = 'select-option' + (f.encodable ? '' : ' disabled');
      opt.dataset.ext = f.ext;
      opt.dataset.search = `${f.ext} ${f.name}`.toLowerCase();
      if (!f.encodable) opt.title = f.note;
      opt.innerHTML = `
        <span><span class="ext">.${f.ext}</span> <span class="fname">${f.name}</span></span>
        ${MODE_TAGS[f.encodeMode] || ''}
      `;
      opt.addEventListener('click', () => {
        if (!f.encodable) { toast(f.note, 'err'); return; }
        selectTarget(f);
      });
      list.appendChild(opt);
    }
  }
}

function selectTarget(f) {
  state.target = f;
  $('#formatSelectLabel').innerHTML = `<span class="target-ext">.${f.ext}</span> — ${f.name}`;
  closeFormatMenu();
  $('#vectorizeRow').hidden = f.ext !== 'svg';
  updateConvertBtn();
}

function buildFormatChips() {
  const groupsEl = $('#formatGroups');
  groupsEl.innerHTML = '';
  for (const [cat, group] of Object.entries(state.formats.categories)) {
    const g = document.createElement('div');
    g.className = 'format-group';
    const writable = group.formats.filter((f) => f.encodable).length;
    g.innerHTML = `<h4>${group.name} — ${group.formats.length} صيغة (تُكتب: ${writable})</h4>`;
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const f of group.formats) {
      const chip = document.createElement('span');
      chip.className = 'chip' + (f.encodable ? '' : ' nowrite');
      chip.textContent = f.ext;
      if (!f.encodable) chip.title = f.note;
      chips.appendChild(chip);
    }
    g.appendChild(chips);
    groupsEl.appendChild(g);
  }
}

function buildAcceptAttr() {
  const exts = [];
  for (const group of Object.values(state.formats.categories)) {
    for (const f of group.formats) if (f.decodable) exts.push('.' + f.ext);
  }
  $('#fileInput').accept = exts.join(',');
}

/* ================= قائمة منتقي الصيغة ================= */
const menu = $('#formatMenu');
const btn = $('#formatSelectBtn');
function openFormatMenu() {
  menu.hidden = false;
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  $('#formatSearch').value = '';
  filterFormats('');
  setTimeout(() => $('#formatSearch').focus(), 40);
}
function closeFormatMenu() {
  menu.hidden = true;
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
}
btn.addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden ? openFormatMenu() : closeFormatMenu();
});
document.addEventListener('click', (e) => {
  if (!$('#formatSelectWrap').contains(e.target)) closeFormatMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFormatMenu(); });
$('#formatSearch').addEventListener('input', (e) => filterFormats(e.target.value));
function filterFormats(q) {
  q = q.trim().toLowerCase();
  document.querySelectorAll('.select-option').forEach((opt) => {
    opt.style.display = !q || opt.dataset.search.includes(q) ? '' : 'none';
  });
  document.querySelectorAll('.select-group-title').forEach((t) => { t.style.display = q ? 'none' : ''; });
}

/* ================= الإدخال: سحب/نقر/لصق ================= */
const dropzone = $('#dropzone');
dropzone.addEventListener('click', () => $('#fileInput').click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('#fileInput').click(); });
$('#fileInput').addEventListener('change', (e) => addFiles(e.target.files));
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.files;
  if (items && items.length) addFiles(items);
});

function addFiles(fileList) {
  if (!state.formats) { toast('الخادم غير متصل بعد — حدّث الصفحة', 'err'); return; }
  if (state.converting) { toast('انتظر انتهاء التحويل الحالي', 'err'); return; }
  const supported = new Set();
  for (const g of Object.values(state.formats.categories)) for (const f of g.formats) if (f.decodable) supported.add(f.ext);
  const incoming = Array.from(fileList || []);
  let added = 0, rejected = 0;
  for (const file of incoming) {
    const ext = extOf(file.name);
    if (!supported.has(ext)) {
      // وثيق التوقيع: أرسل مع sourceExt فارغ (الخادم يخمّن)
      const knownSize = file.size > 0;
      if (!knownSize) { rejected++; continue; }
    }
    if (state.files.some((f) => f.name === file.name && f.size === file.size)) continue;
    state.files.push({
      id: Math.random().toString(36).slice(2),
      file,
      name: file.name,
      size: file.size,
      ext: supported.has(ext) ? ext : '',
      status: 'pending',
    });
    added++;
  }
  if (rejected) toast(`تم تجاهل ${rejected} ملف فارغ`, 'err');
  if (added) {
    renderFiles();
    toast(`أضيف ${added} ${added === 1 ? 'ملف' : 'ملفات'}`, 'ok');
    // وجّه المستخدم لاختيار الصيغة الهدف إن لم يختر بعد
    if (!state.target) {
      $('#settingsPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => openFormatMenu(), 400);
    }
  }
  $('#fileInput').value = '';
}

/* ================= عرض قائمة الملفات ================= */
function renderFiles() {
  const wrap = $('#filesSection');
  const list = $('#filesList');
  wrap.hidden = state.files.length === 0;
  $('#filesCount').textContent = state.files.length;
  list.innerHTML = '';
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
      <button class="file-remove" title="إزالة" aria-label="إزالة">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    `;
    // صورة مصغرة للصيغ التي يعرضها المتصفح
    if (['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico', 'cur'].includes(item.ext)) {
      const img = document.createElement('img');
      const url = URL.createObjectURL(item.file);
      img.onload = () => { card.querySelector('.file-thumb').innerHTML = ''; card.querySelector('.file-thumb').appendChild(img); };
      img.src = url;
    }
    card.querySelector('.file-remove').addEventListener('click', () => {
      if (state.converting || item.status === 'working') { toast('لا يمكن الإزالة أثناء التحويل', 'err'); return; }
      state.files = state.files.filter((f) => f.id !== item.id);
      renderFiles();
    });
    list.appendChild(card);
  }
  updateConvertBtn();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateConvertBtn() {
  const btnEl = $('#convertBtn');
  btnEl.disabled = state.files.length === 0 || !state.target || state.converting;
  $('#formatSelectBtn').classList.toggle('attention', state.files.length > 0 && !state.target);
  $('#convertBtnText').textContent = state.converting
    ? `جاري التحويل… (${doneCount()}/${state.files.length})`
    : state.target
      ? `حوّل إلى ${state.target.ext.toUpperCase()}`
      : 'اختر الصيغة الهدف أولاً';
}
function doneCount() {
  return state.files.filter((f) => f.status === 'done' || f.status === 'error').length;
}

/* ================= التحكم بالإعدادات ================= */
const qualityInput = $('#quality');
function syncQualityFill() {
  const pct = ((qualityInput.value - qualityInput.min) / (qualityInput.max - qualityInput.min)) * 100;
  qualityInput.style.setProperty('--fill', pct + '%');
  $('#qualityVal').textContent = qualityInput.value + '%';
}
qualityInput.addEventListener('input', syncQualityFill);
syncQualityFill();
$('#maxDim').addEventListener('input', (e) => {
  const v = Number(e.target.value) || 0;
  $('#maxDimVal').textContent = v ? v + 'px' : 'بدون';
});
$('#bgBlack').addEventListener('click', () => { $('#background').value = '#000000'; });
$('#bgWhite').addEventListener('click', () => { $('#background').value = '#ffffff'; });

/* ================= التحويل ================= */
$('#convertBtn').addEventListener('click', startConvert);
$('#clearAll').addEventListener('click', () => {
  state.files = [];
  renderFiles();
});

async function startConvert() {
  if (state.converting || !state.target || !state.files.length) return;
  state.converting = true;
  updateConvertBtn();

  const concurrency = 2;
  let cursor = 0;
  const worker = async () => {
    while (cursor < state.files.length) {
      const item = state.files[cursor++];
      if (item.status === 'done') continue;
      item.status = 'working';
      renderFiles();
      try {
        const result = await convertOne(item);
        item.status = 'done';
        state.results.push(result);
        renderResults();
      } catch (err) {
        item.status = 'error';
        item.error = err.message || 'فشل التحويل';
      }
      renderFiles();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  state.converting = false;
  updateConvertBtn();
  const ok = state.files.filter((f) => f.status === 'done').length;
  const failed = state.files.length - ok;
  if (failed) toast(`اكتمل التحويل: ${ok} نجح، ${failed} فشل`, failed && !ok ? 'err' : 'ok');
  else toast(`تم تحويل ${ok} ${ok === 1 ? 'صورة' : 'صور'} بنجاح 🎉`, 'ok');
}

async function convertOne(item) {
  const fd = new FormData();
  fd.append('file', item.file, item.name);
  fd.append('target', state.target.ext);
  fd.append('sourceExt', item.ext);
  fd.append('baseNameEnc', encodeURIComponent(baseOf(item.name)));
  fd.append('quality', qualityInput.value);
  fd.append('background', $('#background').value);
  fd.append('maxDim', $('#maxDim').value || '0');
  fd.append('vectorize', $('#vectorize').checked ? '1' : '0');
  const res = await fetch('/api/convert', { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({ ok: false, error: 'استجابة غير صالحة من الخادم' }));
  if (!json.ok) throw new Error(json.error || `فشل (${res.status})`);
  return {
    id: json.id,
    name: json.name,
    size: json.size,
    originalSize: item.size,
    downloadUrl: json.downloadUrl,
    mime: json.mime,
    width: json.width,
    height: json.height,
  };
}

/* ================= النتائج ================= */
function renderResults() {
  const section = $('#resultsSection');
  section.hidden = state.results.length === 0;
  $('#resultsCount').textContent = state.results.length;
  const grid = $('#resultsGrid');
  grid.innerHTML = '';
  let totalIn = 0, totalOut = 0;
  for (const r of state.results) {
    totalIn += r.originalSize;
    totalOut += r.size;
    const card = document.createElement('div');
    card.className = 'result-card';
    const delta = r.originalSize ? Math.round((1 - r.size / r.originalSize) * 100) : 0;
    const thumbable = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/svg+xml', 'image/x-icon'].includes(r.mime);
    card.innerHTML = `
      <div class="result-thumb" title="انقر للمعاينة">
        ${thumbable ? `<img loading="lazy" src="${r.downloadUrl.replace('/download/', '/preview/')}" alt="">` : `<div style="color:var(--text-faint);font-size:2rem;font-weight:800;direction:ltr">.${escapeHtml(r.name.split('.').pop())}</div>`}
      </div>
      <div class="result-body">
        <div class="result-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
        <div class="result-meta">
          ${humanSize(r.size)} · ${r.width}×${r.height}
          ${delta > 0 ? `<span class="saved">−${delta}%</span>` : delta < 0 ? `<span class="grew">+${-delta}%</span>` : ''}
        </div>
        <div class="result-actions">
          <a class="btn btn-primary" href="${r.downloadUrl}" download="${escapeHtml(r.name)}">تنزيل</a>
        </div>
      </div>
    `;
    card.querySelector('.result-thumb').addEventListener('click', () => openLightbox(r));
    grid.appendChild(card);
  }
  $('#sumTotal').textContent = `${state.results.length} نتيجة · ${humanSize(totalOut)}`;
  const saved = totalIn ? Math.round((1 - totalOut / totalIn) * 100) : 0;
  const sumSaved = $('#sumSaved');
  if (saved > 0) { sumSaved.className = 'summary-item ok'; sumSaved.textContent = `وفّرت ${saved}% من الحجم`; sumSaved.hidden = false; }
  else if (saved < 0) { sumSaved.textContent = `الحجم زاد ${-saved}% (صيغة أعلى جودة)`; sumSaved.hidden = false; sumSaved.className = 'summary-item'; }
  else sumSaved.hidden = true;
  $('#convertSummary').hidden = false;
}

$('#downloadZip').addEventListener('click', async () => {
  if (!state.results.length) return;
  try {
    const res = await fetch('/api/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: state.results.map((r) => r.id) }),
    });
    if (!res.ok) throw new Error('فشل إنشاء ZIP');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted-images.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('تم تجهيز الملف المضغوط', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
});

function openLightbox(r) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  const viewable = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/svg+xml', 'image/x-icon'];
  if (viewable.includes(r.mime)) {
    const img = document.createElement('img');
    img.src = r.downloadUrl.replace('/download/', '/preview/');
    lb.appendChild(img);
  } else {
    const div = document.createElement('div');
    div.className = 'lightbox-nonimg';
    div.innerHTML = `<strong style="direction:ltr">${escapeHtml(r.name)}</strong><br>لا يمكن معاينة هذه الصيغة داخل المتصفح — لكن الملف جاهز للتنزيل`;
    lb.appendChild(div);
  }
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

/* ================= انطلاق ================= */
loadFormats();

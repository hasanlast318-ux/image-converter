'use strict';
/* خادم محوّل الصور الاحترافي — يعمل محلياً بالكامل */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const { convert } = require('./src/convert');
const formats = require('./src/formats');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const TEMP_DIR = path.join(ROOT, 'temp', 'results');
const MAX_UPLOAD = 512 * 1024 * 1024; // 512MB

fs.mkdirSync(TEMP_DIR, { recursive: true });
const publicDir = path.join(ROOT, 'public');
app.use(express.static(publicDir));
app.use(express.json({ limit: '4mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 32 },
});

/* ---------- واجهة API ---------- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'ImageConverter Pro', version: '1.0.0', time: new Date().toISOString() });
});

app.get('/api/formats', async (req, res) => {
  res.json(formats.formatsInfo());
});

/* تحويل ملف واحد */
app.post('/api/convert', upload.single('file'), async (req, res) => {
  const started = Date.now();
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'لم يتم إرسال أي ملف' });
    const target = String(req.body.target || '').toLowerCase().replace(/^\./, '');
    if (!formats.isSupported(target)) return res.status(400).json({ ok: false, error: `صيغة الهدف غير مدعومة: ${target}` });
    if (!formats.canEncode(target)) return res.status(400).json({ ok: false, error: formats.NO_ENCODE[target] });

    const sourceExt = String(req.body.sourceExt || '').toLowerCase().replace(/^\./, '');
    let baseName = 'image';
    try {
      if (req.body.baseNameEnc) baseName = decodeURIComponent(String(req.body.baseNameEnc));
      else if (req.body.baseName) baseName = String(req.body.baseName);
    } catch (_) { baseName = 'image'; }

    const result = await convert(req.file.buffer, sourceExt, target, {
      quality: req.body.quality,
      background: req.body.background,
      maxDim: req.body.maxDim,
      vectorize: req.body.vectorize === '1' || req.body.vectorize === 'true',
    });

    // حفظ النتيجة مؤقتاً
    const id = crypto.randomBytes(10).toString('hex');
    const outName = `${sanitizeName(baseName)}.${target}`;
    const outPath = path.join(TEMP_DIR, id + '.bin');
    fs.writeFileSync(outPath, result.buffer);
    const meta = {
      id,
      name: outName,
      baseName,
      mime: result.mime,
      size: result.buffer.length,
      width: result.width,
      height: result.height,
      sourceExt: result.sourceExt,
      targetExt: result.targetExt,
      created: Date.now(),
    };
    fs.writeFileSync(outPath + '.json', JSON.stringify(meta));

    res.json({
      ok: true,
      id,
      name: outName,
      size: result.buffer.length,
      width: result.width,
      height: result.height,
      mime: result.mime,
      downloadUrl: `/api/download/${id}`,
      elapsed: Date.now() - started,
    });
  } catch (err) {
    console.error('[convert]', err.message);
    res.status(422).json({ ok: false, error: friendlyError(err) });
  }
});

/* تنزيل نتيجة */
app.get('/api/download/:id', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ ok: false, error: 'النتيجة غير موجودة أو انتهت صلاحيتها' });
  const file = path.join(TEMP_DIR, meta.id + '.bin');
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Content-Length', meta.size);
  const asciiName = meta.name.replace(/[^\x20-\x7e]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
  fs.createReadStream(file).pipe(res);
});

/* معاينة نتيجة (داخل الصفحة) */
app.get('/api/preview/:id', (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).end();
  const file = path.join(TEMP_DIR, meta.id + '.bin');
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Cache-Control', 'private, max-age=600');
  fs.createReadStream(file).pipe(res);
});

/* ضغط النتائج في ZIP */
app.post('/api/zip', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 200) : [];
    const metas = ids.map((id) => readMeta(id)).filter(Boolean);
    if (!metas.length) return res.status(400).json({ ok: false, error: 'لا توجد نتائج للضغط' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="converted-images.zip"');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (e) => {
      console.error('[zip]', e.message);
      res.destroy(e);
    });
    archive.pipe(res);
    const used = new Set();
    for (const m of metas) {
      let name = `${sanitizeName(m.baseName)}.${m.targetExt}`;
      let k = 1;
      while (used.has(name)) name = `${sanitizeName(m.baseName)} (${k++}).${m.targetExt}`;
      used.add(name);
      archive.file(path.join(TEMP_DIR, m.id + '.bin'), { name });
    }
    await archive.finalize();
  } catch (err) {
    console.error('[zip]', err.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'فشل إنشاء الملف المضغوط' });
  }
});

/* ---------- أدوات ---------- */
function readMeta(id) {
  if (!/^[a-f0-9]{20}$/.test(String(id))) return null;
  const p = path.join(TEMP_DIR, id + '.bin.json');
  if (!fs.existsSync(p)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!fs.existsSync(path.join(TEMP_DIR, meta.id + '.bin'))) return null;
    return meta;
  } catch (_) { return null; }
}
function sanitizeName(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return (cleaned || 'image').slice(0, 120);
}
function friendlyError(err) {
  const msg = err && err.message ? err.message : 'خطأ غير معروف أثناء التحويل';
  return msg;
}

/* تنظيف دوري للملفات الأقدم من 3 ساعات */
setInterval(() => {
  try {
    const cutoff = Date.now() - 3 * 3600 * 1000;
    for (const f of fs.readdirSync(TEMP_DIR)) {
      const p = path.join(TEMP_DIR, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (_) {}
    }
  } catch (_) {}
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`✅ محوّل الصور الاحترافي يعمل الآن على:  http://localhost:${PORT}`);
  console.log(`   المجلد: ${ROOT}`);
});

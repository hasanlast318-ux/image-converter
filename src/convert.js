'use strict';
/* خط الأنابيب: فك → معالجة → ترميز */

const zlib = require('zlib');
const path = require('path');
const U = require('./utils');
const { decodeAny } = require('./decoders');
const { ENCODERS } = require('./encoders');
const formats = require('./formats');

/** يحسم امتداد المصدر: من الامتداد المعلن أو من التوقيع */
function resolveSource(buf, declaredExt) {
  const sniffed = U.sniffFormat(buf);
  let ext = declaredExt && formats.isSupported(declaredExt) ? declaredExt : sniffed;
  // ملاحظة: نثق بالتوقيع عند التعارض (إلا jpg/jpeg المتكافئة)
  if (sniffed && declaredExt && sniffed !== declaredExt) {
    const eq = (a, b) => ['jpg', 'jpeg', 'jpe', 'jfif'].includes(a) && ['jpg', 'jpeg', 'jpe', 'jfif'].includes(b);
    if (!eq(sniffed, declaredExt)) ext = sniffed;
  }
  return ext || declaredExt || null;
}

/**
 * يحوّل مخزن بيانات من صيغة إلى أخرى.
 * options: { quality=90, background='#ffffff', maxDim=0, vectorize=false }
 */
async function convert(buf, sourceExt, targetExt, options = {}) {
  const opts = {
    quality: clamp(Number(options.quality) || 90, 1, 100),
    background: /^#[0-9a-f]{6}$/i.test(options.background || '') ? options.background : '#ffffff',
    maxDim: Math.min(Math.max(0, Number(options.maxDim) || 0), 20000),
    vectorize: !!options.vectorize,
  };

  const src = resolveSource(Buffer.from(buf), sourceExt);
  if (!src || !formats.isSupported(src)) throw new Error(`صيغة المصدر غير مدعومة: .${sourceExt}`);
  if (!formats.isSupported(targetExt)) throw new Error(`صيغة الهدف غير مدعومة: .${targetExt}`);
  if (!formats.canEncode(targetExt)) throw new Error(formats.NO_ENCODE[targetExt]);

  let img = await decodeAny(src, Buffer.from(buf));
  if (!img || !img.width || !img.height) throw new Error('فشل فك ترميز الصورة');

  if (opts.maxDim) img = await U.resizeIfNeeded(img, opts.maxDim);

  const encoder = ENCODERS[targetExt];
  if (!encoder) throw new Error(`لا يوجد مشفّر للصيغة .${targetExt}`);
  let out = await encoder(img, opts);
  if (targetExt === 'fits.gz') out = zlib.gzipSync(out);

  return {
    buffer: Buffer.from(out),
    sourceExt: src,
    targetExt,
    width: img.width,
    height: img.height,
    mime: formats.mimeOf(targetExt),
  };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

module.exports = { convert, resolveSource };

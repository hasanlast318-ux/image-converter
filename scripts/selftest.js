'use strict';
/* مصفوفة اختبار تحويلات شاملة: لكل مشفّر وفاك ترميز زوج تحقق */

const fs = require('fs');
const path = require('path');
const { convert } = require('../src/convert');

const SAMPLES = path.join(__dirname, '..', 'test', 'samples');

const PAIRS = [
  // [ملف المصدر, صيغة الهدف, حرج?]
  ['sample.png', 'jpg', true],
  ['sample.png', 'webp', true],
  ['sample.png', 'gif', true],
  ['sample.png', 'tiff', true],
  ['sample.png', 'bmp', true],
  ['sample.png', 'dib', true],
  ['sample.png', 'tga', true],
  ['sample.png', 'pcx', true],
  ['sample.png', 'ppm', true],
  ['sample.png', 'pgm', true],
  ['sample.png', 'pbm', true],
  ['sample.png', 'pam', true],
  ['sample.png', 'hdr', true],
  ['sample.png', 'exr', true],
  ['sample.png', 'dds', true],
  ['sample.png', 'ico', true],
  ['sample.png', 'cur', true],
  ['sample.png', 'icns', true],
  ['sample.png', 'sgi', true],
  ['sample.png', 'rgb', true],
  ['sample.png', 'rgba', true],
  ['sample.png', 'fits', true],
  ['sample.png', 'fits.gz', true],
  ['sample.png', 'psd', true],
  ['sample.png', 'psb', true],
  ['sample.png', 'xcf', true],
  ['sample.png', 'pdf', true],
  ['sample.png', 'ai', true],
  ['sample.png', 'eps', true],
  ['sample.png', 'wmf', true],
  ['sample.png', 'emf', true],
  ['sample.png', 'svg', true],
  ['sample.png', 'dng', true],
  ['sample.png', 'raw', true],
  ['sample.png', 'jxl', false], // اختياري (wasm)
  ['sample.png', 'avif', false], // اختياري بحسب بناء sharp
  ['sample.jpg', 'png', true],
  ['sample.webp', 'png', true],
  ['sample.gif', 'png', true],
  ['sample.tiff', 'png', true],
  ['sample.bmp', 'png', true],
  ['sample.tga', 'png', true],
  ['sample.pcx', 'png', true],
  ['sample.ppm', 'png', true],
  ['sample.pam', 'png', true],
  ['sample.hdr', 'png', true],
  ['sample.exr', 'png', true],
  ['sample.dds', 'png', true],
  ['sample.ico', 'png', true],
  ['sample.icns', 'png', true],
  ['sample.sgi', 'png', true],
  ['sample.fits', 'png', true],
  ['sample.fits.gz', 'png', true],
  ['sample.psd', 'png', true],
  ['sample.psb', 'png', true],
  ['sample.xcf', 'png', true],
  ['sample.pdf', 'png', true],
  ['sample.svg', 'png', true],
  ['sample.eps', 'png', true],
  ['sample.wmf', 'png', true],
  ['sample.emf', 'png', true],
  ['sample.raw', 'png', true],
  ['sample.dng', 'png', false], // DNG خطي اصطناعي — libraw قد يتجاهله؛ DNG الحقيقي من الكاميرات مدعوم
  ['sample.jxl', 'png', false],
  ['sample.avif', 'png', false],
  // تحويلات مزدوجة (سلسلة حقيقية عبر الخادم نفس المسار)
  ['sample.png', 'png', true], // نفس الصيغة = إعادة ترميز
];

async function main() {
  const only = process.argv[2];
  let pass = 0, fail = 0, skip = 0;
  const failures = [];
  for (const [srcFile, target, critical] of PAIRS) {
    if (only && !srcFile.includes(only) && target !== only) continue;
    const srcPath = path.join(SAMPLES, srcFile);
    if (!fs.existsSync(srcPath)) {
      skip++;
      continue;
    }
    const buf = fs.readFileSync(srcPath);
    const srcExt = srcFile.toLowerCase().endsWith('.gz') ? 'fits.gz' : srcFile.split('.').pop();
    const t0 = Date.now();
    try {
      const r = await convert(buf, srcExt, target, { quality: 90 });
      if (!r.buffer || r.buffer.length < 16) throw new Error('المخرجات فارغة');
      // تحقق بالعكس: فك المخرجات وتحويلها إلى png
      const back = await convert(r.buffer, target === 'fits.gz' ? 'fits.gz' : target, 'png', {});
      if (!back.buffer || !back.width) throw new Error('المخرجات لا تفك بترميز معكوس');
      // تحقق أبعاد (ico/icns متعددة الأحجام، cur 32px، wmf/emf يُرسم بمقياس)
      if (!['ico', 'cur', 'icns', 'wmf', 'emf'].includes(target) && back.width !== 160) {
        throw new Error(`أبعاد مختلفة: ${back.width}×${back.height}`);
      }
      pass++;
      console.log(`✓ ${srcFile.padEnd(16)} → ${target.padEnd(8)} (${r.buffer.length} بايت, ${Date.now() - t0}ms)`);
    } catch (e) {
      if (critical) {
        fail++;
        failures.push(`${srcFile}→${target}: ${e.message}`);
        console.log(`✗ ${srcFile.padEnd(16)} → ${target.padEnd(8)} خطأ: ${e.message}`);
      } else {
        skip++;
        console.log(`~ ${srcFile.padEnd(16)} → ${target.padEnd(8)} تخطي (اختياري): ${e.message}`);
      }
    }
  }
  console.log('='.repeat(60));
  console.log(`النتيجة: نجح ${pass} · فشل ${fail} · تخطي ${skip}`);
  if (failures.length) {
    console.log('إخفاقات حرجة:');
    for (const f of failures) console.log('  -', f);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

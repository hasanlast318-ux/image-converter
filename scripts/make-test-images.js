'use strict';
/* يولّد صور اختبار بصيغ متعددة في test/samples */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const U = require('../src/utils');
const { ENCODERS } = require('../src/encoders');

const OUT = path.join(__dirname, '..', 'test', 'samples');
fs.mkdirSync(OUT, { recursive: true });

const W = 160, H = 120;

/** صورة اختبار: تدرج + أشكال + زوايا ملونة وشفافية جزئية */
function testImage() {
  const img = U.makeImage(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      img.rgba[p] = Math.round((x / W) * 255);
      img.rgba[p + 1] = Math.round((y / H) * 255);
      img.rgba[p + 2] = Math.round(255 - (x / W) * 255);
      // دائرة بيضاء مركزية
      const dx = x - W / 2, dy = y - H / 2;
      if (dx * dx + dy * dy < 30 * 30) {
        img.rgba[p] = 255; img.rgba[p + 1] = 255; img.rgba[p + 2] = 255;
      }
      // شريط شفاف سفلي (لاختبار الألفا)
      if (y > H - 25) img.rgba[p + 3] = Math.round(((H - y) / 25) * 255);
      else img.rgba[p + 3] = 255;
      // نقطة حمراء دقيقة (لاختبار الحدة)
      if (x === 5 && y === 5) { img.rgba[p] = 255; img.rgba[p + 1] = 0; img.rgba[p + 2] = 0; img.rgba[p + 3] = 255; }
    }
  }
  return img;
}

async function main() {
  const img = testImage();
  const opts = { quality: 90, background: '#ffffff', maxDim: 0, vectorize: false };
  const made = [];
  const fail = [];
  // صور أساسية عبر sharp
  const base = await sharp(Buffer.from(img.rgba.buffer), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  fs.writeFileSync(path.join(OUT, 'sample.png'), base);
  made.push('png');
  const jpg = await sharp(base).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(path.join(OUT, 'sample.jpg'), jpg);
  made.push('jpg');
  for (const [ext, buf] of [
    ['webp', await sharp(base).webp().toBuffer()],
    ['gif', await sharp(base).gif().toBuffer()],
    ['tiff', await sharp(base).tiff().toBuffer()],
    ['avif', await sharp(base).avif({ quality: 60 }).toBuffer().catch(() => null)],
  ]) {
    if (buf) { fs.writeFileSync(path.join(OUT, `sample.${ext}`), buf); made.push(ext); }
  }
  // SVG نصي
  fs.writeFileSync(path.join(OUT, 'sample.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#204080"/><circle cx="80" cy="60" r="40" fill="#ff8800"/><text x="10" y="20" fill="#fff" font-size="14">Sample SVG</text></svg>`);
  made.push('svg');
  // باقي الصيغ عبر مخارج مشفّراتنا (تختبر الترميز وفك الترميز معاً)
  for (const ext of ['bmp', 'tga', 'pcx', 'ppm', 'pgm', 'pbm', 'pam', 'hdr', 'exr', 'dds', 'ico', 'cur', 'icns', 'sgi', 'rgb', 'rgba', 'fits', 'fits.gz', 'psd', 'psb', 'xcf', 'pdf', 'eps', 'wmf', 'emf', 'dng', 'raw']) {
    const encoder = ENCODERS[ext];
    if (!encoder) continue;
    try {
      const buf = await encoder(img, opts);
      fs.writeFileSync(path.join(OUT, `sample.${ext}`), buf);
      made.push(ext);
    } catch (e) {
      fail.push(`${ext}: ${e.message}`);
    }
  }
  console.log('✔ أنشئت العينات:', made.join(', '));
  if (fail.length) console.log('✖ فشل إنشاء:', fail.join(' | '));
}

main().catch((e) => { console.error(e); process.exit(1); });

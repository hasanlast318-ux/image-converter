'use strict';
/* سجل الصيغ: بيانات وصفية للواجهة + القدرات */

const CATEGORY_NAMES = {
  common: 'صيغ شائعة',
  modern: 'صيغ حديثة',
  raw: 'كاميرات RAW',
  design: 'تصميم ومتجهات',
  doc: 'مستندات',
  icon: 'أيقونات',
  sci: 'علمية وألعاب وHDR',
};

/* صيغ لا يمكن كتابتها محلياً مع السبب */
const NO_ENCODE = {
  heic: 'الكتابة بـ HEIC تتطلب مشفّر HEVC مغلق المصدر غير المتوفر محلياً — البديل المكافئ: AVIF',
  heif: 'الكتابة بـ HEIF تتطلب مشفّر HEVC غير المتوفر محلياً — البديل المكافئ: AVIF',
  jp2: 'لا يوجد مشفّر JPEG 2000 محلياً — جرّب WebP أو AVIF للضغط الحديث',
  j2k: 'لا يوجد مشفّر JPEG 2000 محلياً — جرّب WebP أو AVIF للضغط الحديث',
  jpf: 'لا يوجد مشفّر JPEG 2000 محلياً — جرّب WebP أو AVIF للضغط الحديث',
  jpx: 'لا يوجد مشفّر JPEG 2000 محلياً — جرّب WebP أو AVIF للضغط الحديث',
  jpm: 'لا يوجد مشفّر JPEG 2000 محلياً — جرّب WebP أو AVIF للضغط الحديث',
  mj2: 'لا يوجد مشفّر JPEG 2000 محلياً — جرّب WebP أو AVIF للضغط الحديث',
  cr2: 'صيغة Canon RAW مغلقة ولا يمكن إنشاؤها إلا بكاميرات Canon — البديل المفتوح: DNG',
  cr3: 'صيغة Canon RAW مغلقة ولا يمكن إنشاؤها إلا بكاميرات Canon — البديل المفتوح: DNG',
  nef: 'صيغة Nikon RAW مغلقة — البديل المفتوح: DNG',
  nrw: 'صيغة Nikon RAW مغلقة — البديل المفتوح: DNG',
  arw: 'صيغة Sony RAW مغلقة — البديل المفتوح: DNG',
  srf: 'صيغة Sony RAW مغلقة — البديل المفتوح: DNG',
  sr2: 'صيغة Sony RAW مغلقة — البديل المفتوح: DNG',
  raf: 'صيغة Fujifilm RAW مغلقة — البديل المفتوح: DNG',
  orf: 'صيغة Olympus RAW مغلقة — البديل المفتوح: DNG',
  rw2: 'صيغة Panasonic RAW مغلقة — البديل المفتوح: DNG',
  rwl: 'صيغة Leica RAW مغلقة — البديل المفتوح: DNG',
  pef: 'صيغة Pentax RAW مغلقة — البديل المفتوح: DNG',
  '3fr': 'صيغة Hasselblad RAW مغلقة — البديل المفتوح: DNG',
  iiq: 'صيغة Phase One RAW مغلقة — البديل المفتوح: DNG',
  x3f: 'صيغة Sigma RAW مغلقة — البديل المفتوح: DNG',
  erf: 'صيغة Epson RAW مغلقة — البديل المفتوح: DNG',
  kdc: 'صيغة Kodak RAW مغلقة — البديل المفتوح: DNG',
  dcr: 'صيغة Kodak RAW مغلقة — البديل المفتوح: DNG',
  mrw: 'صيغة Minolta RAW مغلقة — البديل المفتوح: DNG',
  mef: 'صيغة Minolta RAW مغلقة — البديل المفتوح: DNG',
  mos: 'صيغة Leaf RAW مغلقة — البديل المفتوح: DNG',
  srw: 'صيغة Samsung RAW مغلقة — البديل المفتوح: DNG',
  cdr: 'صيغة CorelDRAW مغلقة ولا يوجد كاتب عام لها — البدائل المتجهية: SVG أو EPS أو AI',
};

/* وضع الكتابة: native = ترميز أصلي كامل، wrapper = غلاف/تضمين قياسي، experimental = تجريبي */
const ENCODE_MODE = {
  xcf: 'experimental',
  ai: 'wrapper',
  eps: 'native',
  wmf: 'wrapper',
  emf: 'wrapper',
  svg: 'native', // تضمين PNG قياسي + خيار تحويل لمسارات متجهة
  raw: 'native',
};

const MIMES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
  bmp: 'image/bmp', dib: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  svg: 'image/svg+xml', ico: 'image/x-icon', cur: 'image/x-icon', icns: 'image/x-icns',
  heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl',
  jp2: 'image/jp2', j2k: 'image/j2k', jpf: 'image/jp2', jpx: 'image/jpx', jpm: 'image/jpm', mj2: 'video/mj2',
  psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop', xcf: 'image/x-xcf',
  ai: 'application/illustrator', eps: 'application/postscript', cdr: 'application/vnd.corel-draw',
  wmf: 'image/wmf', emf: 'image/emf', pdf: 'application/pdf',
  dds: 'image/vnd-ms.dds', tga: 'image/x-tga', pcx: 'image/x-pcx',
  ppm: 'image/x-portable-pixmap', pgm: 'image/x-portable-graymap', pbm: 'image/x-portable-bitmap',
  pnm: 'image/x-portable-anymap', pam: 'image/x-portable-arbitrarymap',
  hdr: 'image/vnd.radiance', exr: 'image/x-exr', fits: 'image/fits', 'fits.gz': 'application/gzip',
  sgi: 'image/sgi', rgb: 'image/sgi', rgba: 'image/sgi',
};

const NAMES = {
  jpg: 'JPEG', jpeg: 'JPEG', jpe: 'JPEG', jfif: 'JFIF (JPEG)',
  png: 'PNG', webp: 'WebP', avif: 'AVIF', gif: 'GIF',
  bmp: 'Bitmap (BMP)', dib: 'DIB', tif: 'TIFF', tiff: 'TIFF',
  svg: 'SVG', ico: 'أيقونة ICO', cur: 'مؤشر CUR', icns: 'أيقونة Mac ICNS',
  heic: 'HEIC (آيفون)', heif: 'HEIF', jxl: 'JPEG XL',
  jp2: 'JPEG 2000', j2k: 'JPEG 2000 كود ستريم', jpf: 'JPEG 2000', jpx: 'JPEG 2000 موسع', jpm: 'JPEG 2000 MJP', mj2: 'Motion JPEG 2000',
  raw: 'RAW بكسلات', dng: 'DNG (Adobe)', cr2: 'Canon CR2', cr3: 'Canon CR3', nef: 'Nikon NEF', nrw: 'Nikon NRW',
  arw: 'Sony ARW', srf: 'Sony SRF', sr2: 'Sony SR2', raf: 'Fujifilm RAF', orf: 'Olympus ORF', rw2: 'Panasonic RW2',
  rwl: 'Leica RWL', pef: 'Pentax PEF', '3fr': 'Hasselblad 3FR', iiq: 'Phase One IIQ', x3f: 'Sigma X3F',
  erf: 'Epson ERF', kdc: 'Kodak KDC', dcr: 'Kodak DCR', mrw: 'Minolta MRW', mef: 'Minolta MEF', mos: 'Leaf MOS', srw: 'Samsung SRW',
  psd: 'Photoshop PSD', psb: 'Photoshop PSB (كبير)', xcf: 'GIMP XCF', ai: 'Adobe Illustrator', eps: 'EPS', cdr: 'CorelDRAW',
  wmf: 'Windows Metafile', emf: 'Enhanced Metafile', pdf: 'PDF',
  dds: 'DirectDraw Surface', tga: 'Truevision TGA', pcx: 'PC Paintbrush',
  ppm: 'Portable Pixmap', pgm: 'Portable Graymap', pbm: 'Portable Bitmap', pnm: 'Portable Anymap', pam: 'PAM',
  hdr: 'Radiance HDR', exr: 'OpenEXR', fits: 'FITS فلكي', 'fits.gz': 'FITS مضغوط',
  sgi: 'Silicon Graphics', rgb: 'SGI RGB', rgba: 'SGI RGBA',
};

const CATEGORIES = {
  jpg: 'common', jpeg: 'common', jpe: 'common', jfif: 'common', png: 'common', webp: 'common', gif: 'common', bmp: 'common', dib: 'common', tif: 'common', tiff: 'common',
  avif: 'modern', heic: 'modern', heif: 'modern', jxl: 'modern', jp2: 'modern', j2k: 'modern', jpf: 'modern', jpx: 'modern', jpm: 'modern', mj2: 'modern',
  raw: 'raw', dng: 'raw', cr2: 'raw', cr3: 'raw', nef: 'raw', nrw: 'raw', arw: 'raw', srf: 'raw', sr2: 'raw', raf: 'raw', orf: 'raw', rw2: 'raw', rwl: 'raw', pef: 'raw', '3fr': 'raw', iiq: 'raw', x3f: 'raw', erf: 'raw', kdc: 'raw', dcr: 'raw', mrw: 'raw', mef: 'raw', mos: 'raw', srw: 'raw',
  psd: 'design', psb: 'design', xcf: 'design', ai: 'design', eps: 'design', cdr: 'design', wmf: 'design', emf: 'design', svg: 'design',
  pdf: 'doc',
  ico: 'icon', cur: 'icon', icns: 'icon',
  dds: 'sci', tga: 'sci', pcx: 'sci', ppm: 'sci', pgm: 'sci', pbm: 'sci', pnm: 'sci', pam: 'sci', hdr: 'sci', exr: 'sci', fits: 'sci', 'fits.gz': 'sci', sgi: 'sci', rgb: 'sci', rgba: 'sci',
};

/* كل الامتدادات المدعومة */
const ALL_EXTENSIONS = Object.keys(CATEGORIES);

const DECODABLE = new Set(ALL_EXTENSIONS);

function canEncode(ext) {
  return !NO_ENCODE[ext];
}

/** معلومات الصيغ للواجهة */
function formatsInfo() {
  const groups = {};
  for (const [cat, name] of Object.entries(CATEGORY_NAMES)) groups[cat] = { name, formats: [] };
  for (const ext of ALL_EXTENSIONS) {
    const noEnc = NO_ENCODE[ext];
    groups[CATEGORIES[ext]].formats.push({
      ext,
      name: NAMES[ext] || ext.toUpperCase(),
      mime: MIMES[ext] || 'application/octet-stream',
      decodable: DECODABLE.has(ext),
      encodable: !noEnc,
      encodeMode: noEnc ? 'none' : (ENCODE_MODE[ext] || 'native'),
      note: noEnc || '',
    });
  }
  return { categories: groups };
}

function isSupported(ext) {
  return ALL_EXTENSIONS.includes(ext);
}

function mimeOf(ext) {
  return MIMES[ext] || 'application/octet-stream';
}

module.exports = { CATEGORY_NAMES, NO_ENCODE, ENCODE_MODE, MIMES, NAMES, CATEGORIES, ALL_EXTENSIONS, formatsInfo, isSupported, canEncode, mimeOf };

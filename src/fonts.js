// TeX Gyre Bonum (GUST Font License) – embedded so the app looks identical on every computer.
// The same files are embedded in exported PDFs, so screen and print use the very same glyphs.
import regular from './fonts/bonum-regular.ttf?inline';
import bold from './fonts/bonum-bold.ttf?inline';
import italic from './fonts/bonum-italic.ttf?inline';
import bolditalic from './fonts/bonum-bolditalic.ttf?inline';

const URLS = { normal: regular, bold, italic, bolditalic };
export const FONT_B64 = Object.fromEntries(Object.entries(URLS).map(([k, v]) => [k, v.slice(v.indexOf(',') + 1)]));
export const DOC_FONT = "'TeX Gyre Bonum', Georgia, serif";

// Unicode coverage of the embedded text font (characters outside it are drawn as images in PDFs)
export const CMAP = new Set();
'20-7e,a0-137,139-148,14a-165,168-17f,218-21b,2c6-2c7,2d8-2dd,391-3a1,3a3-3a9,3b1-3c9,3d1,3d5-3d6,3f1,3f5,2010-2011,2013-2014,2016,2018-201a,201c-201e,2020-2022,2026,2030-2031,2039-203b,203d,203f-2040,2044-2046,2052,2054,20ac,2122,2190-2193,2202,2211-2213,2215,2217,221a,221e,2222,2248,2260,2264-2265,22c6,25ca,25e6'.split(',').forEach(r => {
  const [a, b] = r.split('-').map(h => parseInt(h, 16));
  for (let c = a; c <= (Number.isFinite(b) ? b : a); c++) CMAP.add(c);
});

export function loadFonts() {
  const defs = [['normal', '400', 'normal'], ['bold', '700', 'normal'], ['italic', '400', 'italic'], ['bolditalic', '700', 'italic']];
  return Promise.all(defs.map(([k, weight, style]) => {
    try {
      const ff = new FontFace('TeX Gyre Bonum', 'url(' + URLS[k] + ')', { weight, style });
      document.fonts.add(ff);
      return ff.load().catch(() => null);
    } catch (e) { return null; }
  }));
}

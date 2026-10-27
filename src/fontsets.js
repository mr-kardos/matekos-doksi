// The 9 font sets of Matekos Prezi: a text font and the MathJax 4 math font made for it.
// Every text font and every math font was checked to contain the Hungarian letters (ő ű Ő Ű and the other accented
// letters) – also inside formulas (\\text{…}). Computer Modern (MathJax 'tex') and Asana Math failed that test and are not offered.
// The chosen set is stored in the document template (tpl.font); the app shows and exports with exactly these files.
const FILES = import.meta.glob('./fonts/families/*/*.{ttf,otf}', {query: '?url', import: 'default', eager: true});
const fileOf = (fam, st) => Object.entries(FILES).find(([p]) => p.includes(`/families/${fam}/${st}.`))?.[1];

export const FONT_SETS = {
  bonum:   {label: 'TeX Gyre Bonum',        text: 'bonum',   math: 'bonum',   note: 'Bookman-szerű, kerek, jól olvasható'},
  pagella: {label: 'TeX Gyre Pagella',      text: 'pagella', math: 'pagella', note: 'Palatino-szerű, elegáns'},
  termes:  {label: 'TeX Gyre Termes',       text: 'termes',  math: 'termes',  note: 'Times-szerű'},
  schola:  {label: 'TeX Gyre Schola',       text: 'schola',  math: 'schola',  note: 'Century Schoolbook, tankönyvi'},
  modern:  {label: 'Latin Modern',          text: 'lmodern', math: 'modern',  note: 'a klasszikus LaTeX-kép'},
  newcm:   {label: 'New Computer Modern',   text: 'newcm',   math: 'newcm',   note: 'modern LaTeX-kép'},
  stix2:   {label: 'STIX Two',              text: 'stix2',   math: 'stix2',   note: 'Times-szerű, tudományos'},
  fira:    {label: 'Fira Sans',             text: 'fira',    math: 'fira',    note: 'talpatlan, kivetítve nagyon olvasható'},
  dejavu:  {label: 'DejaVu Serif',          text: 'dejavu',  math: 'dejavu',  note: 'széles, erős, kis méretben is jó'},
};
export const DEFAULT_FONT = 'bonum';
/** Other text fonts (no math version): all four styles, Hungarian letters checked; subset to Latin/Greek/symbols. */
export const OTHER_FONTS = {
  liberationsans: 'Liberation Sans (Arial-szerű)', carlito: 'Carlito (Calibri-szerű)', caladea: 'Caladea (Cambria-szerű)',
  liberationmono: 'Liberation Mono (Courier-szerű)', roboto: 'Roboto', opensans: 'Open Sans', lato: 'Lato', montserrat: 'Montserrat',
  inter: 'Inter', notosans: 'Noto Sans', notoserif: 'Noto Serif', libertine: 'Linux Libertine', ubuntu: 'Ubuntu',
  atkinson: 'Atkinson Hyperlegible', comicneue: 'Comic Neue', jetbrains: 'JetBrains Mono'
};
/** All text families: key -> label. Math-capable ones first (key = the text family of a font set). */
export function allFamilies() {
  const math = [], seen = new Set();
  for (const f of Object.values(FONT_SETS)) if (!seen.has(f.text)) { seen.add(f.text); math.push([f.text, f.label]); }
  return {math, other: Object.entries(OTHER_FONTS)};
}
export const familyLabel = fam => { for (const f of Object.values(FONT_SETS)) if (f.text === fam) return f.label; return OTHER_FONTS[fam] ?? fam; };
export const familyCSS = fam => `'MP ${fam}'`;
/** Family key from a computed CSS font-family ("MP lato", serif …). */
export const familyFromCSS = css => (String(css).match(/MP ([a-z0-9]+)/) || [])[1] || null;
/** Register every family with the browser; the files are fetched only when a family is actually used. */
export function registerAllFamilies() {
  const {math, other} = allFamilies();
  for (const [fam] of [...math, ...other]) {
    if (loaded.has(fam)) continue;
    const list = STYLES.map(([st, weight, style]) => { const url = fileOf(fam, st); if (!url) return null;
      try { const ff = new FontFace('MP ' + fam, `url(${url})`, {weight, style}); document.fonts.add(ff); return ff; } catch (e) { return null; } });
    loaded.set(fam, Promise.resolve(list));
  }
}
/** URL of one style ('r', 'b', 'i', 'bi') of a family. */
export const familyFileURL = (fam, st) => fileOf(fam, st);
export const fontSet = key => FONT_SETS[key] ?? FONT_SETS[DEFAULT_FONT];
export const familyName = key => 'MP ' + fontSet(key).text;
const STYLES = [['r', '400', 'normal'], ['b', '700', 'normal'], ['i', '400', 'italic'], ['bi', '700', 'italic']];

const loaded = new Map();   // family -> promise
/** Register a text font (4 styles) with the browser. */
export function loadTextFamily(fam) {
  if (loaded.has(fam)) return loaded.get(fam).then(list => Promise.all((list || []).map(ff => ff && ff.load ? ff.load().catch(() => null) : ff)));
  const p = Promise.all(STYLES.map(([st, weight, style]) => {
    const url = fileOf(fam, st); if (!url) return null;
    try { const ff = new FontFace('MP ' + fam, `url(${url})`, {weight, style}); document.fonts.add(ff); return ff.load().catch(() => null); }
    catch (e) { return null; }
  }));
  loaded.set(fam, p); return p;
}
/** Use a font set for the slides (CSS variable --slide-font). */
export function applyTextFont(key) {
  const fam = fontSet(key).text;
  document.documentElement.style.setProperty('--slide-font', `'MP ${fam}', Georgia, serif`);
  return loadTextFamily(fam);
}
/** The raw font files of a text family (for turning text into outlines in PowerPoint / PDF export). */
export async function familyFiles(fam) {
  const out = {};
  for (const [st] of STYLES) out[st] = await (await fetch(fileOf(fam, st))).arrayBuffer();
  return out;
}
export const fontFiles = key => familyFiles(fontSet(key).text);

// Word (.docx) import – as the PowerPoint import of Matekos Prezi.
//  - text with its formatting (bold, italic, underline, strike, super/subscript, colour, size, highlight),
//    paragraphs (headings, alignment, indents, spacing), lists, tables, pictures, page breaks, page setup;
//  - MathType / Equation Editor 3.0 objects (OLE) -> TeX (mtef.js, the same converter as in Prezi);
//  - Word's own equations (OMML) -> TeX.
// Everything that cannot be converted is counted in the import report.
import JSZip from 'jszip';
import { oleToTeX } from './mtef.js';

const CM_PER_TWIP = 2.54 / 1440, MM_PER_TWIP = 25.4 / 1440;
const kidsOf = (el, name) => el ? [...el.children].filter(c => c.tagName === name) : [];
const kid = (el, name) => el ? [...el.children].find(c => c.tagName === name) || null : null;
const val = (el, a = 'w:val') => el ? el.getAttribute(a) : null;
const on = el => !!el && !['0', 'false', 'off', 'none'].includes(String(val(el) ?? 'true'));
const parse = s => new DOMParser().parseFromString(s, 'application/xml');
const round2 = v => Math.round(v * 100) / 100;

async function readXML(zip, p) { const f = zip.file(p); return f ? parse(await f.async('string')) : null; }
async function relsOf(zip, p) {
  const x = await readXML(zip, p), map = {};
  if (x) for (const r of x.getElementsByTagName('Relationship')) map[r.getAttribute('Id')] = { target: r.getAttribute('Target'), mode: r.getAttribute('TargetMode') };
  return map;
}
const resolve = t => t.startsWith('/') ? t.slice(1) : 'word/' + t.replace(/^\.\//, '');

/* ---------- Word equations (OMML) -> TeX ---------- */
const FN = new Set(['sin', 'cos', 'tan', 'cot', 'tg', 'ctg', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sh', 'ch', 'th', 'arg', 'gcd', 'deg', 'dim', 'ker']);
const OM_UNI = { '−': '-', '·': '\\cdot ', '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '∞': '\\infty ',
  '→': '\\to ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ', '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ', '∪': '\\cup ', '∩': '\\cap ', '∅': '\\emptyset ',
  '∀': '\\forall ', '∃': '\\exists ', '∂': '\\partial ', '∇': '\\nabla ', '°': '^{\\circ}', '…': '\\ldots ', '⋯': '\\cdots ', '∙': '\\cdot ', '∠': '\\angle ', '⊥': '\\perp ', '∥': '\\parallel ',
  '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '\\&', '\u00a0': '~' };
const NARY = { '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap' };
const ACC = { '\u0302': '\\hat', '\u0303': '\\tilde', '\u0307': '\\dot', '\u0308': '\\ddot', '\u20d7': '\\vec', '\u0305': '\\overline', '\u0304': '\\bar', '\u2192': '\\vec', '\u20d6': '\\overleftarrow', '\u0301': '\\acute', '\u0300': '\\grave', '\u030c': '\\check', '\u0306': '\\breve' };
const FENCE = c => c === '' ? '.' : ({ '{': '\\{', '}': '\\}', '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '‖': '\\|', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil' }[c] || c);
const prop = (el, pr, name) => val(kid(kid(el, pr), name), 'm:val');
function omText(r) {
  let s = kidsOf(r, 'm:t').map(t => t.textContent).join('');
  const plain = kid(kid(r, 'm:rPr'), 'm:nor') || prop(r, 'm:rPr', 'm:sty') === 'p' && /^[A-Za-zÀ-ž]{2,}$/.test(s) && !FN.has(s);
  if (plain && /[A-Za-zÀ-ž]/.test(s)) return `\\text{${s.replace(/[{}\\]/g, '')}}`;
  let out = '';
  for (const ch of s) out += OM_UNI[ch] ?? ch;
  return out.replace(/\b(sin|cos|tan|tg|ctg|cot|log|ln|lg|exp|lim)\b/g, '\\$1 ');
}
function om(el) {
  if (!el) return '';
  const all = () => [...el.children].map(om).join('');
  const sub = n => om(kid(el, n));
  switch (el.tagName) {
    case 'm:r': return omText(el);
    case 'm:f': return prop(el, 'm:fPr', 'm:type') === 'lin' ? `{${sub('m:num')}}/{${sub('m:den')}}` : `\\frac{${sub('m:num')}}{${sub('m:den')}}`;
    case 'm:sSup': return `{${sub('m:e')}}^{${sub('m:sup')}}`;
    case 'm:sSub': return `{${sub('m:e')}}_{${sub('m:sub')}}`;
    case 'm:sSubSup': return `{${sub('m:e')}}_{${sub('m:sub')}}^{${sub('m:sup')}}`;
    case 'm:sPre': return `{}_{${sub('m:sub')}}^{${sub('m:sup')}}{${sub('m:e')}}`;
    case 'm:rad': { const hide = on(kid(kid(el, 'm:radPr'), 'm:degHide')) || !sub('m:deg').trim(); return hide ? `\\sqrt{${sub('m:e')}}` : `\\sqrt[${sub('m:deg')}]{${sub('m:e')}}`; }
    case 'm:nary': {
      const c = prop(el, 'm:naryPr', 'm:chr') || '∫', op = NARY[c] || c, lo = sub('m:sub'), up = sub('m:sup');
      return `${op}${lo.trim() ? `_{${lo}}` : ''}${up.trim() ? `^{${up}}` : ''} ${sub('m:e')}`;
    }
    case 'm:d': {
      const pr = kid(el, 'm:dPr'), b = val(kid(pr, 'm:begChr'), 'm:val'), e = val(kid(pr, 'm:endChr'), 'm:val'), sep = val(kid(pr, 'm:sepChr'), 'm:val') ?? '|';
      const items = kidsOf(el, 'm:e').map(om);
      return `\\left${FENCE(b ?? '(')} ${items.join(sep === '|' ? ' \\middle| ' : ` ${sep} `)} \\right${FENCE(e ?? ')')}`;
    }
    case 'm:func': { const n = om(kid(el, 'm:fName')).replace(/\\text\{(\w+)\}/, '$1').trim(); return (FN.has(n) ? `\\${n} ` : n.startsWith('\\') ? n + ' ' : `\\operatorname{${n}}`) + sub('m:e'); }
    case 'm:acc': { const c = prop(el, 'm:accPr', 'm:chr') || '\u0302'; return `${ACC[c] || '\\hat'}{${sub('m:e')}}`; }
    case 'm:bar': return prop(el, 'm:barPr', 'm:pos') === 'top' ? `\\overline{${sub('m:e')}}` : `\\underline{${sub('m:e')}}`;
    case 'm:groupChr': { const c = prop(el, 'm:groupChrPr', 'm:chr') || '⏟', top = prop(el, 'm:groupChrPr', 'm:pos') === 'top'; return c === '⏞' || top ? `\\overbrace{${sub('m:e')}}` : `\\underbrace{${sub('m:e')}}`; }
    case 'm:limLow': { const e = sub('m:e').trim(); return /^\\?lim$/.test(e.replace(/\\text\{|\}/g, '')) ? `\\lim_{${sub('m:lim')}}` : `\\underset{${sub('m:lim')}}{${e}}`; }
    case 'm:limUpp': return `\\overset{${sub('m:lim')}}{${sub('m:e')}}`;
    case 'm:m': return `\\begin{matrix}${kidsOf(el, 'm:mr').map(r => kidsOf(r, 'm:e').map(om).join(' & ')).join(' \\\\ ')}\\end{matrix}`;
    case 'm:eqArr': return `\\begin{aligned}${kidsOf(el, 'm:e').map(om).map(x => x.replace(/&/g, '')).join(' \\\\ ')}\\end{aligned}`;
    case 'm:borderBox': return `\\boxed{${sub('m:e')}}`;
    case 'm:box': case 'm:e': case 'm:num': case 'm:den': case 'm:sub': case 'm:sup': case 'm:deg': case 'm:lim': case 'm:fName':
    case 'm:oMath': case 'm:oMathPara': return all();
    default: return el.tagName.endsWith('Pr') ? '' : all();
  }
}
const tidy = t => t.replace(/(\d),(?=\d)/g, '$1{,}').replace(/\s{2,}/g, ' ').replace(/\{\s+/g, '{').replace(/\s+\}/g, '}').trim();

/* ---------- numbering (lists) ---------- */
const NUMFMT = { decimal: 'decimal', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman' };
function bulletOf(text) {
  const c = (text || '').trim();
  if (!c || c === '\uf0b7' || c === '·' || c === '') return '•';
  if (c === 'o') return '◦';
  if (c === '\uf0a7' || c === '§') return '▪';
  if (c === '\uf0d8' || c === 'Ø') return '➤';
  if (c === '\uf0fc' || c === 'ü') return '✓';
  if (c === '-' || c === '–') return '–';
  return c.codePointAt(0) >= 0xf000 ? '•' : c;
}
function readNumbering(x) {
  const abs = {}, nums = {};
  if (!x) return { level: () => null };
  for (const a of x.getElementsByTagName('w:abstractNum')) {
    const lv = {};
    for (const l of kidsOf(a, 'w:lvl')) {
      lv[l.getAttribute('w:ilvl')] = { fmt: val(kid(l, 'w:numFmt')) || 'decimal', text: val(kid(l, 'w:lvlText')) || '', start: +(val(kid(l, 'w:start')) ?? 1) };
    }
    abs[a.getAttribute('w:abstractNumId')] = lv;
  }
  for (const n of x.getElementsByTagName('w:num')) {
    const over = {};
    for (const o of kidsOf(n, 'w:lvlOverride')) { const s = kid(o, 'w:startOverride'); if (s) over[o.getAttribute('w:ilvl')] = +val(s); }
    nums[n.getAttribute('w:numId')] = { abs: val(kid(n, 'w:abstractNumId')), over };
  }
  return {
    level(numId, ilvl) {
      const n = nums[numId]; if (!n) return null;
      const l = (abs[n.abs] || {})[ilvl]; if (!l) return null;
      return { ...l, start: n.over[ilvl] ?? l.start };
    }
  };
}

/* ---------- styles ---------- */
function readStyles(x) {
  const st = {}, def = { size: null, font: null };
  if (!x) return { st, def };
  const dd = x.getElementsByTagName('w:docDefaults')[0];
  if (dd) {
    const rp = dd.getElementsByTagName('w:rPr')[0];
    if (rp) { const sz = kid(rp, 'w:sz'); if (sz) def.size = +val(sz) / 2; const f = kid(rp, 'w:rFonts'); if (f) def.font = f.getAttribute('w:ascii') || f.getAttribute('w:hAnsi'); }
  }
  for (const s of x.getElementsByTagName('w:style')) {
    const id = s.getAttribute('w:styleId'), name = (val(kid(s, 'w:name')) || '').toLowerCase(), pPr = kid(s, 'w:pPr'), rPr = kid(s, 'w:rPr');
    let level = null;
    const m = /^(heading|címsor)\s*(\d)$/.exec(name); if (m) level = +m[2];
    const ol = kid(pPr, 'w:outlineLvl'); if (level == null && ol && +val(ol) < 3) level = +val(ol) + 1;
    if (name === 'title' || name === 'cím') level = 1;
    st[id] = { level, basedOn: val(kid(s, 'w:basedOn')), name, type: s.getAttribute('w:type'), isDefault: s.getAttribute('w:default') === '1',
      size: kid(rPr, 'w:sz') ? +val(kid(rPr, 'w:sz')) / 2 : null, font: kid(rPr, 'w:rFonts') ? kid(rPr, 'w:rFonts').getAttribute('w:ascii') : null };
  }
  for (const s of Object.values(st)) if (s.type === 'paragraph' && s.isDefault) { if (s.size) def.size = s.size; if (s.font) def.font = s.font; }
  return { st, def };
}
/** Word font -> a font of the app (template font set / family). */
export function mapFont(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  if (/times|liberation serif|tinos/.test(n)) return { set: 'termes' };
  if (/palatino|book antiqua/.test(n)) return { set: 'pagella' };
  if (/bookman/.test(n)) return { set: 'bonum' };
  if (/century schoolbook|new century/.test(n)) return { set: 'schola' };
  if (/latin modern|computer modern|cmu/.test(n)) return { set: 'lmodern' };
  if (/cambria/.test(n)) return { family: 'caladea' };
  if (/calibri|carlito/.test(n)) return { family: 'carlito' };
  if (/arial|helvetica|liberation sans|arimo/.test(n)) return { family: 'liberationsans' };
  if (/courier|consolas|liberation mono/.test(n)) return { family: 'liberationmono' };
  if (/georgia|garamond|constantia/.test(n)) return { family: 'notoserif' };
  if (/verdana|tahoma|segoe|trebuchet/.test(n)) return { family: 'opensans' };
  return null;
}

const HL = { yellow: '#fff176', green: '#c5f0a4', cyan: '#b3ecf5', magenta: '#f8bbd0', blue: '#b3d4fc', red: '#ffb3b3', darkYellow: '#ffd59e', lightGray: '#e0e0e0', darkGray: '#bdbdbd' };

/**
 * Import a .docx file. Returns { doc (TipTap JSON), page {page, pageW, pageH, margins}, font {set|family}, size, report }.
 */
export async function importDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const docX = await readXML(zip, 'word/document.xml');
  if (!docX) throw new Error('Ez nem Word-dokumentum (.docx).');
  const rels = await relsOf(zip, 'word/_rels/document.xml.rels');
  const { st: styles, def } = readStyles(await readXML(zip, 'word/styles.xml'));
  const numbering = readNumbering(await readXML(zip, 'word/numbering.xml'));
  const report = { paragraphs: 0, mathtype: 0, mathtypeFailed: 0, omml: 0, images: 0, imagesSkipped: 0, tables: 0, skipped: new Set() };
  const media = {};
  const dataURL = async rid => {
    const r = rels[rid]; if (!r || r.mode === 'External') return null;
    const p = resolve(r.target), f = zip.file(p); if (!f) return null;
    const ext = p.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }[ext];
    if (!mime) return null;                                    // WMF / EMF cannot be shown
    if (!media[p]) media[p] = `data:${mime};base64,` + await f.async('base64');
    return media[p];
  };
  const styleLevel = id => { let s = styles[id], n = 0; while (s && n++ < 10) { if (s.level) return s.level; s = styles[s.basedOn]; } return null; };

  /* run formatting -> marks */
  const marksOf = (rPr, pStyleSize) => {
    const m = [];
    if (!rPr) return m;
    if (on(kid(rPr, 'w:b'))) m.push({ type: 'bold' });
    if (on(kid(rPr, 'w:i'))) m.push({ type: 'italic' });
    const u = kid(rPr, 'w:u'); if (u && val(u) && val(u) !== 'none') m.push({ type: 'underline' });
    if (on(kid(rPr, 'w:strike')) || on(kid(rPr, 'w:dstrike'))) m.push({ type: 'strike' });
    const va = val(kid(rPr, 'w:vertAlign')); if (va === 'superscript') m.push({ type: 'superscript' }); else if (va === 'subscript') m.push({ type: 'subscript' });
    const hl = val(kid(rPr, 'w:highlight')); if (hl && HL[hl]) m.push({ type: 'highlight', attrs: { color: HL[hl] } });
    const ts = {};
    const c = val(kid(rPr, 'w:color')); if (c && c !== 'auto' && c.toUpperCase() !== '000000') ts.color = '#' + c.toLowerCase();
    const sz = kid(rPr, 'w:sz'); if (sz) { const v = +val(sz) / 2; if (v && v !== (pStyleSize || def.size)) ts.fontSize = v + 'pt'; }
    if (on(kid(rPr, 'w:caps'))) ts.textTransform = 'uppercase';
    const sp = kid(rPr, 'w:spacing'); if (sp && +val(sp)) ts.letterSpacing = round2(+val(sp) / 20) + 'pt';
    if (Object.keys(ts).length) m.push({ type: 'textStyle', attrs: ts });
    return m;
  };

  /* inline content of a paragraph */
  async function inlines(p, pStyleSize) {
    const out = [];
    const text = (t, marks) => { if (!t) return; const last = out[out.length - 1]; if (last && last.type === 'text' && JSON.stringify(last.marks || []) === JSON.stringify(marks)) last.text += t; else out.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) }); };
    const walk = async el => {
      for (const c of el.children) {
        switch (c.tagName) {
          case 'w:r': {
            const marks = marksOf(kid(c, 'w:rPr'), pStyleSize);
            for (const x of c.children) await runChild(x, marks);
            break;
          }
          case 'w:hyperlink': case 'w:ins': case 'w:smartTag': case 'w:fldSimple': case 'w:sdtContent': case 'w:customXml': await walk(c); break;
          case 'w:sdt': await walk(kid(c, 'w:sdtContent') || c); break;
          case 'm:oMath': case 'm:oMathPara': {
            const list = c.tagName === 'm:oMathPara' ? kidsOf(c, 'm:oMath') : [c];
            for (const o of list) { const tex = tidy(om(o)); if (tex) { out.push({ type: 'math', attrs: { tex, display: false, wrap: true } }); report.omml++; } }
            break;
          }
          default: break;
        }
      }
    };
    async function runChild(x, marks) {
      if (x.tagName === 'w:t') text(x.textContent, marks);
      else if (x.tagName === 'w:tab') out.push({ type: 'tab' });
      else if (x.tagName === 'w:br' || x.tagName === 'w:cr') out.push({ type: val(x, 'w:type') === 'page' ? '__pagebreak' : 'hardBreak' });
      else if (x.tagName === 'w:noBreakHyphen') text('-', marks);
      else if (x.tagName === 'w:sym') { const ch = parseInt(x.getAttribute('w:char') || '0', 16); text(String.fromCodePoint(ch >= 0xf000 ? ch - 0xf000 : ch), marks); }
      else if (x.tagName === 'w:object') await object(x, marks);
      else if (x.tagName === 'w:drawing') await drawing(x);
      else if (x.tagName === 'w:pict') await pict(x);
      else if (x.tagName === 'mc:AlternateContent') {       // newer content with an older fallback
        const choice = kid(x, 'mc:Choice'), fb = kid(x, 'mc:Fallback');
        const use = choice && choice.getElementsByTagName('w:drawing').length ? choice : (fb || choice);
        if (use) for (const y of use.children) await runChild(y, marks);
      }
    }
    // MathType / Equation Editor object (or an embedded picture)
    async function object(x, marks) {
      const ole = x.getElementsByTagName('o:OLEObject')[0];
      const prog = ole ? ole.getAttribute('ProgID') || '' : '';
      if (ole && (/^Equation\./i.test(prog) || /MathType/i.test(prog))) {
        const r = rels[ole.getAttribute('r:id')], f = r && zip.file(resolve(r.target));
        try {
          if (!f) throw new Error('missing');
          const tex = tidy(oleToTeX(await f.async('uint8array')));
          out.push({ type: 'math', attrs: { tex, display: false, wrap: true }, ...(marks.length ? { marks: marks.filter(m => m.type === 'bold' || m.type === 'textStyle') } : {}) });
          report.mathtype++;
        } catch (e) {
          report.mathtypeFailed++;
          out.push({ type: 'text', text: '[képlet]', marks: [{ type: 'highlight', attrs: { color: '#ffb3b3' } }] });
        }
        return;
      }
      report.skipped.add(prog ? `beágyazott objektum (${prog})` : 'beágyazott objektum');
      const im = x.getElementsByTagName('v:imagedata')[0];
      if (im) await image(im.getAttribute('r:id'), null, false);
    }
    async function drawing(x) {
      const blip = x.getElementsByTagName('a:blip')[0];
      if (!blip) { report.skipped.add('alakzat / szövegdoboz'); return; }
      const ext = x.getElementsByTagName('wp:extent')[0], cx = ext ? +ext.getAttribute('cx') : 0;
      await image(blip.getAttribute('r:embed'), cx ? Math.round(cx / 9525) : null, !!x.getElementsByTagName('wp:anchor')[0]);
    }
    async function pict(x) {
      const im = x.getElementsByTagName('v:imagedata')[0];
      if (im) await image(im.getAttribute('r:id'), null, false); else report.skipped.add('VML-rajz');
    }
    async function image(rid, w, floating) {
      const src = await dataURL(rid);
      if (!src) { report.imagesSkipped++; return; }
      out.push({ type: 'image', attrs: { src, width: w, wrap: floating ? 'wl' : 'inl' } });
      report.images++;
    }
    await walk(p);
    return out;
  }

  /* paragraph -> node (+ list info) */
  async function paragraph(p) {
    const pPr = kid(p, 'w:pPr'), styleId = val(kid(pPr, 'w:pStyle')), level = styleId ? styleLevel(styleId) : null;
    const sty = styleId ? styles[styleId] : null;
    const attrs = {};
    const jc = val(kid(pPr, 'w:jc')); if (jc) attrs.textAlign = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', end: 'right' }[jc] || 'left';
    const ind = kid(pPr, 'w:ind');
    if (ind) {
      const L = +(ind.getAttribute('w:left') ?? ind.getAttribute('w:start') ?? 0), R = +(ind.getAttribute('w:right') ?? ind.getAttribute('w:end') ?? 0);
      const first = +(ind.getAttribute('w:firstLine') ?? 0), hang = +(ind.getAttribute('w:hanging') ?? 0);
      if (L) attrs.indentLeft = round2(L * CM_PER_TWIP); if (R) attrs.indentRight = round2(R * CM_PER_TWIP);
      if (first) attrs.firstLine = round2(first * CM_PER_TWIP); if (hang) attrs.firstLine = -round2(hang * CM_PER_TWIP);
    }
    const sp = kid(pPr, 'w:spacing');
    if (sp) {
      if (sp.getAttribute('w:before') != null) attrs.spaceBefore = round2(+sp.getAttribute('w:before') / 20);
      if (sp.getAttribute('w:after') != null) attrs.spaceAfter = round2(+sp.getAttribute('w:after') / 20);
      const line = sp.getAttribute('w:line'), rule = sp.getAttribute('w:lineRule');
      if (line && (!rule || rule === 'auto')) { const v = round2(+line / 240 * 1.15); if (Math.abs(v - 1.15) > 0.01) attrs.lineHeight = v; }
    }
    const content = await inlines(p, sty && sty.size);
    report.paragraphs++;
    const numPr = kid(pPr, 'w:numPr');
    const list = numPr ? { numId: val(kid(numPr, 'w:numId')), ilvl: +(val(kid(numPr, 'w:ilvl')) ?? 0) } : null;
    if (list && list.numId === '0') list.numId = null;
    // page breaks inside the paragraph split it
    const parts = [[]];
    for (const n of content) { if (n.type === '__pagebreak') parts.push([]); else parts[parts.length - 1].push(n); }
    const mk = c => level ? { type: 'heading', attrs: { level: Math.min(3, level), ...attrs }, ...(c.length ? { content: c } : {}) }
      : { type: 'paragraph', attrs, ...(c.length ? { content: c } : {}) };
    const nodes = [];
    parts.forEach((c, i) => { if (i) nodes.push({ type: 'pageBreak' }); if (c.length || i === 0 || i === parts.length - 1) nodes.push(mk(c)); });
    if (list && list.numId) { for (const n of nodes) if (n.attrs) { delete n.attrs.indentLeft; delete n.attrs.firstLine; } }
    return { nodes, list: list && list.numId ? list : null };
  }

  /* blocks with list grouping */
  async function blocks(parent) {
    const out = [];
    let stack = [];                                            // [{level, numId, node}]
    const closeLists = () => { stack = []; };
    for (const el of parent.children) {
      if (el.tagName === 'w:p') {
        const { nodes, list } = await paragraph(el);
        if (!list) { closeLists(); out.push(...nodes); continue; }
        const info = numbering.level(list.numId, String(list.ilvl)) || { fmt: 'bullet', text: '•', start: 1 };
        const ordered = info.fmt !== 'bullet' && info.fmt !== 'none';
        while (stack.length && stack[stack.length - 1].level > list.ilvl) stack.pop();
        let top = stack[stack.length - 1];
        if (top && top.level === list.ilvl && (top.numId !== list.numId || top.ordered !== ordered)) { stack.pop(); top = stack[stack.length - 1]; }
        if (!top || top.level < list.ilvl) {
          const node = ordered
            ? { type: 'orderedList', attrs: { start: info.start ?? 1, numStyle: NUMFMT[info.fmt] === 'decimal' && /\)\s*$/.test(info.text) ? 'decimal-paren' : (NUMFMT[info.fmt] || 'decimal') }, content: [] }
            : { type: 'bulletList', attrs: { bulletChar: bulletOf(info.text) }, content: [] };
          if (top) { const li = top.node.content[top.node.content.length - 1]; if (li) li.content.push(node); else out.push(node); }
          else out.push(node);
          stack.push({ level: list.ilvl, numId: list.numId, ordered, node });
          top = stack[stack.length - 1];
        }
        top.node.content.push({ type: 'listItem', content: nodes.filter(n => n.type !== 'pageBreak').map(n => n.type === 'heading' ? { ...n, type: 'paragraph', attrs: { ...n.attrs, level: undefined } } : n) });
      } else if (el.tagName === 'w:tbl') { closeLists(); out.push(await table(el)); }
      else if (el.tagName === 'w:sdt') { closeLists(); out.push(...await blocks(kid(el, 'w:sdtContent') || el)); }
      else if (el.tagName === 'w:sectPr' || el.tagName === 'w:bookmarkStart' || el.tagName === 'w:bookmarkEnd') continue;
      else if (el.tagName === 'w:customXml') out.push(...await blocks(el));
    }
    return out;
  }

  async function table(tbl) {
    report.tables++;
    const noBorders = (() => { const b = kid(kid(tbl, 'w:tblPr'), 'w:tblBorders'); if (!b) return false; return [...b.children].every(e => ['nil', 'none'].includes(val(e))); })();
    const rows = [], origin = {};                              // origin[col] = the cell a vertical merge continues
    for (const tr of kidsOf(tbl, 'w:tr')) {
      const cells = []; let col = 0;
      for (const tc of kidsOf(tr, 'w:tc')) {
        const pr = kid(tc, 'w:tcPr'), span = +(val(kid(pr, 'w:gridSpan')) || 1), vm = kid(pr, 'w:vMerge');
        if (vm && val(vm) !== 'restart') { if (origin[col]) origin[col].attrs.rowspan++; col += span; continue; }
        let content = await blocks(tc);
        content = content.filter(n => n.type === 'paragraph' || n.type === 'heading' || /List$/.test(n.type) || n.type === 'table');
        if (!content.length) content = [{ type: 'paragraph' }];
        const fill = kid(pr, 'w:shd') && kid(pr, 'w:shd').getAttribute('w:fill');
        const cell = { type: 'tableCell', attrs: { colspan: span, rowspan: 1, ...(fill && fill !== 'auto' && fill.toUpperCase() !== 'FFFFFF' ? { background: '#' + fill.toLowerCase() } : {}), ...(noBorders ? { borderWidth: 0 } : {}) }, content };
        if (vm) origin[col] = cell; else delete origin[col];
        cells.push(cell); col += span;
      }
      if (cells.length) rows.push({ type: 'tableRow', content: cells });
    }
    return rows.length ? { type: 'table', content: rows } : { type: 'paragraph' };
  }

  const body = docX.getElementsByTagName('w:body')[0];
  const content = await blocks(body);
  // page setup (last section)
  const sect = [...body.children].filter(c => c.tagName === 'w:sectPr').pop() || body.getElementsByTagName('w:sectPr')[0];
  let page = null;
  if (sect) {
    const sz = kid(sect, 'w:pgSz'), mar = kid(sect, 'w:pgMar');
    const w = sz ? +sz.getAttribute('w:w') * MM_PER_TWIP : 210, h = sz ? +sz.getAttribute('w:h') * MM_PER_TWIP : 297;
    const known = [['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148], ['A3', 297, 420]].find(([, a, b]) => Math.abs(a - Math.min(w, h)) < 2 && Math.abs(b - Math.max(w, h)) < 2);
    page = { page: known ? known[0] : 'custom', pageW: Math.round(w), pageH: Math.round(h) };
    if (mar) page.margins = { top: Math.round(+mar.getAttribute('w:top') * MM_PER_TWIP), bottom: Math.round(+mar.getAttribute('w:bottom') * MM_PER_TWIP), left: Math.round(+(mar.getAttribute('w:left') ?? mar.getAttribute('w:start')) * MM_PER_TWIP), right: Math.round(+(mar.getAttribute('w:right') ?? mar.getAttribute('w:end')) * MM_PER_TWIP) };
    if (kid(sect, 'w:headerReference') || kid(sect, 'w:footerReference')) report.skipped.add('élőfej / élőláb (a sablonban állítható be)');
  }
  if (!content.length) content.push({ type: 'paragraph' });
  return { doc: { type: 'doc', content }, page, font: mapFont(def.font), size: def.size, report: { ...report, skipped: [...report.skipped] } };
}

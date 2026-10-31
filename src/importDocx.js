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
    const snp = kid(pPr, 'w:numPr');
    st[id] = { level, basedOn: val(kid(s, 'w:basedOn')), name, type: s.getAttribute('w:type'), isDefault: s.getAttribute('w:default') === '1',
      jc: val(kid(pPr, 'w:jc')), numId: snp ? val(kid(snp, 'w:numId')) : null, ilvl: snp && kid(snp, 'w:ilvl') ? +val(kid(snp, 'w:ilvl')) : null,
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
  const report = { paragraphs: 0, mathtype: 0, mathtypeFailed: 0, omml: 0, objects: 0, tables: 0, columns: 0, skipped: new Set() };
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
  const styleProp = (id, k) => { let s = styles[id], n = 0; while (s && n++ < 10) { if (s[k] != null) return s[k]; s = styles[s.basedOn]; } return null; };
  const defStyle = Object.keys(styles).find(k => styles[k].isDefault && styles[k].type === 'paragraph');

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
    if (on(kid(rPr, 'w:caps'))) ts.textTransform = 'uppercase';
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
      else if (x.tagName === 'w:br' || x.tagName === 'w:cr') { const ty = val(x, 'w:type'); out.push({ type: ty === 'page' ? '__pagebreak' : ty === 'column' ? '__colbreak' : 'hardBreak' }); }
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
      report.objects++;                         // pictures, charts and other objects are not imported
    }
    async function drawing() { report.objects++; }
    async function pict() { report.objects++; }
    await walk(p);
    return out;
  }

  /* paragraph -> node (+ list info) */
  async function paragraph(p) {
    const pPr = kid(p, 'w:pPr'), styleId = val(kid(pPr, 'w:pStyle')), level = styleId ? styleLevel(styleId) : null;
    const sty = styleId ? styles[styleId] : null;
    const attrs = {};
    // alignment: the paragraph's own, or its style's (justified text stays justified)
    const jc = val(kid(pPr, 'w:jc')) || styleProp(styleId || defStyle, 'jc'); if (jc) attrs.textAlign = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', end: 'right' }[jc] || 'left';
    // indents: the kind is kept (left indent, first-line indent, hanging indent), the size is the app's own step
    // (0.8 cm – where list text starts), so everything lines up; spacing and line height come from the template
    const ind = kid(pPr, 'w:ind');
    if (ind) {
      const STEP = 0.8, cm = v => +v * CM_PER_TWIP;
      const L = cm(ind.getAttribute('w:left') ?? ind.getAttribute('w:start') ?? 0), R = cm(ind.getAttribute('w:right') ?? ind.getAttribute('w:end') ?? 0);
      const first = cm(ind.getAttribute('w:firstLine') ?? 0), hang = cm(ind.getAttribute('w:hanging') ?? 0);
      const steps = v => Math.max(1, Math.round(v / STEP)) * STEP;
      if (L > 0.1) attrs.indentLeft = round2(steps(L));
      if (R > 0.1) attrs.indentRight = round2(steps(R));
      if (first > 0.1) attrs.firstLine = STEP;
      else if (hang > 0.1) { attrs.firstLine = -STEP; attrs.indentLeft = Math.max(attrs.indentLeft || 0, STEP); }
    }
    const content = await inlines(p, sty && sty.size);
    while (content.length && content[0].type === 'hardBreak') content.shift();
    while (content.length && content[content.length - 1].type === 'hardBreak') content.pop();
    for (const n of content) if (n.type === 'text') n.text = n.text.replace(/\u00a0+$/, '');
    report.paragraphs++;
    const numPr = kid(pPr, 'w:numPr');
    let list = numPr ? { numId: val(kid(numPr, 'w:numId')) ?? styleProp(styleId, 'numId'), ilvl: +(val(kid(numPr, 'w:ilvl')) ?? styleProp(styleId, 'ilvl') ?? 0) } : null;
    if (!list && styleId && styleProp(styleId, 'numId')) list = { numId: styleProp(styleId, 'numId'), ilvl: styleProp(styleId, 'ilvl') ?? 0 };   // numbering from the style
    if (list && list.numId === '0') list.numId = null;
    // page breaks inside the paragraph split it
    const parts = [[]], kinds = [];
    for (const n of content) { if (n.type === '__pagebreak' || n.type === '__colbreak') { parts.push([]); kinds.push(n.type); } else parts[parts.length - 1].push(n); }
    const mk = c => level ? { type: 'heading', attrs: { level: Math.min(3, level), ...attrs }, ...(c.length ? { content: c } : {}) }
      : { type: 'paragraph', attrs, ...(c.length ? { content: c } : {}) };
    const nodes = [];
    parts.forEach((c, i) => { if (i) nodes.push({ type: kinds[i - 1] === '__colbreak' ? '__colbreak' : 'pageBreak' }); if (c.length || i === 0 || i === parts.length - 1) nodes.push(mk(c)); });
    if (list && list.numId) { for (const n of nodes) if (n.attrs) { delete n.attrs.indentLeft; delete n.attrs.firstLine; } }
    return { nodes, list: list && list.numId ? list : null };
  }

  /* blocks with list grouping */
  const counters = {};                                         // numId -> [number of the last item per level] (as Word counts)
  async function blocks(parent) {
    const out = [];
    let stack = [];                                            // [{level, numId, node}]
    const closeLists = () => { stack = []; };
    for (const el of parent.children) {
      if (el.tagName === 'w:p') {
        const { nodes, list } = await paragraph(el);
        if (!list) { closeLists(); out.push(...nodes); continue; }
        const info = numbering.level(list.numId, String(list.ilvl)) || { fmt: 'bullet', text: '•', start: 1 };
        const empty = nodes.every(n => n.type === 'pageBreak' || n.type === '__colbreak' || !(n.content && n.content.length));
        if (empty) continue;                                   // an empty numbered paragraph: no empty list item
        const cnt = counters[list.numId] || (counters[list.numId] = []);
        cnt[list.ilvl] = (cnt[list.ilvl] ?? ((info.start ?? 1) - 1)) + 1;
        cnt.length = list.ilvl + 1;                            // deeper levels start again
        const ordered = info.fmt !== 'bullet' && info.fmt !== 'none';
        while (stack.length && stack[stack.length - 1].level > list.ilvl) stack.pop();
        let top = stack[stack.length - 1];
        if (top && top.level === list.ilvl && (top.numId !== list.numId || top.ordered !== ordered)) { stack.pop(); top = stack[stack.length - 1]; }
        if (!top || top.level < list.ilvl) {
          const node = ordered
            ? { type: 'orderedList', attrs: { start: cnt[list.ilvl], numStyle: NUMFMT[info.fmt] === 'decimal' && /\)\s*$/.test(info.text) ? 'decimal-paren' : (NUMFMT[info.fmt] || 'decimal') }, content: [] }
            : { type: 'bulletList', attrs: { bulletChar: bulletOf(info.text) }, content: [] };
          if (top) { const li = top.node.content[top.node.content.length - 1]; if (li) li.content.push(node); else out.push(node); }
          else out.push(node);
          stack.push({ level: list.ilvl, numId: list.numId, ordered, node });
          top = stack[stack.length - 1];
        }
        if (nodes.some(n => n.type === '__colbreak')) top.node.content.__colbreakAfter = top.node.content.length;   // the column ends after this item
        top.node.content.push({ type: 'listItem', content: nodes.filter(n => n.type !== 'pageBreak' && n.type !== '__colbreak').map(n => n.type === 'heading' ? { ...n, type: 'paragraph', attrs: { ...n.attrs, level: undefined } } : n) });
      } else if (el.tagName === 'w:tbl') { closeLists(); out.push(await table(el)); }
      else if (el.tagName === 'w:sdt') { closeLists(); out.push(...await blocks(kid(el, 'w:sdtContent') || el)); }
      else if (el.tagName === 'w:sectPr' || el.tagName === 'w:bookmarkStart' || el.tagName === 'w:bookmarkEnd') continue;
      else if (el.tagName === 'w:customXml') out.push(...await blocks(el));
    }
    // empty paragraphs used as spacing: at most one in a row, none right before / after a list
    const isEmpty = n => (n.type === 'paragraph' || n.type === 'heading') && !(n.content && n.content.length);
    const isListN = n => n && (n.type === 'orderedList' || n.type === 'bulletList');
    return out.filter((n, i) => !(isEmpty(n) && (isEmpty(out[i - 1] || {}) || isListN(out[i - 1]) || isListN(out[i + 1]))));
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
  // sections: a paragraph with a section break ends a section; the last one is described by the body's sectPr
  const sections = []; let cur = [];
  for (const el of body.children) {
    if (el.tagName === 'w:sectPr') continue;
    cur.push(el);
    const sp = el.tagName === 'w:p' ? kid(kid(el, 'w:pPr'), 'w:sectPr') : null;
    if (sp) { sections.push({ els: cur, sect: sp }); cur = []; }
  }
  sections.push({ els: cur, sect: kid(body, 'w:sectPr') });
  const content = [];
  for (const sec of sections) {
    const blk = await blocks({ children: sec.els });
    const cols = sec.sect ? +(kid(sec.sect, 'w:cols') && kid(sec.sect, 'w:cols').getAttribute('w:num')) || 1 : 1;
    const sz = sec.sect && kid(sec.sect, 'w:pgSz');
    const landscape = !!sz && (sz.getAttribute('w:orient') === 'landscape' || +sz.getAttribute('w:w') > +sz.getAttribute('w:h'));
    if (cols < 2 || landscape) { content.push(...blk.filter(n => n.type !== '__colbreak')); continue; }   // landscape: one after the other
    // portrait page in columns: a table with one row, one cell per column, no borders.
    // The content is cut into units (a block, or one item of a top-level list) and divided between the columns:
    // at the column breaks of the Word file, otherwise into equal amounts of text.
    const units = [];
    for (const n of blk) {
      if (n.type === '__colbreak') { units.push({ brk: true }); continue; }
      if ((n.type === 'orderedList' || n.type === 'bulletList') && n.content.length > 1) {
        n.content.forEach((it, k) => { units.push({ list: n, item: it, k }); if (n.content.__colbreakAfter === k) units.push({ brk: true }); });
      } else units.push({ node: n });
    }
    const size = u => u.brk ? 0 : JSON.stringify(u.node || u.item).length;
    let parts;
    if (units.some(u => u.brk)) { parts = [[]]; for (const u of units) { if (u.brk) parts.push([]); else parts[parts.length - 1].push(u); } }
    else {
      const total = units.reduce((a, u) => a + size(u), 0) || 1; parts = Array.from({ length: cols }, () => []); let acc = 0;
      for (const u of units) { const mid = acc + size(u) / 2; parts[Math.min(cols - 1, Math.floor(mid / total * cols))].push(u); acc += size(u); }
    }
    while (parts.length < cols) parts.push([]);
    parts = parts.slice(0, cols - 1).concat([parts.slice(cols - 1).flat()]);
    // units back into blocks; a list cut in two keeps counting in the next column
    const toBlocks = us => {
      const outB = [];
      for (const u of us) {
        if (u.node) { outB.push(u.node); continue; }
        const last = outB[outB.length - 1];
        if (last && last.__src === u.list) last.content.push(u.item);
        else { const l = { type: u.list.type, attrs: { ...u.list.attrs, ...(u.list.type === 'orderedList' ? { start: (u.list.attrs.start ?? 1) + u.k } : {}) }, content: [u.item] }; Object.defineProperty(l, '__src', { value: u.list }); outB.push(l); }
      }
      return outB;
    };
    const cells = parts.map(toBlocks);
    content.push({ type: 'table', attrs: { padV: 0, padH: 0 }, content: [{ type: 'tableRow', content: cells.map(c => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, borderWidth: 0, vAlign: 'top' }, content: c.length ? c : [{ type: 'paragraph' }] })) }] });
    report.columns++;
  }
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
  return { doc: { type: 'doc', content }, page, report: { ...report, skipped: [...report.skipped] } };
}

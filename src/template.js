// Template = everything about the page that isn't the text itself.
export const MM = 96 / 25.4;          // CSS px per mm
export const PT = 0.75;               // PDF pt per CSS px
export const GAP = 28;                // gap between pages on screen (px)
export const SIZES = { A4: [210, 297], A5: [148, 210], A6: [105, 148], A3: [297, 420] };
/** Paper size in mm (A4, A5, A6, A3 or the custom size of the template). */
export const paperOf = tpl => tpl.page === 'custom' ? [Math.max(30, +tpl.pageW || 210), Math.max(30, +tpl.pageH || 297)] : (SIZES[tpl.page] || SIZES.A4);

const pic = () => ({ src: '', h: 10 });
/** One cell of a header/footer (left, centre or right column): a small document. */
export const cellDoc = (text = '', align = 'left', marks, rule) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: align, ...(rule || {}) },
  content: Array.isArray(text) ? (text.length ? text : undefined) : text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : undefined }] });
const ALIGN = { l: 'left', c: 'center', r: 'right' };
const slot = (l = '', c = '', r = '') => ({ l: cellDoc(l, 'left'), c: cellDoc(c, 'center'), r: cellDoc(r, 'right'), img: { l: pic(), c: pic(), r: pic() } });
/** A paragraph style (Normál, Főcím, Cím, Alcím). */
const style = (o = {}) => ({ font: '', size: 12, color: '#111111', bold: false, italic: false, underline: false, shade: '', align: 'left',
  line: 1.25, letter: 0, indentLeft: 0, indentRight: 0, firstLine: 0, spaceBefore: 0, spaceAfter: 6, keepNext: false, contextual: false, ...o });
const LINE = { ruleBottom: '0.75 #000000' }, LINE_TOP = { ruleTop: '0.75 #000000' };
export const DEFAULT_TPL = {
  preset: 'ures',
  page: 'A4', pageW: 210, pageH: 297,
  margins: { top: 25, bottom: 25, left: 25, right: 25 },
  gutter: 0, mirror: false,
  oddEven: false, firstDiff: false,
  header: { odd: slot('{title}', '', '{date}'), even: slot('{date}', '', '{title}'), first: slot() },
  footer: { odd: slot('', '– {page} –'), even: slot('', '– {page} –'), first: slot('', '– {page} –') },
  headerDist: 12, footerDist: 12, hfMid: 50, headerFont: '', footerFont: '', headerLine: true, footerLine: false,
  hfLeft: 25, hfRight: 25,
  headerSize: 9, headerColor: '#59616b', footerSize: 9, footerColor: '#59616b',
  wm: { type: 'text', text: 'MINTA', size: 120, opacity: 0.07, angle: -40, color: '#1f5f74', img: '', imgWidth: 60, imgAngle: 0 },
  font: 'bonum',
  imgGap: 4,
  styles: {
    p: style(),
    h1: style({ size: 21, bold: true, line: 1.2, spaceAfter: 7, keepNext: true }),
    h2: style({ size: 16, bold: true, line: 1.25, spaceBefore: 8, spaceAfter: 5, keepNext: true }),
    h3: style({ size: 13.5, bold: true, line: 1.3, spaceBefore: 6, spaceAfter: 4, keepNext: true })
  },
  lists: { bullet: '•', num: 'decimal', contextual: true },
  hunTrig: true, decComma: true, displayInline: true
};

export const clone = o => JSON.parse(JSON.stringify(o));
export function merge(base, o) {
  for (const k in o || {}) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && base[k] && typeof base[k] === 'object') merge(base[k], o[k]);
    else base[k] = o[k];
  }
  return base;
}
export function normalizeTpl(t) {
  const out = merge(clone(DEFAULT_TPL), t || {});
  // before 0.6: the normal text style lived in size/color/line/after
  if (t && !(t.styles && t.styles.p)) {
    const p = out.styles.p;
    if (t.size) p.size = +t.size; if (t.color) p.color = t.color; if (t.line) p.line = +t.line; if (t.after != null) p.spaceAfter = +t.after;
  }
  for (const k of ['size', 'color', 'line', 'after']) delete out[k];
  if (!SIZES[out.page] && out.page !== 'custom') out.page = 'A4';
  // older templates: header/footer used to start at the text margins
  if (t && t.margins && t.hfLeft == null) { out.hfLeft = (+t.margins.left || 25) + (+t.gutter || 0); out.hfRight = +t.margins.right || 25; }
  // v1 templates had a single header/footer and wm.on
  if (t && t.header && 'l' in t.header) { out.header = { odd: { ...slot(), ...t.header }, even: { ...slot(), ...t.header }, first: { ...slot(), ...t.header } }; }
  if (t && t.footer && 'l' in t.footer) { out.footer = { odd: { ...slot(), ...t.footer }, even: { ...slot(), ...t.footer }, first: { ...slot(), ...t.footer } }; }
  if (t && t.wm && 'on' in t.wm && !('type' in t.wm)) out.wm.type = t.wm.on ? 'text' : 'none';
  for (const k of ['header', 'footer']) for (const v of ['odd', 'even', 'first']) {
    const old = out[k][v] || {};
    const fresh = slot();
    const n = { ...fresh, ...old, img: fresh.img };
    for (const p of ['l', 'c', 'r']) if (typeof old[p] === 'string') n[p] = cellDoc(old[p], ALIGN[p]);   // texts of 0.5
    if (old.doc && old.doc.content) {                                                          // 0.6: one line with tabs
      const para = old.doc.content[0] || {}, parts = [[], [], []]; let k = 0;
      for (const node of para.content || []) { if (node.type === 'tab') k = Math.min(2, k + 1); else parts[k].push(node); }
      if (parts[1].length && !parts[2].length && (para.content || []).filter(x => x.type === 'tab').length >= 2) { parts[2] = parts[1]; parts[1] = []; }
      ['l', 'c', 'r'].forEach((p, i) => { n[p] = cellDoc(parts[i], ALIGN[p]); });
    }
    delete n.doc;
    // 0.6.1 kept the header line as a line of the left column: it is the box's line again
    const lineKey = k === 'header' ? 'headerLine' : 'footerLine', ra = k === 'header' ? 'ruleBottom' : 'ruleTop';
    const p0 = n.l && n.l.content && n.l.content[0];
    if (t && !(lineKey in t) && p0 && p0.attrs && p0.attrs[ra] === '0.75 #000000') { out[lineKey] = true; p0.attrs = { ...p0.attrs, [ra]: null }; }
    if (typeof old.img === 'string') { if (old.img) n.img[old.imgPos || 'l'] = { src: old.img, h: +old.imgH || 10 }; }
    else if (old.img && typeof old.img === 'object') for (const p of ['l', 'c', 'r']) n.img[p] = { ...pic(), ...(old.img[p] || {}) };
    delete n.imgPos; delete n.imgH;
    out[k][v] = n;
  }
  if (t && t.hfMid == null) out.hfMid = 50;
  return out;
}

/** Page geometry in CSS px. The text column has the same width on every page;
 *  gutter / mirror margins only move it horizontally relative to the sheet. */
export function geometry(tpl) {
  const s = paperOf(tpl), m = tpl.margins;
  const W = s[0] * MM, H = s[1] * MM;
  const g = (tpl.gutter || 0) * MM;
  const mt = m.top * MM, mb = m.bottom * MM;
  const leftOf = i => {           // i = 0-based page index; page number = i + 1
    if (tpl.mirror) return (i % 2 === 0) ? m.left * MM + g : m.right * MM;   // odd page: inside on left
    return m.left * MM + g;
  };
  const rightOf = i => {
    if (tpl.mirror) return (i % 2 === 0) ? m.right * MM : m.left * MM + g;
    return m.right * MM;
  };
  const colW = Math.max(60, W - leftOf(0) - rightOf(0));
  const maxL = Math.max(leftOf(0), leftOf(1));
  return {
    W, H, P: H + GAP, mt, mb, colW, maxL, leftOf, rightOf,
    contentTop: i => i * (H + GAP) + mt,
    contentBottom: i => i * (H + GAP) + H - mb,
    sheetX: i => maxL - leftOf(i)        // x of sheet i in stack coordinates (text column starts at maxL)
  };
}

export function variantFor(tpl, i) {
  if (tpl.firstDiff && i === 0) return 'first';
  if (tpl.oddEven && i % 2 === 1) return 'even';
  return 'odd';
}

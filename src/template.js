// Template = everything about the page that isn't the text itself.
export const MM = 96 / 25.4;          // CSS px per mm
export const PT = 0.75;               // PDF pt per CSS px
export const GAP = 28;                // gap between pages on screen (px)
export const SIZES = { A4: [210, 297], A5: [148, 210], B5: [176, 250], Letter: [215.9, 279.4] };

const pic = () => ({ src: '', h: 10 });
const slot = () => ({ l: '', c: '', r: '', img: { l: pic(), c: pic(), r: pic() } });
export const DEFAULT_TPL = {
  page: 'A4',
  margins: { top: 25, bottom: 25, left: 25, right: 25 },
  gutter: 0, mirror: false,
  oddEven: false, firstDiff: false,
  header: { odd: { ...slot(), l: '{title}', r: '{date}' }, even: { ...slot(), l: '{date}', r: '{title}' }, first: slot() },
  footer: { odd: { ...slot(), c: '– {page} –' }, even: { ...slot(), c: '– {page} –' }, first: { ...slot(), c: '– {page} –' } },
  headerDist: 12, footerDist: 12, headerLine: true, footerLine: false,
  headerSize: 9, headerColor: '#59616b', footerSize: 9, footerColor: '#59616b',
  wm: { type: 'text', text: 'MINTA', size: 120, opacity: 0.07, angle: -40, color: '#1f5f74', img: '', imgWidth: 60, imgAngle: 0 },
  size: 12, color: '#111111', line: 1.25, after: 6,
  hunTrig: true, decComma: true
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
  // v1 templates had a single header/footer and wm.on
  if (t && t.header && 'l' in t.header) { out.header = { odd: { ...slot(), ...t.header }, even: { ...slot(), ...t.header }, first: { ...slot(), ...t.header } }; }
  if (t && t.footer && 'l' in t.footer) { out.footer = { odd: { ...slot(), ...t.footer }, even: { ...slot(), ...t.footer }, first: { ...slot(), ...t.footer } }; }
  if (t && t.wm && 'on' in t.wm && !('type' in t.wm)) out.wm.type = t.wm.on ? 'text' : 'none';
  for (const k of ['header', 'footer']) for (const v of ['odd', 'even', 'first']) {
    const old = out[k][v] || {};
    const fresh = slot();
    const n = { ...fresh, ...old, img: fresh.img };
    if (typeof old.img === 'string') { if (old.img) n.img[old.imgPos || 'l'] = { src: old.img, h: +old.imgH || 10 }; }
    else if (old.img && typeof old.img === 'object') for (const p of ['l', 'c', 'r']) n.img[p] = { ...pic(), ...(old.img[p] || {}) };
    delete n.imgPos; delete n.imgH;
    out[k][v] = n;
  }
  return out;
}

/** Page geometry in CSS px. The text column has the same width on every page;
 *  gutter / mirror margins only move it horizontally relative to the sheet. */
export function geometry(tpl) {
  const s = SIZES[tpl.page] || SIZES.A4, m = tpl.margins;
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

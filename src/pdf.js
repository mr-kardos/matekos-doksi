// Vector PDF export that reproduces the on-screen layout exactly.
// Every word, line, picture and formula is placed at the position the layout engine gave it
// on screen, using the same embedded TeX Gyre Bonum font files, so print = screen.
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { FONT_B64, CMAP } from './fonts.js';
import { geometry, PT } from './template.js';

function rgb(c) {
  if (!c) return null;
  c = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) c = '#' + m[1].split('').map(x => x + x).join('');
  m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: 1 }; }
  m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const styleOf = cs => { const b = (parseInt(cs.fontWeight, 10) || 400) >= 600, i = /italic|oblique/.test(cs.fontStyle); return b && i ? 'bolditalic' : b ? 'bold' : i ? 'italic' : 'normal'; };
const supported = s => { for (const ch of s) if (!CMAP.has(ch.codePointAt(0))) return false; return true; };
const SKIP = '.column-resize-handle,.no-print,.math,.wm,.pagebreak,.lm img,.ibar,.isize,.ih,.mpending';

const blCache = new Map();
function baselineOffset(cs) {
  const key = cs.fontFamily + '|' + cs.fontSize + '|' + cs.fontWeight + '|' + cs.fontStyle;
  if (blCache.has(key)) return blCache.get(key);
  const w = document.createElement('div');
  w.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;line-height:normal;font-variant-ligatures:none';
  Object.assign(w.style, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle });
  const t = document.createTextNode('Hxgő'), mk = document.createElement('span');
  mk.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline';
  w.append(t, mk); document.body.appendChild(w);
  const r = document.createRange(); r.selectNodeContents(t);
  const off = mk.getBoundingClientRect().bottom - r.getBoundingClientRect().top;
  w.remove(); blCache.set(key, off);
  return off;
}

function canvasPNG(draw, wPx, hPx, dpi = 300) {
  const k = dpi / 96, c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(wPx * k)); c.height = Math.max(1, Math.ceil(hPx * k));
  const x = c.getContext('2d'); x.scale(k, k); draw(x);
  return c.toDataURL('image/png');
}
function imageData(img, wPx, hPx) {
  const src = img.currentSrc || img.src || '';
  if (/^data:image\/jpe?g/i.test(src)) return { url: src, fmt: 'JPEG' };
  if (/^data:image\/png/i.test(src)) return { url: src, fmt: 'PNG' };
  return { url: canvasPNG(x => x.drawImage(img, 0, 0, wPx, hPx), wPx, hPx), fmt: 'PNG' };
}
function decoOf(el, root) {
  let u = false, s = false;
  for (let e = el; e && e !== root; e = e.parentElement) {
    const d = getComputedStyle(e).textDecorationLine || '';
    if (d.includes('underline')) u = true;
    if (d.includes('line-through')) s = true;
  }
  return { u, s };
}

/**
 * @param {object} p
 *   editorDom, pagesEl, stackEl, scale, tpl, pages, title
 * @returns Promise<Blob>
 */
export async function buildPDF({ editorDom, pagesEl, stackEl, scale, tpl, pages, title }) {
  const g = geometry(tpl);
  const Wp = g.W * PT, Hp = g.H * PT, orient = Wp > Hp ? 'landscape' : 'portrait';
  const doc = new jsPDF({ unit: 'pt', format: [Wp, Hp], orientation: orient, compress: true, putOnlyUsedFonts: true });
  for (let i = 1; i < pages; i++) doc.addPage([Wp, Hp], orient);
  for (const k of ['normal', 'bold', 'italic', 'bolditalic']) { doc.addFileToVFS('bonum-' + k + '.ttf', FONT_B64[k]); doc.addFont('bonum-' + k + '.ttf', 'Bonum', k); }
  doc.setProperties({ title: title || 'Dokumentum', creator: 'Matekos Doksi' });

  const sr = stackEl.getBoundingClientRect();
  const loc = (cx, cy) => {
    const x = (cx - sr.left) / scale, y = (cy - sr.top) / scale;
    const p = Math.min(pages - 1, Math.max(0, Math.floor(y / g.P)));
    return { p, x: (x - g.sheetX(p)) * PT, y: (y - p * g.P) * PT };
  };
  const L = Array.from({ length: pages }, () => ({ bg: [], img: [], line: [], text: [], math: [] }));
  const range = document.createRange();
  const pt = px => px / scale * PT;

  const pushGlyphImage = (str, cs, r, off) => {
    const a = loc(r.left, r.top), w = r.width / scale, h = r.height / scale;
    const url = canvasPNG(x => {
      x.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}, 'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols 2', sans-serif`;
      x.fillStyle = cs.color; x.textBaseline = 'alphabetic'; x.fillText(str, 0, off);
    }, w, h, 400);
    L[a.p].img.push({ x: a.x, y: a.y, w: w * PT, h: h * PT, url, fmt: 'PNG' });
  };

  // ---- backgrounds (highlight, line shading, cell fill) ----
  for (const el of editorDom.querySelectorAll('*')) {
    if (el.closest(SKIP) || el.closest('svg') || el.classList.contains('pg-row') || el.closest('.pg-row')) continue;
    const cs = getComputedStyle(el);
    if (el.classList.contains('shaded')) {
      const c = rgb(cs.getPropertyValue('--shade'));
      if (!c) continue;
      const r = el.getBoundingClientRect();
      let segs = [[r.top, r.bottom]];
      for (const sp of el.querySelectorAll(':scope > .pg-sp, :scope > * .pg-sp')) {
        const s = sp.getBoundingClientRect(), next = [];
        for (const [t, b] of segs) {
          if (s.bottom <= t || s.top >= b) { next.push([t, b]); continue; }
          if (s.top > t) next.push([t, s.top]);
          if (s.bottom < b) next.push([s.bottom, b]);
        }
        segs = next;
      }
      for (const [t, b] of segs) { if (b - t < 0.5) continue; const a = loc(r.left, t); L[a.p].bg.push({ x: a.x, y: a.y, w: pt(r.width), h: pt(b - t), c }); }
      continue;
    }
    const bg = rgb(cs.backgroundColor);
    if (!bg || bg.a === 0) continue;
    const rects = /^(TD|TH|DIV|P|LI|H\d|TABLE|TR|UL|OL)$/.test(el.tagName) ? [el.getBoundingClientRect()] : Array.from(el.getClientRects());
    for (const r of rects) { if (r.width < 0.3 || r.height < 0.3) continue; const a = loc(r.left, r.top); L[a.p].bg.push({ x: a.x, y: a.y, w: pt(r.width), h: pt(r.height), c: bg }); }
  }
  // ---- line shading bands ----
  for (const d of stackEl.querySelectorAll('#shadeLayer > div')) {
    const r = d.getBoundingClientRect(), c = rgb(getComputedStyle(d).backgroundColor);
    if (!c || r.width < 0.5) continue;
    const a = loc(r.left, r.top + 0.5);
    L[a.p].bg.unshift({ x: a.x, y: (r.top - stackEl.getBoundingClientRect().top) / scale * PT - a.p * g.P * PT, w: pt(r.width), h: pt(r.height), c });
  }
  // ---- table borders (resolved like the browser's collapsed-border model) ----
  for (const table of editorDom.querySelectorAll('table')) {
    const cells = Array.from(table.querySelectorAll('td,th')).filter(c => !c.closest('.pg-row')).map(c => {
      const cs = getComputedStyle(c), r = c.getBoundingClientRect();
      const side = k => ({ st: cs['border' + k + 'Style'], w: parseFloat(cs['border' + k + 'Width']) || 0, c: rgb(cs['border' + k + 'Color']) || { r: 0, g: 0, b: 0 } });
      return { r, T: side('Top'), B: side('Bottom'), L: side('Left'), R: side('Right') };
    });
    const near = (a, b) => Math.abs(a - b) < 2.5 * scale;
    const over = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1) > 2 * scale;
    const eff = s => (s.st === 'none' || s.st === 'hidden') ? 0 : s.w;
    for (const c of cells) {
      for (const [k, opp] of [['T', 'B'], ['B', 'T'], ['L', 'R'], ['R', 'L']]) {
        const me = c[k];
        const nb = cells.filter(o => o !== c && (
          k === 'T' ? near(o.r.bottom, c.r.top) && over(o.r.left, o.r.right, c.r.left, c.r.right)
            : k === 'B' ? near(o.r.top, c.r.bottom) && over(o.r.left, o.r.right, c.r.left, c.r.right)
              : k === 'L' ? near(o.r.right, c.r.left) && over(o.r.top, o.r.bottom, c.r.top, c.r.bottom)
                : near(o.r.left, c.r.right) && over(o.r.top, o.r.bottom, c.r.top, c.r.bottom)));
        if (me.st === 'hidden' || nb.some(o => o[opp].st === 'hidden')) continue;
        const w = eff(me);
        if (nb.length) { const nw = Math.max(...nb.map(o => eff(o[opp]))); if (nw > w || (nw === w && (k === 'T' || k === 'L'))) continue; }
        if (!(w > 0)) continue;
        const a = loc(c.r.left, c.r.top), W = pt(c.r.width), H = pt(c.r.height);
        const seg = k === 'T' ? [a.x, a.y, a.x + W, a.y] : k === 'B' ? [a.x, a.y + H, a.x + W, a.y + H] : k === 'L' ? [a.x, a.y, a.x, a.y + H] : [a.x + W, a.y, a.x + W, a.y + H];
        L[a.p].line.push({ x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3], w: w * PT, c: me.c });
      }
    }
  }
  // ---- header / footer rules ----
  for (const hf of pagesEl.querySelectorAll('.hf.ln')) {
    const cs = getComputedStyle(hf), r = hf.getBoundingClientRect(), a = loc(r.left, r.top + 1), w = pt(r.width);
    const isH = hf.classList.contains('hdr');
    const bw = parseFloat(isH ? cs.borderBottomWidth : cs.borderTopWidth) || 1;
    const y = isH ? a.y + pt(r.height - 1) - bw * PT / 2 : (a.y - pt(1)) + bw * PT / 2;
    L[a.p].line.push({ x1: a.x, y1: y, x2: a.x + w, y2: y, w: bw * PT, c: rgb(isH ? cs.borderBottomColor : cs.borderTopColor) || { r: 150, g: 150, b: 150 } });
  }
  // ---- pictures (document, list bullets, headers) ----
  for (const root of [editorDom, pagesEl]) {
    for (const im of root.querySelectorAll('img')) {
      if (im.closest('.no-print,.wm') || !im.complete || !im.naturalWidth) continue;
      const r = im.getBoundingClientRect(); if (r.width < 0.5) continue;
      const a = loc(r.left, r.top), d = imageData(im, r.width / scale, r.height / scale);
      L[a.p].img.push({ x: a.x, y: a.y, w: pt(r.width), h: pt(r.height), url: d.url, fmt: d.fmt });
    }
  }
  // ---- text ----
  const measureDoc = doc;
  for (const root of [editorDom, pagesEl]) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: t => (!t.parentElement || t.parentElement.closest(SKIP) || t.parentElement.closest('svg')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    while (tw.nextNode()) {
      const node = tw.currentNode, el = node.parentElement, cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const off = baselineOffset(cs), size = parseFloat(cs.fontSize) * PT, st = styleOf(cs), col = rgb(cs.color) || { r: 0, g: 0, b: 0 };
      const caps = cs.textTransform === 'uppercase' ? (t => t.toLocaleUpperCase('hu')) : (t => t);
      const re = /[^\s\u200B\uFEFF]+/g; let m;
      while ((m = re.exec(node.data))) {
        const word = caps(m[0]);
        range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 0.05);
        if (!rects.length) continue;
        let perChar = rects.length > 1 || !supported(word);
        if (!perChar) {
          measureDoc.setFont('Bonum', st); measureDoc.setFontSize(size);
          const want = pt(rects[0].width), have = measureDoc.getTextWidth(word);
          if (Math.abs(want - have) > 0.12) perChar = true;           // kerning / letter-spacing → place each glyph
        }
        if (!perChar) {
          const a = loc(rects[0].left, rects[0].top);
          L[a.p].text.push({ s: word, x: a.x, y: a.y + off * PT, size, st, c: col });
          continue;
        }
        for (let i = 0; i < m[0].length;) {
          const cp0 = m[0].codePointAt(i), len = cp0 > 0xffff ? 2 : 1, ch = caps(String.fromCodePoint(cp0)), cp = ch.codePointAt(0);
          range.setStart(node, m.index + i); range.setEnd(node, m.index + i + len);
          let r = null;
          for (const q of range.getClientRects()) if (q.width > 0.05 && (!r || q.width > r.width)) r = q;
          if (r) {
            if (CMAP.has(cp)) { const a = loc(r.left, r.top); L[a.p].text.push({ s: ch, x: a.x, y: a.y + off * PT, size, st, c: col }); }
            else pushGlyphImage(ch, cs, r, off);
          }
          i += len;
        }
      }
      const dc = decoOf(el, root);
      if (dc.u || dc.s) {
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 0.5) continue;
          const a = loc(r.left, r.top), base = a.y + off * PT, x2 = a.x + pt(r.width);
          if (dc.u) L[a.p].line.push({ x1: a.x, y1: base + 0.11 * size, x2, y2: base + 0.11 * size, w: 0.055 * size, c: col });
          if (dc.s) L[a.p].line.push({ x1: a.x, y1: base - 0.27 * size, x2, y2: base - 0.27 * size, w: 0.055 * size, c: col });
        }
      }
    }
  }
  // ---- formulas (vector outlines of TeX Gyre Bonum Math) ----
  for (const m of editorDom.querySelectorAll('.math')) {
    for (const sv of m.querySelectorAll('svg')) {
      if (sv.parentElement && sv.parentElement.closest('svg')) continue;
      const r = sv.getBoundingClientRect(); if (r.width < 0.3) continue;
      const a = loc(r.left, r.top), w = pt(r.width), h = pt(r.height);
      const col = hex(rgb(getComputedStyle(m).color) || { r: 0, g: 0, b: 0 });
      const cl = sv.cloneNode(true);
      cl.removeAttribute('style'); cl.setAttribute('width', w); cl.setAttribute('height', h);
      for (const e of [cl, ...cl.querySelectorAll('*')]) {
        if (e.getAttribute('fill') === 'currentColor') e.setAttribute('fill', col);
        const sk = e.getAttribute('stroke');
        if (sk === 'currentColor') { if (e.getAttribute('stroke-width') === '0') { e.setAttribute('stroke', 'none'); e.removeAttribute('stroke-width'); } else e.setAttribute('stroke', col); }
      }
      L[a.p].math.push({ el: cl, x: a.x, y: a.y, w, h });
    }
  }

  // ---- draw ----
  const fin = (...v) => v.every(Number.isFinite);
  const wm = tpl.wm;
  const wmImgEl = pagesEl.querySelector('.wm img');
  let wmImage = null;
  if (wm.type === 'image' && wm.img && wmImgEl && wmImgEl.naturalWidth) {
    const w = (+wm.imgWidth || 60) / 100 * g.W, h = w * wmImgEl.naturalHeight / wmImgEl.naturalWidth;
    const ang = (+wm.imgAngle || 0) * Math.PI / 180, bw = Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang)), bh = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
    const url = ang ? canvasPNG(x => { x.translate(bw / 2, bh / 2); x.rotate(ang); x.drawImage(wmImgEl, -w / 2, -h / 2, w, h); }, bw, bh, 200) : imageData(wmImgEl, w, h).url;
    wmImage = { url, fmt: ang ? 'PNG' : imageData(wmImgEl, w, h).fmt, w: bw * PT, h: bh * PT };
  }
  // text watermark: measure the real (unrotated) layout of the on-screen watermark, then rotate it the same way
  let wmText = null;
  const wmSpan = pagesEl.querySelector('.wm[data-wm="text"] span');
  if (wm.type === 'text' && wm.text && wmSpan && wmSpan.firstChild) {
    const sheet = wmSpan.closest('.page').getBoundingClientRect();
    const old = wmSpan.style.transform; wmSpan.style.transform = 'none';
    const sb = wmSpan.getBoundingClientRect();
    range.selectNodeContents(wmSpan.firstChild);
    const tb = range.getBoundingClientRect();
    const cs = getComputedStyle(wmSpan);
    wmSpan.style.transform = old;
    const cx = (sb.left + sb.width / 2 - sheet.left) / scale, cy = (sb.top + sb.height / 2 - sheet.top) / scale;
    const px = (tb.left - sheet.left) / scale, py = (tb.top - sheet.top) / scale + baselineOffset(cs);
    const a = (+wm.angle || 0) * Math.PI / 180;                 // CSS: clockwise, y down
    const rx = cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a);
    const ry = cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a);
    wmText = { x: rx * PT, y: ry * PT, size: parseFloat(cs.fontSize) * PT, ls: (parseFloat(cs.letterSpacing) || 0) * PT, c: rgb(wm.color) || { r: 0, g: 0, b: 0 } };
  }
  for (let i = 0; i < pages; i++) {
    doc.setPage(i + 1);
    const pg = L[i];
    if (wmText) {
      doc.setFont('Bonum', 'bold'); doc.setFontSize(wmText.size); doc.setTextColor(wmText.c.r, wmText.c.g, wmText.c.b);
      doc.setGState(new doc.GState({ opacity: +wm.opacity }));
      doc.text(wm.text, wmText.x, wmText.y, { angle: -(+wm.angle || 0), charSpace: wmText.ls });
      doc.setGState(new doc.GState({ opacity: 1 }));
    } else if (wmImage) {
      doc.setGState(new doc.GState({ opacity: +wm.opacity }));
      doc.addImage(wmImage.url, wmImage.fmt, (Wp - wmImage.w) / 2, (Hp - wmImage.h) / 2, wmImage.w, wmImage.h, 'wm', 'SLOW');
      doc.setGState(new doc.GState({ opacity: 1 }));
    }
    for (const b of pg.bg) { if (!fin(b.x, b.y, b.w, b.h)) continue; doc.setFillColor(b.c.r, b.c.g, b.c.b); doc.rect(b.x, b.y, b.w, b.h, 'F'); }
    for (const im of pg.img) { if (!fin(im.x, im.y, im.w, im.h)) continue; try { doc.addImage(im.url, im.fmt, im.x, im.y, im.w, im.h, undefined, 'SLOW'); } catch (e) { /* skip */ } }
    for (const l of pg.line) { if (!fin(l.x1, l.y1, l.x2, l.y2, l.w)) continue; doc.setDrawColor(l.c.r, l.c.g, l.c.b); doc.setLineWidth(l.w); doc.line(l.x1, l.y1, l.x2, l.y2); }
    for (const t of pg.text) {
      if (!fin(t.x, t.y, t.size) || t.size <= 0) continue;
      doc.setFont('Bonum', t.st); doc.setFontSize(t.size); doc.setTextColor(t.c.r, t.c.g, t.c.b);
      doc.text(t.s, t.x, t.y);
    }
    for (const m of pg.math) { if (!fin(m.x, m.y, m.w, m.h)) continue; try { await doc.svg(m.el, { x: m.x, y: m.y, width: m.w, height: m.h }); } catch (e) { /* skip */ } }
  }
  return doc.output('blob');
}

import { MM, geometry, variantFor } from './template.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function tok(s, i, n, title) {
  return esc(s || '').replace(/\{page\}/g, i + 1).replace(/\{pages\}/g, n)
    .replace(/\{date\}/g, esc(new Date().toLocaleDateString('hu-HU')))
    .replace(/\{title\}/g, esc(title));
}

function hfHTML(kind, slot, i, n, tpl, title, g) {
  const has = slot.l || slot.c || slot.r || slot.img;
  if (!has) return '';
  const cell = pos => {
    let inner = '';
    if (slot.img && slot.imgPos === pos) inner += `<img src="${esc(slot.img)}" alt="" style="height:${(+slot.imgH || 10) * MM}px">`;
    const t = slot[pos];
    if (t) inner += `<span class="hft">${tok(t, i, n, title)}</span>`;
    return `<span>${inner}</span>`;
  };
  const L = g.leftOf(i), R = g.rightOf(i);
  const line = kind === 'hdr' ? tpl.headerLine : tpl.footerLine;
  // header box: top edge at headerDist from the paper's top; footer box: bottom edge at footerDist from the bottom
  const anchor = kind === 'hdr' ? `top:${tpl.headerDist * MM}px` : `bottom:${tpl.footerDist * MM}px`;
  return `<div class="hf ${kind}${line ? ' ln' : ''}" style="left:${L}px;right:${R}px;${anchor}">${cell('l')}${cell('c')}${cell('r')}</div>`;
}

function wmHTML(tpl, g) {
  const w = tpl.wm;
  if (w.type === 'text' && w.text) {
    return `<div class="wm" data-wm="text"><span style="font-size:${+w.size}px;opacity:${+w.opacity};color:${esc(w.color)};transform:rotate(${+w.angle}deg)">${esc(w.text)}</span></div>`;
  }
  if (w.type === 'image' && w.img) {
    return `<div class="wm" data-wm="image"><img src="${esc(w.img)}" alt="" style="width:${(+w.imgWidth || 60) / 100 * g.W}px;opacity:${+w.opacity};transform:rotate(${+w.imgAngle || 0}deg)"></div>`;
  }
  return '';
}

/** One page sheet (white paper + header/footer/watermark). Used on screen and for printing. */
export function sheetHTML(i, n, tpl, title, g = geometry(tpl), x = g.sheetX(i), y = i * g.P) {
  const v = variantFor(tpl, i);
  return `<div class="page" data-page="${i}" style="left:${x}px;top:${y}px;width:${g.W}px;height:${g.H}px">`
    + wmHTML(tpl, g)
    + hfHTML('hdr', tpl.header[v], i, n, tpl, title, g)
    + hfHTML('ftr', tpl.footer[v], i, n, tpl, title, g)
    + '</div>';
}

let lastKey = '';
export function renderSheets(container, n, tpl, title, force) {
  const key = JSON.stringify([n, tpl, title]);
  if (!force && key === lastKey) return;
  lastKey = key;
  const g = geometry(tpl);
  let out = '';
  for (let i = 0; i < n; i++) out += sheetHTML(i, n, tpl, title, g);
  container.innerHTML = out;
}

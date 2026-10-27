import { MM, geometry, variantFor } from './template.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));


/** HTML of the header/footer texts (rendered from their small documents by the app). */
let HF = {};
export function setHfHTML(map) { HF = map || {}; }
const fill = (html, i, n, title) => String(html || '').replace(/\{page\}/g, i + 1).replace(/\{pages\}/g, n)
  .replace(/\{date\}/g, esc(new Date().toLocaleDateString('hu-HU'))).replace(/\{title\}/g, esc(title));
function hfHTML(kind, v, slot, i, n, tpl, title, g) {
  const im = slot.img || {};
  const html = (HF[kind] || {})[v] || '';
  const hasText = /\S/.test(html.replace(/<[^>]+>/g, '')) || /class="tab"/.test(html);
  const pics = ['l', 'c', 'r'].filter(p => im[p] && im[p].src);
  const key = kind === 'header' ? 'hdr' : 'ftr';
  // header / footer: measured from the paper's left and right edges (margins only apply to the main text)
  const L = (+tpl.hfLeft || 0) * MM, R = (+tpl.hfRight || 0) * MM;
  const isH = kind === 'header';
  const line = isH ? tpl.headerLine : tpl.footerLine;
  const size = isH ? tpl.headerSize : tpl.footerSize, color = isH ? tpl.headerColor : tpl.footerColor;
  const anchor = isH ? `top:${tpl.headerDist * MM}px` : `bottom:${tpl.footerDist * MM}px`;
  const pic = p => im[p] && im[p].src ? `<span class="hfimg ${p}"><img src="${esc(im[p].src)}" alt="" style="height:${(+im[p].h || 10) * MM}px"></span>` : '';
  return `<div class="hf ${key}${line ? ' ln' : ''}${hasText || pics.length ? '' : ' empty'}" data-hf="${kind}" data-v="${v}" data-i="${i}" style="left:${L}px;right:${R}px;${anchor};font-size:${+size || 9}pt;color:${esc(color || '#59616b')}">`
    + pic('l') + `<div class="hf-text">${fill(html, i, n, title)}</div>` + pic('r') + pic('c') + '</div>';
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
    + hfHTML('header', v, tpl.header[v], i, n, tpl, title, g)
    + hfHTML('footer', v, tpl.footer[v], i, n, tpl, title, g)
    + '</div>';
}

let lastKey = '';
export function renderSheets(container, n, tpl, title, force) {
  const key = JSON.stringify([n, tpl, title, HF]);
  if (!force && key === lastKey) return;
  lastKey = key;
  const g = geometry(tpl);
  let out = '';
  for (let i = 0; i < n; i++) out += sheetHTML(i, n, tpl, title, g);
  container.innerHTML = out;
}

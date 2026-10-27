// Formatting marks (the eye button): green signs drawn ABOVE the text in their own layer – they never take
// space in the document, cannot be clicked and are never printed or exported.
const SKIP = '.math,.lm,.pg-sp,.pg-spb,.ibar,.isize,.ih,.mpending,.pagebreak,.tab';
const CM = 96 / 2.54;
const cm = px => (Math.round(px / CM * 100) / 100).toString().replace('.', ',');

export function drawMarks(layer, editorDom, stackEl, scale) {
  const sr = stackEl.getBoundingClientRect();
  const X = v => (v - sr.left) / scale, Y = v => (v - sr.top) / scale;
  const out = [];
  const put = (cls, x, y, txt, extra = '') => out.push(`<span class="mk-${cls}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;${extra}">${txt}</span>`);
  const range = document.createRange();
  // spaces
  const tw = document.createTreeWalker(editorDom, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement && t.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  while (tw.nextNode()) {
    const n = tw.currentNode, d = n.data;
    for (let i = 0; i < d.length; i++) {
      const c = d[i];
      if (c !== ' ' && c !== '\u00a0') continue;
      range.setStart(n, i); range.setEnd(n, i + 1);
      const r = range.getBoundingClientRect(); if (!r.width && !r.height) continue;
      put(c === ' ' ? 'sp' : 'nb', X(r.left + r.width / 2), Y(r.top + r.height / 2), c === ' ' ? '·' : '°');
    }
  }
  // tabs
  for (const t of editorDom.querySelectorAll('span.tab')) {
    const r = t.getBoundingClientRect(), h = parseFloat(getComputedStyle(t.parentElement).fontSize) || 16;
    put('tab', X(r.left), Y(r.bottom) - h * 0.45, '→', `width:${Math.max(8, r.width / scale)}px`);
  }
  // line breaks (Shift+Enter) and paragraph ends (Enter)
  for (const br of editorDom.querySelectorAll('br:not(.ProseMirror-trailingBreak)')) {
    if (br.closest(SKIP)) continue;
    range.setStartBefore(br); range.setEndBefore(br);
    const r = range.getBoundingClientRect(); if (!r.height) continue;
    put('br', X(r.right) + 1, Y(r.top + r.height / 2), '↵');
  }
  for (const b of editorDom.querySelectorAll('p,h1,h2,h3')) {
    if (b.closest('.hf')) continue;
    range.selectNodeContents(b);
    const rects = Array.from(range.getClientRects()).filter(q => q.width > 0 || q.height > 0);
    const last = rects[rects.length - 1], br = b.getBoundingClientRect(), cs = getComputedStyle(b);
    let x, y;
    if (last && b.textContent.length) { x = X(last.right) + 1; y = Y(last.top + last.height / 2); }
    else { x = X(br.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.textIndent) || 0)); y = Y(br.top + (parseFloat(cs.paddingTop) || 0)) + (parseFloat(cs.lineHeight) || 20) / 2; }
    put('par', x, y, '¶');
    // indentation: from the margin to where the text starts, with its size
    const ml = parseFloat(cs.marginLeft) || 0, ti = parseFloat(cs.textIndent) || 0;
    const top = Y(br.top + (parseFloat(cs.paddingTop) || 0)) + 2;
    if (ml > 0.5 && !b.closest('li,td,th')) out.push(`<span class="mk-ind" style="left:${X(br.left) - ml}px;top:${top}px;width:${ml}px"><i>${cm(ml)}</i></span>`);
    if (Math.abs(ti) > 0.5) out.push(`<span class="mk-ind fl" style="left:${X(br.left) + Math.min(0, ti)}px;top:${top + 9}px;width:${Math.abs(ti)}px"><i>${ti < 0 ? '−' : ''}${cm(Math.abs(ti))}</i></span>`);
  }
  layer.innerHTML = out.join('');
}
